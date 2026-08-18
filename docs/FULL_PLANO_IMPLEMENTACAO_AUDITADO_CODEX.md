# Central de Gestão Full — Plano de Implementação Auditado

> Auditoria realizada em 18/08/2026. O repositório local foi tratado como fonte da verdade. Este documento é um plano; nenhuma implementação, rota, migration, dependência ou refatoração foi criada durante a auditoria.

## Convenções deste documento

- `[VALIDAR]`: hipótese, contrato externo ou estado de ambiente que ainda precisa de confirmação antes de virar comportamento de produção.
- `[V2]`: deliberadamente fora do V1.
- `[RISCO DE PRODUÇÃO]`: ponto que pode afetar segurança, dados, disponibilidade, rate limit ou compatibilidade em produção.
- `null` significa dado ausente, indisponível ou não calculável. Zero só pode significar zero real confirmado por uma fonte íntegra.

# 1. Resumo executivo

A Central Full é viável no código atual, mas não deve ser construída em cima de `metricasService`, `meli_anuncios` ou dos snapshots da Cliente360 como se eles fossem fontes canônicas do estoque Full. Esses módulos têm componentes reaproveitáveis, porém sua identidade persistida ainda é majoritariamente `cliente + MLB`; a fundação atual do repositório já é multi-conta e exige `cliente_conta_id + ml_user_id` explícitos. Misturar as duas arquiteturas silenciosamente criaria risco real de cruzar contas do mesmo cliente.

Decisão recomendada para o V1:

1. Começar sem nova persistência de domínio Full.
2. Resolver uma conta MELI explícita por `cliente_conta_id` usando `clienteContaService`.
3. Fazer coleta on-demand, somente leitura, com cache curto em memória e single-flight por conta/janela.
4. Usar `inventory_id` como identidade física canônica, sempre escopada pela conta, e manter MLB, `variation_id` e `user_product_id` como referências comerciais.
5. Listar anúncios Full por scan, buscar detalhes de itens em multiget de até 20, deduplicar inventários e só então consultar estoque e operações.
6. Consultar estoque uma vez por `inventory_id`, com concorrência pequena e retry controlado.
7. Consultar operações em lotes de `inventory_id` separados por vírgula, usando scroll sequencial. O tamanho máximo desse lote não está documentado e precisa de prova controlada.
8. Calcular giro, cobertura, tendência e reposição em funções puras, com estado de qualidade explícito e sem converter ausência em zero.
9. Entregar a tela como uma segunda aplicação React/Vite isolada no Portal, sem React Router e sem alterar a aplicação Cliente360 existente.
10. Adiar persistência histórica, webhook, candidatos ao Full e uplift causal até existir identidade por conta e histórico confiável.

O primeiro PR não deve tocar rotas, banco, API externa ou interface. Deve introduzir somente o núcleo puro de regras e identidade normalizada, com testes. Isso reduz o risco de congelar contratos externos ainda não validados e cria uma base revisável antes de qualquer I/O.

# 2. Escopo confirmado e fora de escopo

## V1 confirmado

- Visão operacional somente leitura de inventários atualmente identificados como Full.
- Seleção explícita da conta Mercado Livre.
- Estoque total, disponível e não disponível, com detalhamento de condições quando fornecido.
- Operações dos 14 dias completos anteriores, separadas em duas janelas de 7 dias.
- Unidades de `SALE_CONFIRMATION`, delta absoluto, variação tipada, ritmo equivalente de 30 dias, giro diário e cobertura.
- Classificação operacional configurável: ruptura, crítico, repor, saudável, alto, excesso, sem giro e sem dado.
- Reposição base, sem inventar estoque em trânsito e sem aplicar uplift não confiável.
- Tabela por inventário, filtros locais, resumo, estados de carregamento/erro/parcial/vazio/desatualizado e detalhe Product360 operacional.
- Cache curto em memória, limite de concorrência, backoff/jitter e resposta parcial auditável.
- Observabilidade sanitizada, sem tokens e sem scroll IDs em logs.
- Reuso seletivo dos padrões existentes de conta, token, cliente HTTP, cálculo puro, confiança, UI e testes.

## Fora do V1

- `[V2]` Candidatos fora do Full e recomendação automática de entrada no Full.
- `[V2]` Uplift histórico/causal de entrada no Full.
- `[V2]` Persistência de snapshots e operações Full.
- `[V2]` Processamento orientado a webhooks e tópico de estoque.
- `[V2]` Jobs recorrentes, fila distribuída e cache compartilhado entre instâncias.
- `[V2]` Estoque em trânsito, até existir fonte oficial confirmada e reconciliada.
- `[V2]` Score único 0–100 ou ranking opaco de “bom no Full”.
- `[V2]` Escritas no Mercado Livre, criação de envios, retirada, alteração de estoque, preço ou anúncio.
- `[V2]` Previsão probabilística, sazonalidade, lead time automático ou otimização avançada.
- `[V2]` Comparação causal Full versus não Full sem controle de ruptura, maturação e ritmo da conta.
- `[V2]` Mudança global de permissões do Portal.
- `[V2]` Migração dos módulos legados para multi-conta como efeito colateral deste projeto.

# 3. Arquivos e documentação auditados

## Documento de produto lido integralmente

- `docs/FULL_CENTRAL_CONTEXTO_E_PROMPT_CODEX.md` — 1.656 linhas, incluindo a Parte XI.

## Documentação local lida

- `GUIA_PARA_IA.md`
- `CODIGO_LEGADO_AUDITORIA.md`
- `docs/CLIENTE_360_MAPA_TECNICO.md`
- `docs/MAPEAMENTO_CLIENTE_360_VENFORCE_PORTAL.md`
- `docs/CLIENTE_360_REACT_MIGRACAO.md`
- `docs/CLIENTE_360_VUE_MIGRACAO.md`
- `docs/CLIENTE_360_DEVUI_PICO_READONLY_PLANO.md`
- `docs/CONTROL_CENTER_OBSERVABILITY.md`
- `docs/auditoria-sistema-clientes.md`
- `docs/AUDITORIA_ARQUITETURAL_CENTRAL_MARGEM.md`
- `docs/CONTEXTO_COMPLETO_SQUADS_E_REDESENHO_VENFORCE.md`
- `docs/FECHAMENTOS_API_MOTOR_CONCILIACAO.md`
- `docs/FINANCEIRO_DEBUG_INSPECTOR_V1.md`
- `docs/auditoria-frontend/AUDITORIA_UX_UI_PORTAL.md`
- `docs/auditoria-frontend/DESIGN_SYSTEM_FUNDACAO.md`
- `docs/auditoria-frontend/PLANO_IMPLEMENTACAO.md`
- `docs/auditoria-frontend/README.md`
- `Portal/_frontend-redesign-reference/FUNDACAO_GLOBAL_V2.md`

Os seguintes arquivos solicitados não existem neste checkout:

- `[VALIDAR]` `MAPA_DO_SISTEMA.md`
- `[VALIDAR]` `REGRAS_DE_NEGOCIO.md`
- `[VALIDAR]` `AUDITORIA_PERMISSOES_PORTAL.md`

Eles não foram substituídos por suposições. Antes de implementar, confirmar se foram removidos, renomeados ou se existem em outra branch.

## Backend e integrações auditados

- `server/index.js`
- `server/package.json`
- `server/utils/mlClient.js`
- `server/services/mlTokenService.js`
- `server/services/mlApiService.js`
- `server/routes/mlRoutes.js`
- `server/controllers/mlController.js`
- `server/controllers/mlWebhookController.js`
- `server/sql/migrations/20260806_ml_tokens_primary_refresh_safety.sql`
- `server/sql/migrations/20260817_cliente_contas_foundation.sql`
- `server/services/clienteContas/clienteContaService.js`
- `server/controllers/clienteContasController.js`
- `server/routes/clienteContasRoutes.js`
- `server/services/metricasService.js`
- `server/controllers/metricasController.js`
- `server/routes/metricasRoutes.js`
- `server/services/meliAnuncios/meliSyncService.js`
- `server/services/meliAnuncios/meliAnunciosService.js`
- `server/services/automacoes/modeloBaseCustosService.js`
- `server/services/automacoes/diagnosticoService.js`
- `server/services/centralVendas/centralVendasFreteService.js`
- `server/services/centralVendas/centralVendasSyncService.js`
- `server/services/centralVendas/centralVendasRepository.js`
- `server/sql/central_vendas_schema.sql`
- `server/services/motorMargem/motorMargemService.js`
- `server/middlewares/authMiddleware.js`
- `server/middlewares/accessMiddleware.js`
- `server/middlewares/observabilityMiddleware.js`
- `server/services/observabilityService.js`
- `server/utils/observabilitySanitizer.js`

## Cliente360 auditada

- Rotas, controllers, repository, sync, leitura legada e serviço de resultado.
- `cliente360ProdutosEngine.js`, `cliente360PonteEngine.js`, `cliente360ConfiancaEngine.js`, `cliente360DataQualityService.js`, `cliente360CoberturaService.js`, `cliente360ElasticidadeEngine.js`, `cliente360RecuperacaoEngine.js` e `cliente360SimuladorEngine.js`.
- `cliente360FechamentoAdapter.js`, `cliente360SerieService.js` e `server/sql/cliente360_schema.sql`.

## Frontend auditado

- `frontend-react/package.json`
- `frontend-react/vite.config.js`
- `frontend-react/scripts/clean-assets.mjs`
- `frontend-react/src/App.jsx`
- `frontend-react/src/pages/Cliente360Page.jsx`
- `frontend-react/src/services/apiClient.js`
- `frontend-react/src/services/cliente360Api.js`
- Componentes e estilos da Cliente360 React.
- `Portal/layout.js`
- Fundação Global V2 e página legada de Cliente360.

## Testes auditados/executados

- Suíte descoberta automaticamente por `server/tests/run-all.js`.
- Testes de grants, escopo de conta, OAuth por conta, webhook, Cliente360, Central de Vendas e observabilidade.
- `npm test` foi executado sem alterar arquivos. A execução avançou por diversas suítes e parou em `clienteContasBasePicker.test.js` porque o sandbox não permite `listen(0.0.0.0)` (`EPERM`), não por uma asserção funcional desse teste.
- `node tests/mlTokenService.test.js` foi executado isoladamente e falha no caso 14: o teste antigo exige `access_token` e `refresh_token` na listagem administrativa, enquanto o controller atual corretamente deixou de selecioná-los. Esse é um baseline inconsistente e não foi corrigido nesta auditoria.

## Fontes oficiais externas consultadas

- [Envios Fulfillment](https://developers.mercadolivre.com.br/pt_br/envios-fulfillment), atualização exibida em 10/06/2026.
- [Busca de itens](https://developers.mercadolivre.com.br/pt_br/itens-e-buscas).
- [Convivência Full e Flex](https://developers.mercadolivre.com.br/convivencia-full-e-flex).
- [User Products](https://developers.mercadolivre.com.br/pt_br/api-docs-pt-br/user-products).
- [Segurança de aplicações](https://developers.mercadolivre.com.br/pt_br/automovel-gerenciamento-de-contatos/seguranca-de-aplicacoes).

# 4. Estado atual da arquitetura relevante

```text
Portal estático / React isolado
            │ Bearer JWT
            ▼
Express modular (server/index.js)
  ├─ authMiddleware + requireAutomacoesAccess
  ├─ clienteContaService ── cliente_contas / ml_tokens / base vinculos
  ├─ mlFetch ─────────────── token exato, refresh em 401
  ├─ metricasService ─────── Orders on-demand, escopo legado por cliente
  ├─ Central de Vendas ───── snapshots comerciais por cliente/competência
  ├─ Cliente360 ──────────── motores puros + snapshots por cliente
  └─ observabilidade ─────── request id, sanitização e fila de eventos
```

O backend efetivo é modular e montado em `server/index.js`. O `server/package.json` declara `index.js` como entrada quando executado a partir de `server/`. `[VALIDAR]` Não foi encontrada configuração de deploy suficiente para provar qual entrypoint e diretório de trabalho são usados em produção.

A fundação de contas é mais nova que parte da documentação de agosto de 2026. `clienteContaService.resolveMarketplaceAccountContext` já oferece o comportamento seguro necessário:

- conta explícita: valida existência, cliente, marketplace e grant correspondente;
- uma única conta ativa: fallback determinístico para compatibilidade;
- mais de uma conta: `409 MULTIPLE_MARKETPLACE_ACCOUNTS` em vez de escolher silenciosamente;
- grant resolvido por `ml_user_id` exato;
- base vinculada pode ser resolvida por conta.

`mlFetch` já:

- injeta Bearer token sem expô-lo ao chamador;
- aceita `mlUserId` explícito;
- tenta refresh uma vez após 401;
- devolve `{ ok, status, data, retryAfter }`.

`mlFetch` ainda não:

- repete 429/5xx;
- limita concorrência;
- tem deadline/timeout padrão;
- interpreta `Retry-After` no formato HTTP-date;
- diferencia classes de erro de domínio.

# 5. Achados e reaproveitamentos

| Componente atual | Reusar | Como | Limite encontrado |
|---|---:|---|---|
| `clienteContaService` | Sim | Resolver `cliente_conta_id`, cliente, seller/grant e base | Migration precisa existir no ambiente |
| `mlTokenService` | Sim | Seleção exata do grant, refresh lock, backoff de token | Nunca deixar Full pedir grant implícito em cenário multi-conta |
| `mlFetch` | Sim | Único transporte autenticado para GETs ML | Criar wrapper Full para retry, deadline e telemetria |
| `meliSyncService` | Parcial | Padrão de scan e multiget de 20 | Não usa conta explícita e persiste identidade apenas por cliente/MLB |
| `diagnosticoService` | Parcial | Padrão de multiget com `mlUserId` e pool limitado | Domínio e contratos diferentes |
| `centralVendasFreteService` | Parcial | Padrão testado de retry, jitter, pool e `null` versus zero | Acoplado a frete e chamadas sem `mlUserId`; extrair conceito, não importar diretamente |
| `motorMargemService` | Parcial | Evitar N+1 preparando contexto uma vez e enriquecendo lotes | Contexto comercial ainda não é plenamente por conta |
| `metricasService` | Parcial | Agregações comerciais e paginação de Orders | Account-blind, duplica busca por status, converte ausência em zero e não trata 429 |
| Motores puros Cliente360 | Sim, seletivo | Filosofia de engines puras, confiança, cobertura e explicabilidade | Inputs persistidos são cliente/MLB e não provam conta/inventário |
| `cliente360ProdutosEngine` | Futuro | Curva, resultado e margem após adapter account-aware | Não usar diretamente para afirmar dado por inventário no V1 operacional |
| `cliente360ElasticidadeEngine` | Conceito | Requisitos mínimos, R² e classificação de confiança | Elasticidade de preço não é uplift Full |
| `apiClient.js` | Sim | JWT, 401, 403, AbortSignal e erro consistente | Não possui retry; browser não deve repetir coleta pesada |
| React/Vite Cliente360 | Sim | Padrão strangler, mesma origem e assets isolados | Build atual é single-entry e limpa só assets da Cliente360 |
| Fundação Global V2 | Sim | Tokens, tabelas, drawer, badges, estados e responsividade | Evitar editar CSS global para atender apenas Full |
| Observabilidade global | Sim | Request ID, status, duração e sanitização | Adicionar eventos de domínio sem payloads/IDs opacos sensíveis |

Não existe hoje armazenamento ou resolução canônica de `inventory_id` ou `user_product_id` no domínio de anúncios. `variation_id` aparece em contextos financeiros, mas não forma uma ponte operacional Full reutilizável. Essa camada precisa realmente ser criada.

# 6. Divergências entre contexto e código

1. O documento assume principalmente cliente → grant; o código atual já tem cliente → múltiplas `cliente_contas` → grant. A Central Full deve nascer por conta.
2. O documento sugere reuso direto de `metricasService`; o serviço resolve grant implicitamente e usa `n()` para transformar ausências em zero. Reuso direto violaria os requisitos de multi-conta e qualidade de dados.
3. O documento trata `meli_anuncios` como candidato natural; a tabela usa chave `(cliente_id, item_id)` e não armazena `cliente_conta_id`, `inventory_id`, `user_product_id` ou variação canônica. Não pode ser fonte física Full.
4. A Cliente360 atual tem bons motores puros, mas seus snapshots e a Central de Vendas persistem por cliente/período, sem linhagem de conta. Não se pode enriquecer uma conta entre várias sem prova de origem.
5. A documentação oficial atual confirma 60 dias como máximo da busca de operações. A nota de 12 meses aparece na consulta de estoque/histórico disponível e não substitui o limite de 60 dias por chamada.
6. A busca de operações aceita uma lista de `inventory_id` separados por vírgula; portanto, o plano não deve assumir obrigatoriamente uma busca por inventário. `[VALIDAR]` O máximo de IDs/bytes por chamada não é publicado.
7. O documento menciona semântica D-1 de `date_to`; a página oficial auditada exige `date_from < date_to`, mas não tornou inequívoco se `date_to` é inclusivo. Isso deve ser testado com operações conhecidas.
8. User Products não têm relação universal 1:1 com MLB no modelo atual: a documentação oficial descreve unificação e mais de um item por `user_product_id`. Nunca usar UP como substituto automático de MLB.
9. O teste `mlTokenService.test.js` ainda exige credenciais na listagem admin, divergindo do controller mais seguro. Não restaurar vazamento para fazer o teste passar.
10. `[VALIDAR]` Três documentos oficiais solicitados estão ausentes deste checkout.
11. `[RISCO DE PRODUÇÃO]` A migration `20260817_cliente_contas_foundation.sql` é manual, declara que ainda precisa de validação em produção e não é aplicada automaticamente no boot.
12. `[RISCO DE PRODUÇÃO]` Alguns serviços existentes que fazem scan/multiget ainda chamam `mlFetch` sem `mlUserId`; não copiá-los literalmente.
13. A documentação visual de julho diz “sem React” e registra uma proposta Vue, mas o checkout atual contém a migração isolada React/Vite da Cliente360, seus testes e seus artefatos como implementação vigente. A recomendação Full segue o código mais novo e não tenta reativar Vue/Pico nem impor uma regra histórica ao repositório atual.

# 7. Matriz de endpoints Mercado Livre

| Endpoint | Finalidade no Full | Paginação/lote | Status no plano |
|---|---|---|---|
| `GET /users/{seller_id}/items/search?logistic_type=fulfillment&search_type=scan&limit=100` | Listar MLBs Full da conta | `scroll_id`, 5 min; máximo documentado 100 por página | Usar no V1; `[VALIDAR]` se o filtro é preservado em todas as páginas de scan |
| `GET /items?ids=...&attributes=...` | Resolver detalhes, variações e identidades | Multiget máximo oficial 20; resposta verbose por item | Usar no V1 |
| `GET /items/{MLB}` | Diagnóstico pontual/fallback | Uma chamada | Não usar em loop; só detalhe/debug |
| `GET /inventories/{inventory_id}/stock/fulfillment?include_attributes=conditions` | Estoque físico e indisponibilidade | Um inventário por chamada | Usar no V1 com pool/cache |
| `GET /stock/fulfillment/operations/search` | Operações por seller, lista de inventários e período | `scroll`, máximo 1000/página, expira em 5 min, janela ≤60 dias | Usar no V1 em lotes; tamanho de lista `[VALIDAR]` |
| `GET /stock/fulfillment/operations/{operation_id}` | Explicar/debugar operação | Uma chamada | Apenas detalhe sob demanda; não no carregamento inicial |
| `GET /user-products/{user_product_id}/stock` | Estoque por localização | Recurso tem rate limit oficial de 100 rpm | Não é necessário para estoque Full básico; `[V2]` convivência Full/Flex |
| `GET /orders/search` | Métricas comerciais, cancelamentos, GMV | Offset/páginas | Não usar para contar giro Full; adapter comercial futuro e uma coleta por período |

Regras externas confirmadas:

- `inventory_id` vem do recurso `/items`; itens com variações têm um `inventory_id` por variação.
- A resposta de estoque inclui `external_references` com item e possível `variation_id`, útil para reconciliação reversa.
- Operações aceitam `inventory_id` separados por vírgula, `seller_id`, datas, tipo e limit.
- `SALE_CONFIRMATION` é um tipo de operação; `SALE_CANCELATION`, `SALE_RETURN` e outros devem continuar visíveis no histórico, mas não devem ser somados silenciosamente como venda confirmada.
- 429 é previsto oficialmente e `Retry-After` deve ser respeitado.
- O `available_quantity` da API pública de itens pode ser apenas uma faixa referencial; o estoque Full deve vir do endpoint de inventário, nunca do campo do item.

# 8. Modelo de identidade

## Chave canônica

```text
full_inventory_key = cliente_conta_id + ":" + inventory_id
```

`seller_id`/`ml_user_id` deve ser guardado no contexto e conferido nas respostas. `inventory_id` isolado nunca autoriza consulta nem associação entre clientes.

## Estrutura normalizada sugerida

```json
{
  "key": "123:LCQI05831",
  "clienteContaId": 123,
  "sellerId": "384324657",
  "inventoryId": "LCQI05831",
  "userProductIds": ["MLBU..."],
  "references": [
    {
      "mlb": "MLB1557246024",
      "variationId": null,
      "userProductId": "MLBU...",
      "sellerSku": "SKU-1",
      "title": "Produto"
    }
  ],
  "identityStatus": "resolved"
}
```

## Resolução

1. Listar MLBs Full do seller exato.
2. Buscar detalhes em multiget de até 20.
3. Item sem variações: ler os campos de topo `inventory_id` e `user_product_id`.
4. Item com variações: iterar `variations`; associar cada `variation.id` ao `inventory_id`, `user_product_id` e SKU daquela variação.
5. Deduplicar por `cliente_conta_id + inventory_id` e acumular `references[]`.
6. Cruzar `external_references` retornadas pelo estoque para validar MLB/variação; divergências entram em `identityWarnings`.
7. Se não houver `inventory_id`, manter referência em `unresolvedReferences`, não inventar por MLB, SKU ou UP.

## Regras de join

- Operação → inventário: por `inventory_id` e conta já resolvida.
- Ordem → referência: primeiro `(MLB, variation_id)`; depois MLB sozinho somente se ele mapear para exatamente um inventário.
- SKU nunca é chave primária: pode faltar, repetir ou mudar.
- `user_product_id` é agrupador de produto e localização, não identidade física substituta.
- Um inventário pode ter múltiplas referências comerciais; a UI mostra uma referência principal apenas para apresentação e preserva todas no detalhe.
- `[VALIDAR]` Capturar fixtures reais de item antigo multivariação, item novo UP, item sem variação e inventário com múltiplas referências antes de fechar o parser da API.

# 9. Estratégia de coleta, rate limit e 429

## Pipeline

```text
resolver conta exata
  → scan dos MLBs Full
  → multiget de detalhes (20)
  → normalizar/deduplicar inventários
  → estoque por inventário (pool limitado)
  → operações por lotes de inventários (scroll sequencial)
  → agregar em memória
  → engines puras
  → resposta + qualidade por fonte
```

## Políticas de rede

- Todas as chamadas passam por `mlFetch(clienteId, path, { mlUserId })`.
- Criar wrapper `fullMlGateway`, não espalhar paths, retry e parsing pelo service.
- Retry apenas em GET idempotente para 429, 500, 502, 503 e 504.
- 401 continua sob responsabilidade do refresh único de `mlFetch`; se persistir, falhar como `grant_invalid` sem tentar outra conta.
- 400, 403 e 404 não têm retry automático.
- Máximo inicial recomendado: 3 tentativas totais por request externo.
- Respeitar `Retry-After`; ampliar parser para segundos e HTTP-date. Aplicar teto configurável para não prender a requisição indefinidamente.
- Sem header: backoff exponencial com full jitter, por exemplo base 250 ms, teto 4 s.
- Deadline global por coleta; ao expirar, devolver parcial com fontes pendentes/erro, não zeros.
- Pool por conta, não globalmente irrestrito. Valores iniciais conservadores: estoque 4, multiget 2, scroll de operações 1 por lote. `[VALIDAR]` Ajustar em homologação.
- Ao receber 429, reduzir temporariamente a concorrência efetiva da conta e pausar novos lotes; não iniciar uma tempestade de retries.
- Implementar circuit breaker simples em memória por conta para 429 repetido, com `retryAt` visível no contrato.
- Nenhum retry no browser. O frontend recebe `retryAt` e orienta o usuário.

O padrão de `centralVendasFreteService` é a melhor referência local: preserva zero real, isola falhas, faz lotes sequenciais, pool limitado e backoff. A implementação Full deve extrair/reproduzir esse padrão em helper genérico testável com `sleepFn`, sem importar o serviço de frete e sem perder `mlUserId`.

## Paginação por scroll

- Item scan e operações usam cursores diferentes (`scroll_id` versus `scroll`); nunca compartilhar implementação sem adapter de campo.
- O cursor é opaco, transitório e não deve ser logado nem persistido.
- Consumir páginas do mesmo scroll sequencialmente; não paralelizar páginas.
- Parar somente em cursor `null`/ausente conforme o contrato, validando também página vazia.
- Detectar cursor repetido e abortar com `scroll_cycle_detected`.
- Definir máximo de páginas, máximo de registros e deadline, todos observáveis.
- Scroll expira em 5 minutos: processar a cadeia imediatamente, sem intercalar o pool de estoques.
- Se expirar, reiniciar o lote uma única vez e deduplicar operações por `(cliente_conta_id, operation_id)`.
- Em janelas futuras >60 dias, dividir por intervalos sem sobreposição e deduplicar na borda. V1 usa 14 dias e não precisa dividir.
- `[VALIDAR]` Provar se `date_to` é inclusivo ou exclusivo com operações conhecidas; até lá, a função de período deve devolver explicitamente os dois dias e o adapter deve ter teste de contrato.

## Evitar N+1

- Resolver conta, base e contexto uma vez por coleta.
- Um scan de itens por conta, não por inventário.
- Multiget de 20 MLBs.
- Uma consulta de estoque por inventário distinto; não há batch oficial conhecido para esse endpoint.
- Operações por listas de inventários, não uma cadeia por inventário, se o limite real aceitar.
- Uma agregação comercial por conta/período, nunca uma chamada a `metricasService` por linha.
- Detalhe de operação por ID somente após ação explícita do usuário.
- Compartilhar a mesma promise de coleta entre resumo, tabela e detalhe enquanto estiver em andamento.

## Estimativa de chamadas por carga fria

Se `M` é o número de MLBs e `N` o de inventários distintos:

```text
scan_itens       = ceil(M / 100)
multiget         = ceil(M / 20)
estoque          = N
operacoes_iniciais = ceil(N / B)
operacoes_scroll = páginas adicionais por lote
```

`B` é o número seguro de `inventory_id` por consulta de operações e está `[VALIDAR]`.

| Inventários/MLBs aproximados | Base sem operações | Operações iniciais possíveis |
|---:|---:|---:|
| 30 | 1 + 2 + 30 = 33 | entre 1 e 30, mais scroll |
| 100 | 1 + 5 + 100 = 106 | entre 1 e 100, mais scroll |
| 500 | 5 + 25 + 500 = 530 | entre 1 e 500, mais scroll |

O custo dominante é o estoque. Por isso cache, single-flight, pool pequeno e atualização explícita são requisitos do V1, não otimizações opcionais.

# 10. Decisão de persistência e cache

## V1: on-demand com cache de processo

Não criar migration no V1. A janela de 14 dias e o estado atual podem ser obtidos da API e agregados em memória. Persistir agora ampliaria o projeto antes de validar cardinalidade, limites reais e identidade.

Cache recomendado:

- chave: `cliente_conta_id + janela + versão_do_contrato`;
- TTL de sucesso inicial: 2 a 5 minutos `[VALIDAR]`;
- TTL de erro/429: até `retryAt`, com teto pequeno;
- single-flight: uma promise por chave; requisições simultâneas aguardam a mesma coleta;
- limite máximo de entradas e remoção LRU simples;
- cache nunca armazena token, Authorization ou cursor;
- resposta expõe `generatedAt`, `expiresAt`, `cache.hit`, `cache.stale` e `retryAt`;
- falha total não substitui snapshot anterior bom por vazio; pode devolver stale com aviso se ainda dentro de uma tolerância configurada.

Limitações assumidas: cache se perde em restart e não é compartilhado entre instâncias. Isso é aceitável no V1 se documentado e monitorado.

## Gatilhos para persistência

Mover para `[V2]` persistente quando qualquer condição ocorrer:

- mais de uma instância causa coletas duplicadas relevantes;
- contas com centenas de inventários tornam a carga fria inadequada;
- necessidade de histórico, SLA, comparação longitudinal, candidatos ou uplift;
- webhooks precisam de idempotência e reconciliação;
- limite ML exige atualização incremental.

## Modelo futuro, não implementar no V1

- `[V2] full_inventory_identity`: conta, inventory, referências comerciais e vigência.
- `[V2] full_inventory_snapshot`: conta, inventory, `captured_at`, estoque e qualidade.
- `[V2] full_stock_operation`: conta, operation ID único, inventory, tipo, delta, data e referências.
- `[V2] full_sync_run`: conta, janela, status, contagens, páginas, 429, início/fim e erro sanitizado.
- `[V2] full_fulfillment_period`: intervalos em que uma referência esteve efetivamente no Full, base para uplift.

Toda tabela futura deve usar `cliente_conta_id` e constraints/idempotência. Nunca criar DDL em primeiro GET; migrations devem ser manuais, revisadas e aplicadas separadamente.

# 11. Arquitetura de backend proposta

```text
server/services/full/
  fullRules.js             funções puras de métricas/classificação/reposição
  fullIdentity.js          chave, deduplicação e joins sobre dados normalizados
  fullItemParser.js        adapter de payload /items → referências normalizadas
  fullPagination.js        scroll genérico com adapter, limites e dedupe
  fullRetry.js             política testável de retry/backoff/deadline
  fullCache.js             TTL + single-flight por conta
  fullMlGateway.js         endpoints ML e mlUserId obrigatório
  fullOperationsEngine.js  normalização/agregação de operações
  fullCommercialAdapter.js enriquecimento bulk opcional e account-aware
  fullService.js           orquestra uma coleta por conta

server/controllers/fullController.js
server/routes/fullRoutes.js
server/tests/full*.test.js
```

Responsabilidades:

- Controller: valida parâmetros, chama service, mascara resposta, traduz erros. Nenhuma fórmula.
- Service: resolve contexto uma vez, coordena cache/gateway/engines e monta contrato.
- Gateway: único lugar que conhece URL, status HTTP e payload ML.
- Parsers: convertem payload externo em estruturas internas e registram warnings.
- Engines: determinísticas, sem DB, HTTP, ambiente, relógio ou logging.
- Cache: não conhece Express nem Mercado Livre.
- Adapter comercial: no máximo uma leitura/agregação por conta/período e nunca é requisito para o cálculo operacional.

Não adicionar novo framework, ORM, fila ou biblioteca. CommonJS e injeção de dependências seguem o backend atual.

# 12. Contratos internos de API

Namespace recomendado: `/operacao/full`. A rota só deve ser montada após gateway e service terem testes.

## Seleção de contas

Reusar:

```http
GET /clientes/{clienteSlug}/contas?marketplace=meli
```

Não duplicar lista de contas dentro do domínio Full.

## Snapshot operacional

```http
GET /operacao/full/contas/{clienteContaId}/snapshot?windowDays=14
```

V1 aceita apenas `windowDays=14`; outros valores retornam 400 até haver contrato. Leitura exige `authMiddleware + requireAutomacoesAccess`.

Resposta resumida:

```json
{
  "ok": true,
  "contractVersion": 1,
  "requestId": "...",
  "account": {
    "clienteContaId": 123,
    "clienteId": 10,
    "sellerIdMasked": "***4657",
    "marketplace": "meli"
  },
  "period": {
    "timezone": "America/Sao_Paulo",
    "from": "2026-08-04",
    "to": "2026-08-18",
    "previousWeek": { "from": "...", "to": "..." },
    "currentWeek": { "from": "...", "to": "..." },
    "completeness": "complete"
  },
  "cache": {
    "hit": false,
    "stale": false,
    "generatedAt": "...",
    "expiresAt": "...",
    "retryAt": null
  },
  "quality": {
    "status": "complete",
    "sources": {
      "items": { "status": "ok", "expected": 30, "received": 30 },
      "stock": { "status": "partial", "expected": 30, "received": 29 },
      "operations": { "status": "ok", "pages": 2, "records": 1300 },
      "commercial": { "status": "unavailable", "reason": "account_scope_unverified" }
    },
    "warnings": []
  },
  "summary": {},
  "inventories": [],
  "unresolvedReferences": []
}
```

Cada linha de inventário deve incluir:

- identidade canônica e referências;
- `stock` com `total`, `available`, `notAvailable`, detalhes e status da fonte;
- `sales.previous7d`, `sales.current7d`, `sales.total14d` e status da fonte;
- `deltaUnits`, `variationPct`, `variationKind`;
- `pace30dPrevious`, `pace30dCurrent`, sempre rotulados como ritmo equivalente;
- `dailyTurnover`, `coverageDays`, `coverageState`;
- `operationalStatus`, `tags`, `targetCoverageDays`, `sendQuantity`;
- `commercial` opcional, com status independente;
- `updatedAt` por fonte, nunca apenas um timestamp enganoso.

## Movimentos

```http
GET /operacao/full/contas/{clienteContaId}/inventories/{inventoryId}/movements?cursor=&limit=100
```

No V1, serve os movimentos já coletados/cacheados da janela de 14 dias. `cursor` é cursor interno estável e opaco; nunca repassar o scroll ML ao browser. `limit` máximo 200. Se o snapshot não existir, o service pode disparar a mesma single-flight.

## Product360 operacional

```http
GET /operacao/full/contas/{clienteContaId}/inventories/{inventoryId}
```

Retorna detalhe do inventário, referências, indisponibilidades, cálculo explicável e movimentos. Não chamar `/operations/{id}` para todos os movimentos; esse detalhe externo só é buscado sob demanda quando o payload da busca for insuficiente.

## Atualização forçada

```http
POST /operacao/full/contas/{clienteContaId}/refresh
```

Adiar até depois do snapshot estável. Quando criado, deve ser admin-only, respeitar cooldown/lock e responder 202 ou a mesma coleta single-flight. Usuários de leitura não devem poder contornar TTL e consumir rate limit repetidamente.

## Erros internos

| HTTP | `code` | Situação |
|---:|---|---|
| 400 | `INVALID_FULL_QUERY` | janela/limit/ID inválido |
| 401 | `AUTH_REQUIRED` | JWT ausente/inválido |
| 403 | `FULL_ACCESS_DENIED` | role sem acesso ou conta sem autorização |
| 404 | `CLIENT_ACCOUNT_NOT_FOUND` / `INVENTORY_NOT_FOUND` | recurso não pertence ao contexto |
| 409 | `MULTIPLE_MARKETPLACE_ACCOUNTS` | apenas em fallback legado; UI deve selecionar conta |
| 409 | `FULL_REFRESH_IN_PROGRESS` | se não for possível compartilhar single-flight |
| 424 | `ML_GRANT_UNAVAILABLE` | conta sem grant utilizável |
| 429 | `ML_RATE_LIMITED` | deadline/circuit breaker esgotado; incluir `retryAt` |
| 502 | `ML_UPSTREAM_ERROR` | falha externa total sanitizada |
| 504 | `FULL_COLLECTION_TIMEOUT` | deadline global sem snapshot utilizável |

Falhas parciais retornam 200 com `quality.status=partial`; nunca um array vazio indistinguível de “conta sem estoque”.

# 13. Fórmulas e funções puras

Todas recebem valores já normalizados e status de disponibilidade. Nenhuma lê relógio implicitamente.

## Período

- `buildCompletedDayWindow({ endExclusive, days, timezone })`
- `splitFourteenDayWindow(window)`
- `isDateInsideWindow(isoDate, window)`

O orquestrador fornece o dia de corte. `[VALIDAR]` Se a API realmente usa `date_to` exclusivo, alinhar adapter sem alterar a semântica interna.

## Operações

- `normalizeOperation(raw)`
- `saleUnitsFromOperation(operation)`
- `aggregateOperationsByInventory(operations, window)`
- `dedupeOperationsById(operations)`

Regra inicial: somente `SALE_CONFIRMATION` contribui para unidades vendidas, usando o valor absoluto de delta disponível negativo. `SALE_CANCELATION` não é somada como venda; é exibida separadamente. `[VALIDAR]` Com fixtures reais, confirmar sinal, caixa e payload antes de produção.

## Tendência

```text
delta_unidades = semana_atual - semana_anterior

se anterior > 0:
  variacao_pct = delta / anterior * 100
  variation_kind = "comparable"
se anterior = 0 e atual = 0:
  variacao_pct = null
  variation_kind = "no_movement"
se anterior = 0 e atual > 0:
  variacao_pct = null
  variation_kind = "new_movement"
```

- `calculateTrend(previousUnits, currentUnits)`
- `equivalentThirtyDayPace(sevenDayUnits)` = `units / 7 * 30`

Nunca mostrar Infinity. Sempre retornar delta absoluto.

## Giro e cobertura

```text
giro_dia = unidades_14d / 14
cobertura_dias = estoque_disponivel / giro_dia
```

- `calculateDailyTurnover({ units, days, salesStatus })`
- `calculateCoverage({ availableStock, dailyTurnover, stockStatus, salesStatus })`

Estados de cobertura:

- `numeric`: valor finito, inclusive zero real;
- `no_demand`: estoque conhecido e giro real zero; `coverageDays=null`;
- `stock_unavailable`: estoque ausente/erro;
- `sales_unavailable`: operações incompletas/erro;
- `invalid_input`: payload inválido.

Não usar `Infinity` para “sem giro”.

## Reposição

```text
estoque_alvo = giro_dia * dias_cobertura_alvo
enviar = max(0, ceil(estoque_alvo - estoque_disponivel))
```

- `calculateBaseReplenishment(input)`
- `calculateProjectedReplenishment(input)` fica `[V2]` ou desativada até uplift confiável.

Se qualquer input requerido estiver ausente, `sendQuantity=null` com motivo. Estoque em trânsito permanece `null` e não é subtraído no V1.

## Funções de qualidade

- `makeMeasuredValue(value, sourceStatus)`
- `combineSourceQuality(statuses)`
- `isConfirmedZero(value, sourceStatus)`
- `roundForDisplay` apenas na apresentação; cálculos mantêm precisão.

# 14. Score e classificação

Não criar score único no V1. A decisão operacional deve ser explicável por regra e prioridade.

Faixas iniciais configuráveis em objeto versionado:

```text
RUPTURA  available = 0 e demanda recente > 0
CRITICO  cobertura < 7
REPOR    7 <= cobertura < 15
SAUDAVEL 15 <= cobertura <= 45
ALTO     45 < cobertura <= 60
EXCESSO  cobertura > 60
SEM_GIRO estoque > 0 e giro confirmado = 0
SEM_DADO fonte de estoque ou operações insuficiente
```

`INDISPONIVEL` é tag independente quando `not_available_quantity > 0`, não substitui o status primário.

Precedência sugerida:

1. `SEM_DADO` se uma fonte necessária não está íntegra.
2. `RUPTURA` se estoque disponível zero e demanda confirmada positiva.
3. `SEM_GIRO` se estoque positivo e demanda confirmada zero.
4. Faixa numérica de cobertura.

Ordenação operacional sugerida, ainda sem score:

```text
prioridade_status
→ Curva/relevância comercial quando confiável
→ unidades 14d desc
→ cobertura asc
→ inventory_id estável
```

`[VALIDAR]` Meta de cobertura padrão e faixas precisam de aceite humano. Devem estar centralizadas, versionadas e testadas, não hardcoded na UI.

# 15. Estratégia de candidatos ao Full

`[V2]` Não implementar candidatos no V1. Preparar sem prometer resultado:

- manter identidade account-aware e referências comerciais completas;
- futuramente listar também itens não Full em coleta separada;
- enriquecer em uma única leitura comercial por conta/período;
- exigir demanda, margem/resultado, estabilidade, elegibilidade logística e qualidade dos dados;
- excluir itens já Full por `inventory_id`/referência resolvida, não só por tag textual;
- separar “elegível”, “candidato” e “prioridade”;
- nunca chamar ausência de histórico de baixo potencial.

Contrato futuro de candidato deve explicar fatores:

```json
{
  "status": "candidate",
  "reasons": ["demanda_consistente", "margem_positiva"],
  "blocks": [],
  "confidence": "partial",
  "inputs": { "sales": "ok", "margin": "ok", "eligibility": "unknown" }
}
```

`[VALIDAR]` Confirmar endpoint oficial de elegibilidade/proibições Full antes de recomendar entrada.

# 16. Viabilidade e desenho do uplift

`[V2]` O uplift não é calculável de forma defensável com os dados persistidos atuais. Falta histórico account-aware de:

- data efetiva de entrada/saída no Full;
- estoque/ruptura antes e depois;
- operações por inventário;
- vendas e GMV por referência normalizada;
- maturação, sazonalidade e ritmo geral da conta;
- mudanças simultâneas de preço, promoção e anúncio.

Arquitetura futura:

1. Persistir períodos de tratamento Full e snapshots de disponibilidade.
2. Definir janela pré/pós comparável e período de maturação.
3. Excluir ou marcar dias em ruptura.
4. Calcular `uplift_bruto = vendas_dia_full / vendas_dia_fora` apenas com denominadores válidos.
5. Normalizar pelo ritmo da conta/categoria e por mudanças comerciais observáveis.
6. Exigir amostra mínima, cobertura temporal e estabilidade; publicar intervalo/confiança.
7. Manter `uplift=null` quando não estimável e distinguir de `1.0` estimado.

As fórmulas de projeção do documento podem ser preservadas como experimentais, nunca habilitadas para reposição automática sem confiança aceita. O `cliente360ElasticidadeEngine` é uma boa referência de disciplina estatística (mínimo de pontos, R² e classificação), mas sua elasticidade não pode ser reutilizada como uplift Full.

# 17. Decisão de frontend

Escolha: React 18 + Vite isolado, usando as dependências já existentes.

Justificativa:

- tabela rica, filtros combinados, estados parciais, drawer Product360 e movimentos têm estado suficiente para justificar componentes;
- o repositório já adotou o padrão strangler para Cliente360;
- JWT, mesma origem, sidebar e Fundação Global V2 já têm precedentes;
- não exige instalar dependência;
- mantém o Portal vanilla intacto fora desta página.

Não adicionar React Router, Redux ou biblioteca de data-fetch. Um hook de página e `AbortController` bastam.

Isolamento de build recomendado:

- criar entrada `frontend-react/full-gestao.html`;
- criar `src/full-main.jsx` e árvore `src/pages/full`/`src/components/full`;
- usar `vite.full.config.js` separado ou configuração multi-build que gere exclusivamente `Portal/assets/full-gestao/`;
- criar limpeza que remova somente `Portal/assets/full-gestao/`;
- nunca colocar chunks Full dentro de `assets/cliente-360-react`, pois o script atual os apagaria;
- `emptyOutDir=false`, `copyPublicDir=false`, `base='./'` e sem sobrescrever `Portal/index.html`.

`[RISCO DE PRODUÇÃO]` Alterar `frontend-react/vite.config.js` e `clean-assets.mjs` de forma ingênua pode apagar/quebrar assets da Cliente360 ou o Portal. Preferir config e script de build Full separados.

# 18. Wireframe e estados da tela

```text
┌ Central de Gestão Full ──────────────────────────────────────────────┐
│ Cliente [select]  Conta ML [select obrigatório]  Atualizado ...     │
│ [Atualizar] [qualidade dos dados]                                   │
├ KPIs ────────────────────────────────────────────────────────────────┤
│ Inventários | Disp. | Indisp. | Ruptura | Repor | Excesso | Sem dado│
├ Filtros ─────────────────────────────────────────────────────────────┤
│ busca | status | tag indisponível | tendência | somente com demanda │
├ Tabela ──────────────────────────────────────────────────────────────┤
│ Produto/refs | Estoque | 7d ant | 7d atual | Δ/% | Giro | Cob. | Enviar│
│ ...                                                     [Detalhar]  │
└──────────────────────────────────────────────────────────────────────┘
                                                        ┌ Product360 ┐
                                                        │ identidade │
                                                        │ estoque    │
                                                        │ condições  │
                                                        │ cálculo    │
                                                        │ movimentos │
                                                        └────────────┘
```

Estados obrigatórios:

- cliente sem conta MELI;
- uma conta selecionada e múltiplas contas aguardando escolha;
- conta sem grant/expirada/revogada;
- carregamento inicial com skeleton e texto de fase;
- conta sem anúncios Full confirmado;
- dados completos;
- dados parciais por fonte, com números ausentes em `—`;
- 429 com horário de nova tentativa;
- cache válido e cache stale claramente rotulados;
- timeout/cancelamento ao trocar conta;
- referência sem `inventory_id` listada em diagnóstico, não na decisão de estoque;
- erro sem apagar o último snapshot bom da tela;
- mobile: cards/resumo e tabela com scroll; drawer em tela cheia;
- teclado, foco restaurado ao fechar drawer, cabeçalhos e badges com texto além de cor.

# 19. Segurança, grants e permissões

- Toda rota Full usa `authMiddleware` e `requireAutomacoesAccess` para leitura, seguindo Cliente360/Métricas.
- A conta vem do path e é validada pelo service; nunca confiar em `seller_id`, `cliente_id` ou `ml_user_id` enviados pelo browser.
- O service deriva `clienteId` e `mlUserId` da `cliente_conta_id` e passa ambos a toda chamada ML.
- Nunca cair para grant secundário se a conta explícita falhar.
- Não retornar access token, refresh token, client secret, API key, Authorization ou OAuth code.
- Reusar um guard recursivo final como o da Cliente360 e o sanitizador de observabilidade.
- Mascarar seller ID na resposta de resumo quando o valor completo não for funcionalmente necessário.
- Não enviar payload cru de erro ML ao frontend; mapear code e mensagem segura.
- Validar `inventoryId` por formato e confirmar que ele faz parte do snapshot da conta antes do detalhe.
- Não aceitar URL/resource arbitrário para `mlFetch`.
- Refresh forçado, quando existir, deve ser admin-only e ter cooldown.
- `[VALIDAR]` `requireAutomacoesAccess` dá acesso interno global a admin/user/membro e não implementa ACL por cliente. Confirmar se esse é o modelo desejado para a Central Full; não ampliar/restringir silenciosamente.
- `[RISCO DE PRODUÇÃO]` Confirmar aplicação e backfill da migration de `cliente_contas` antes de ativar rotas Full.
- `[RISCO DE PRODUÇÃO]` O default local de `JWT_SECRET` não deve ser usado em produção; validar variável no ambiente, sem registrar seu valor.

# 20. Observabilidade

O middleware global já registra request ID, rota, path sanitizado, status, duração, tamanho e usuário. As rotas Full serão cobertas automaticamente após montagem.

Adicionar logs/eventos de domínio estruturados e sanitizados:

- `full_collection_started/completed/partial/failed`;
- conta em ID interno, nunca token;
- quantidade de MLBs, inventários resolvidos/não resolvidos;
- chamadas por endpoint, páginas, retries, 429 e duração;
- cache hit/miss/stale e single-flight join;
- qualidade por fonte;
- deadline/cap atingido;
- tamanho dos lotes, não conteúdo completo;
- operation IDs apenas quando necessários para suporte, preferencialmente hash/mascara.

Métricas operacionais mínimas:

- p50/p95 de snapshot por escala de inventários;
- taxa de 429 por conta/endpoint;
- inventários por coleta e chamadas de estoque por inventário;
- percentuais de snapshot completo/parcial;
- taxa de identidade não resolvida/ambígua;
- scroll reiniciado/expirado/cíclico;
- cache hit rate.

Não criar tabela de observabilidade nova; usar a infraestrutura existente. Não registrar cursores, headers, resposta crua ou `not_available_detail` inteiro em mensagem de erro.

# 21. Estratégia de testes

## Núcleo puro

- 0→0, 0→N, N→0 e N→M na tendência; nunca Infinity.
- zero real preservado; `null`, `undefined`, NaN e erro de fonte permanecem ausentes.
- giro e cobertura com estoque zero, demanda zero, dados parciais e denominadores inválidos.
- bordas exatas 7, 15, 45 e 60 dias.
- precedência ruptura/sem giro/sem dado.
- reposição, arredondamento, meta inválida e trânsito ausente.
- janela de 14 dias, timezone e bordas dos dois blocos de 7 dias.

## Identidade e parsing

- item simples;
- item multivariação com inventário por variação;
- modelo novo de User Product com mais de um MLB por UP;
- múltiplas referências para um inventário;
- MLB com mais de um inventário;
- SKU ausente/duplicado;
- resposta verbose com falha parcial;
- `external_references` convergente e divergente;
- nenhum fallback inventa inventory ID.

## Gateway/retry/scroll

- `mlUserId` obrigatório em todas as chamadas;
- paths e query encoding;
- 401 refresh único do `mlFetch` sem troca de grant;
- 429 com segundos e HTTP-date;
- 429→503→200, com sleep injetado;
- sem retry em 400/403/404;
- deadline e cancelamento;
- limite de concorrência real;
- scroll normal, vazio, null, repetido, expirado e acima do cap;
- restart único com deduplicação por operation ID;
- lista de inventários em lotes e fallback adaptativo após 400/414.

## Service/cache

- resolução de conta explícita e rejeição de conta de outro cliente/marketplace;
- duas chamadas simultâneas fazem uma única coleta;
- hit, expiração, stale e erro não sobrescrevendo último bom;
- falha isolada de um estoque torna apenas aquela linha parcial;
- operações parciais não viram zero/sem giro;
- nenhum N+1 comercial;
- contagem de chamadas para cenários 30/100/500 com mocks.

## Controller/rotas/segurança

- 401, 403 e roles permitidas;
- path/query inválidos;
- conta não encontrada e grant indisponível;
- máscara recursiva de segredos;
- resposta parcial 200 e falha total mapeada;
- refresh admin-only e cooldown, quando implementado.

## Frontend

- seleção de múltiplas contas;
- AbortController ao trocar conta;
- loading, vazio, parcial, stale, 429 e erro;
- zero exibido como `0` e ausência como `—`;
- filtro/ordenação sem alterar dados;
- drawer, foco, teclado e acessibilidade;
- não disparar múltiplas coletas para resumo/tabela/detalhe;
- build isolado sem apagar assets Cliente360/Portal.

## Integração controlada

- Conta de homologação com item simples e variações.
- Verificar `date_to` em uma operação conhecida.
- Provar lote de operações com 1, 10, 25 e 50 IDs; medir 400/414/429.
- Medir 30/100/500 inventários sem executar contra conta de produção inadvertidamente.
- Conferir estoque do endpoint versus Seller Center para amostra.
- Simular grant revogado, 429 e falha parcial.

Baseline conhecido: a suíte completa depende de bind de porta, bloqueado no sandbox da auditoria, e o teste 14 de `mlTokenService.test.js` está obsoleto frente ao hardening de credenciais. O implementador deve registrar esses fatos e não relaxar segurança para obter verde.

# 22. Plano em PRs/fases pequenas

## Fase 0 — validações sem código

- Recuperar ou declarar obsoletos os três documentos ausentes.
- Confirmar entrypoint/deploy e migration `cliente_contas` no ambiente alvo.
- Obter fixtures sanitizadas dos quatro formatos de identidade.
- Provar semântica de datas e tamanho seguro da lista de inventários em homologação.
- Aprovar faixas e meta de cobertura.

## PR 1 — domínio puro e identidade interna

Escopo exato:

- criar `server/services/full/fullRules.js`;
- criar `server/services/full/fullIdentity.js` apenas para estruturas já normalizadas, sem parser de payload ML;
- criar `server/tests/fullRules.test.js`;
- criar `server/tests/fullIdentity.test.js`.

Sem rotas, controller, `server/index.js`, ML, banco, cache, UI ou dependência. O runner já descobre `*.test.js`; não precisa ser editado.

## PR 2 — infraestrutura de coleta testada, não exposta

- `fullRetry.js`, `fullPagination.js`, `fullItemParser.js`, `fullMlGateway.js`.
- Fixtures oficiais/sanitizadas.
- `mlUserId` obrigatório, batch 20, scroll, deadline, retry e testes de chamada.
- Nenhuma rota pública ainda.

## PR 3 — orquestrador on-demand e cache

- `fullOperationsEngine.js`, `fullCache.js`, `fullService.js`.
- Estoque por pool, operações em lotes adaptativos e qualidade parcial.
- Testes de single-flight, N+1, 30/100/500 e zero/ausência.
- Sem persistência.

## PR 4 — contrato HTTP interno

- Controller, router e montagem em `server/index.js`.
- Snapshot, detalhe e movimentos.
- Auth, conta explícita, máscara e testes de rota.
- `[RISCO DE PRODUÇÃO]` Deploy atrás de feature flag/lista de contas e sem link no menu.

## PR 5 — React isolado

- Entrada/config/build Full separados.
- API client, hook, resumo, tabela, filtros, qualidade e Product360.
- Testes Vitest/Testing Library e build.
- Link de navegação só após smoke test do asset publicado.
- `[RISCO DE PRODUÇÃO]` Mudança em `Portal/layout.js` é global; diff mínimo e rollback simples.

## PR 6 — enriquecimento comercial seguro

- Criar adapter bulk account-aware.
- Reusar motores puros da Cliente360/adapter Central de Vendas somente se a linhagem da conta estiver comprovada.
- Em múltiplas contas sem persistência segregada, retornar `commercial.status=unavailable`.
- Não bloquear métricas operacionais.

## Fases futuras

- `[V2]` Migration e ingestão histórica.
- `[V2]` Webhook idempotente + reconciliação.
- `[V2]` Candidatos.
- `[V2]` Uplift e reposição projetada.

# 23. Riscos de produção

| Risco | Impacto | Mitigação/gate |
|---|---|---|
| `[RISCO DE PRODUÇÃO]` Conta errada/grant implícito | Vazamento ou mistura entre sellers | `clienteContaId` explícito + `mlUserId` em toda chamada + testes |
| `[RISCO DE PRODUÇÃO]` Migration de contas ausente | 500/ambiguidade no deploy | Checagem pré-deploy e rollout bloqueado |
| `[RISCO DE PRODUÇÃO]` 500 estoques por carga fria | 429, latência, pressão no Render | cache, single-flight, pool, deadline, feature flag |
| `[RISCO DE PRODUÇÃO]` Scroll expira | Dados incompletos tratados como completos | sequência imediata, restart único, qualidade parcial |
| `[RISCO DE PRODUÇÃO]` Ausência vira zero | Reposição/classificação incorreta | null estrito, source status e testes |
| `[RISCO DE PRODUÇÃO]` Join por MLB/SKU | Duplica/mescla inventário | chave conta+inventory e ambiguidade explícita |
| `[RISCO DE PRODUÇÃO]` Central de Vendas account-blind | Métrica comercial de outra conta | enrichment indisponível até lineage comprovada |
| `[RISCO DE PRODUÇÃO]` Retry agressivo | Amplifica rate limit | Retry-After, jitter, pool adaptativo e circuit breaker |
| `[RISCO DE PRODUÇÃO]` Cache em múltiplas instâncias | Coleta duplicada/stale divergente | aceitar no V1 pequeno; medir e migrar em V2 |
| `[RISCO DE PRODUÇÃO]` Alterar Vite/clean global | Apaga assets ou login | build Full separado, `emptyOutDir=false`, smoke test |
| `[RISCO DE PRODUÇÃO]` Link global prematuro | Usuários entram em tela quebrada | feature flag e link no último PR |
| `[RISCO DE PRODUÇÃO]` Payload/logs com segredo | Incidente de segurança | masker + sanitizer + testes recursivos |
| Teste legado de tokens | Incentivo a reabrir vazamento | corrigir teste em PR separado de segurança, nunca controller |
| Limites externos não documentados | 400/414/429 e parcial | prova em homologação + batch adaptativo |
| Semântica de datas | venda cai na semana errada | fixture real de borda e contrato de período |

# 24. Validações externas necessárias

- `[VALIDAR]` Campo exato e disponibilidade de `inventory_id`/`user_product_id` em todos os modelos reais usados pelos clientes.
- `[VALIDAR]` Forma dos SKUs em item e variação com `include_attributes=all`/seleção de atributos.
- `[VALIDAR]` Se `logistic_type=fulfillment` funciona junto de `search_type=scan` durante toda a paginação.
- `[VALIDAR]` Quantidade máxima de `inventory_id` separados por vírgula e limite prático de URL.
- `[VALIDAR]` Semântica inclusiva/exclusiva de `date_to` e timezone efetivo da busca.
- `[VALIDAR]` Sinal de `detail.available_quantity` em `SALE_CONFIRMATION`, cancelamento e devolução com exemplos reais.
- `[VALIDAR]` Header `Retry-After` nos endpoints Full e seu formato observado.
- `[VALIDAR]` Rate limit numérico dos endpoints de inventário/operações; a documentação só explicita 429, e 100 rpm para User Product stock.
- `[VALIDAR]` Cardinalidade real 30/100/500 e latência no ambiente de hospedagem.
- `[VALIDAR]` Endpoint oficial de elegibilidade/proibição para candidatos.
- `[VALIDAR]` Disponibilidade de tópico/webhook adequado a estoque Full antes de V2.

# 25. Decisões humanas pendentes

- Aprovar meta padrão de cobertura e faixas 7/15/45/60.
- Definir se a janela usa últimos 14 dias completos ou inclui o dia corrente parcial. Recomendação: dias completos.
- Definir timezone operacional. Recomendação inicial: `America/Sao_Paulo`, explícito no contrato.
- Definir se `SALE_CANCELATION` reduz demanda de reposição ou aparece apenas como métrica separada. Recomendação V1: venda confirmada bruta e cancelamento separado, sem compensação silenciosa.
- Definir acesso de `user`/`membro` a todos os clientes ou futura ACL por cliente.
- Definir limite de contas do piloto e feature flag.
- Definir tolerância de stale e TTL após medir latência/rate.
- Definir se o V1 precisa de margem/Curva antes do lançamento. Recomendação: não bloquear o lançamento operacional; exibir indisponível quando a conta não for rastreável.
- Definir se refresh manual será admin-only. Recomendação: sim.

# 26. Critérios de aceitação do V1

- Usuário escolhe uma conta MELI explícita e nenhuma chamada usa grant de outra conta.
- Conta com múltiplos grants nunca é resolvida por conveniência silenciosa.
- Todos os inventários resolvidos são únicos por conta+inventory.
- Variações não colapsam no MLB de topo.
- Estoque Full vem do endpoint de inventário, não de `available_quantity` público do item.
- Uma falha em um inventário não zera nem derruba as linhas íntegras.
- Operações são consumidas até fim do scroll ou marcadas parciais com motivo.
- 429 respeita `Retry-After`, tem retry limitado e produz `retryAt` quando esgotado.
- 0 real aparece como 0; dado ausente aparece como `null`/`—`.
- 0→N e 0→0 nunca geram Infinity%.
- Sem dados de operações nunca vira `SEM_GIRO`.
- Reposição é explicável e não usa trânsito/uplift inexistente.
- Nenhuma coleta comercial ocorre por inventário.
- Duas cargas simultâneas da mesma conta compartilham single-flight.
- Snapshot informa fonte, qualidade e timestamp.
- Tokens, cursores e payloads sensíveis não aparecem em API/logs.
- React Full builda em diretório próprio sem remover arquivos do Portal/Cliente360.
- Testes unitários e de contrato novos passam; falhas preexistentes são documentadas sem regressão de segurança.
- Rollout começa por feature flag/piloto e pode ser desativado sem migration/rollback de dados.

# 27. Ordem exata de implementação

1. Executar Fase 0 e registrar respostas das validações.
2. Criar branch do PR 1 a partir de base limpa.
3. Implementar regras puras com contratos de ausência explícitos.
4. Implementar identidade apenas sobre referências já normalizadas.
5. Adicionar e executar testes isolados do PR 1.
6. Revisar diff e confirmar ausência de rotas/DB/I/O.
7. Em PR 2, criar fixtures sanitizadas e parser ML separado.
8. Criar retry/deadline e scroll com relógio/sleep injetáveis.
9. Criar gateway que exige `clienteId + mlUserId`.
10. Provar chamadas em homologação antes de montar rota.
11. Em PR 3, criar operações, pool, cache e orquestrador.
12. Medir cenários de escala com mocks e piloto.
13. Em PR 4, criar contrato HTTP, guards e feature flag.
14. Fazer smoke test sem link global.
15. Em PR 5, criar app React/build isolado e só então link do Portal.
16. Em PR 6, adicionar comercial apenas onde a linhagem de conta for comprovada.
17. Avaliar gatilhos de persistência antes de qualquer V2.

# 28. Checklist antes do Claude Code

- [ ] Working tree limpo ou alterações do usuário identificadas e preservadas.
- [ ] Branch base e nome do PR confirmados.
- [ ] `MAPA_DO_SISTEMA.md`, `REGRAS_DE_NEGOCIO.md` e `AUDITORIA_PERMISSOES_PORTAL.md` recuperados ou formalmente dispensados.
- [ ] Migration `20260817_cliente_contas_foundation.sql` validada no ambiente alvo, embora o PR 1 não dependa dela em runtime.
- [ ] Teste legado de exposição de tokens reconhecido como baseline incorreto.
- [ ] Faixas/meta de cobertura aceitas ou mantidas como config provisória claramente marcada.
- [ ] Nenhuma decisão de payload externo não validada será embutida em `fullIdentity.js` do PR 1.
- [ ] Escopo do PR 1 limitado aos quatro arquivos listados.
- [ ] Nenhuma dependência será instalada.
- [ ] Nenhuma rota, migration, arquivo do Portal, Vite ou `server/index.js` será alterado no PR 1.
- [ ] Testes novos serão executados isoladamente e a suíte geral será tentada, registrando limitações preexistentes.
- [ ] Diff final será revisado por arquivo e por estatística.

# PROMPT DE IMPLEMENTAÇÃO PARA CLAUDE CODE

Você está no repositório VenForce. Implemente **somente a PRIMEIRA FASE/PR 1** descrita em `docs/FULL_PLANO_IMPLEMENTACAO_AUDITADO_CODEX.md`.

Regras obrigatórias:

1. Leia integralmente `docs/FULL_PLANO_IMPLEMENTACAO_AUDITADO_CODEX.md`, `GUIA_PARA_IA.md` e `CODIGO_LEGADO_AUDITORIA.md` antes de editar.
2. Trate o código local como fonte da verdade. Preserve alterações preexistentes do usuário.
3. Crie uma branch separada, sugerida `feat/full-fase-1-dominio-puro`. Não faça commit nem push sem autorização explícita.
4. O escopo permitido é exclusivamente:
   - criar `server/services/full/fullRules.js`;
   - criar `server/services/full/fullIdentity.js` para identidades **já normalizadas**, sem interpretar payload cru do Mercado Livre;
   - criar `server/tests/fullRules.test.js`;
   - criar `server/tests/fullIdentity.test.js`.
5. Não altere nenhum outro arquivo. `server/tests/run-all.js` já descobre `*.test.js` automaticamente.
6. Não crie rota, controller, migration, tabela, repository, cache, gateway, chamada HTTP, tela ou build.
7. Não instale dependências e não refatore código existente.
8. Use CommonJS e funções puras, determinísticas e pequenas. Não acesse DB, rede, `process.env`, filesystem, relógio global ou logger.
9. Preserve rigorosamente `null` versus zero. Nunca use `Number(x || 0)` em dado possivelmente ausente. Nunca retorne Infinity/NaN em contrato.
10. Implemente e teste:
    - tendência 0→0, 0→N, N→0 e N→M com delta absoluto, percentual nullable e `variationKind`;
    - ritmo equivalente de 30 dias;
    - giro diário com status de fonte;
    - cobertura numérica e estados `no_demand`, `stock_unavailable`, `sales_unavailable`, `invalid_input`;
    - classificação nas bordas 7/15/45/60, com precedência `SEM_DADO`, `RUPTURA`, `SEM_GIRO` e faixas;
    - reposição base sem trânsito/uplift inventados;
    - chave canônica `clienteContaId:inventoryId`;
    - deduplicação de referências já normalizadas por conta+inventory, preservando múltiplos MLBs/variações/UPs;
    - joins que rejeitam ambiguidade e nunca usam SKU como chave canônica.
11. Deixe faixas e meta como configuração explícita/injetável. Não implemente score 0–100.
12. Não implemente parser de `/items`, `SALE_CONFIRMATION` ou qualquer suposição marcada `[VALIDAR]`; isso pertence ao PR 2 após fixtures.
13. Execute primeiro os dois testes novos diretamente. Depois tente `npm test` dentro de `server/`.
14. Se a suíte geral falhar por baseline conhecido, não corrija fora do escopo: documente que o sandbox pode bloquear `listen(0.0.0.0)` e que `mlTokenService.test.js` contém uma asserção obsoleta exigindo exposição de credenciais. Nunca reintroduza tokens no controller.
15. Revise `git diff --check`, `git diff --stat`, `git diff --` dos quatro arquivos e `git status --short`.
16. Pare ao concluir o PR 1. Não antecipe PR 2.

Na entrega, informe objetivamente: branch criada, quatro arquivos criados, contratos implementados, testes executados/resultados, limitações de baseline e confirmação de que nenhum arquivo fora do escopo foi alterado. Não faça commit.
