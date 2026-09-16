# 0. Metadata da auditoria

- Missão: auditoria técnica estática e plano de implementação; nenhuma implementação autorizada ou realizada.
- Repositório: /home/user/Documentos/venforce_scanner_x1.
- Branch: feat/ui-squads-config-redesign.
- HEAD: 085dc8251f9dfc0e0da354e1096ee3c65022049a.
- Data: 14/09/2026, fuso America/Sao_Paulo. Registro inicial da sessão: 13:01:02 -03:00; retomada da missão e captura de conteúdo antes da investigação técnica. Conferência intermediária: 13:14:20 -03:00.
- Working tree inicial: **DIRTY**. O objeto auditado é o conteúdo local, incluindo modificações e arquivos não rastreados; não é apenas o commit HEAD.
- Ordem de leitura: arquitetura integral (780 linhas), depois prompt integral (1.422 linhas), antes da investigação do código.
- Arquitetura: Projeto_cliente360/VENFORCE_CLIENTE_360_CARRO_CHEFE_ARQUITETURA (1) (1).md.
- Missão completa: Projeto_cliente360/PROMPT_CODEX_AUDITORIA_IMPLEMENTACAO_CLIENTE360.md.
- Única escrita desta auditoria: este documento.
- Não foram executados testes, builds, scripts do projeto, backend, SQL, migrations, instalações ou operações Git de escrita. Nenhum arquivo .env foi aberto; nenhum serviço externo foi consultado.
- Evidência de banco significa DDL e consultas presentes no repositório. **Existência física, migrations aplicadas, preenchimento de cliente_conta_id e distribuição de dados no banco real: NÃO DETERMINÁVEL nesta missão.**
- Testes foram lidos e confrontados com suas dependências e mocks. “Coberto por teste” abaixo não significa “executado/aprovado nesta auditoria”.
- Controle de concorrência: status repetido e inventário SHA-256 em memória de 1.448 arquivos locais existentes, rastreados e não ignorados, excluindo .env. Resultado final registrado ao concluir o documento. O controle não observa mudanças transitórias revertidas entre leituras nem todos os arquivos ignorados.
- AGENTS.md aplicável não foi encontrado na descoberta inicial. A documentação venforce_md_v2 foi usada como referência secundária; seu pedido de atualizar outras documentações não foi seguido porque a missão permite somente este arquivo.
- Hierarquia usada para fatos: runtime montado → rotas/controllers/services → testes → DDL/config → venforce_md_v2 → decisões P2.9 → arquitetura proposta → documentação antiga → inferência. Para o **target**, a decisão humana P2.9 prevalece sobre a ausência de implementação atual.

## Estado inicial: git status --short

~~~text
 D AUDITORIA_FECHAMENTO_PLANILHAS_REAIS_V1.md
 D BACKEND_V3_AUTHORIZATION_COVERAGE.md
 D BACKEND_V3_INITIAL_AUDIT.md
 D CENTRAL_MARGEM_FRONTEND.md
 D CODIGO_LEGADO_AUDITORIA.md
 D DESIGN.md
 D GUIA_PARA_IA.md
 D IMPLEMENTACAO_DASHBOARD_CARTEIRA_PRONTIDAO.md
 D IMPLEMENTACAO_DASHBOARD_VENFORCE.md
 D PRODUCT.md
 D Portal/assets/financeiro-v3/financeiro-v3-BGEmadke.js
 M Portal/financeiro-debug.css
 M Portal/financeiro-debug.html
 M Portal/financeiro-debug.js
 M Portal/financeiro-v3.html
 M Portal/financeiro.js
 D TELA_CENTRAL_VENDAS_V2.md
 D VENFORCE_V3_CONTEXT_MASTER_AUDIT.md
 M frontend-react/src/components/financeiro/NovoFechamento.jsx
 M server/controllers/fechamentosFinanceiroController.js
 M server/index.js
?? .agents/
?? .claude/
?? .codex/
?? .impeccable/config.json
?? .impeccable/critique/
?? .impeccable/live/
?? Central_vendas/
?? Portal/assets/financeiro-v3/financeiro-v3-DBDiY_Rs.js
?? Projeto_cliente360/
?? auditoria_cliente_convergencia/
?? docs/AUDITORIA_FECHAMENTO_PLANILHAS_REAIS_V1.md
?? docs/AUDITORIA_STACK_TECNOLOGICA_VENFORCE_SERVER.md
?? docs/CENTRAL_MARGEM_FRONTEND.md
?? docs/DESIGN.md
?? docs/IMPLEMENTACAO_DASHBOARD_CARTEIRA_PRONTIDAO.md
?? docs/IMPLEMENTACAO_DASHBOARD_VENFORCE.md
?? docs/Novo_mapeamento21ago.zip
?? docs/Novo_mapeamento21ago/
?? docs/VENFORCE_CLIENTE_OPERATING_MODEL_V1.md
?? docs/bakup/
?? docs/financeiro/
?? docs/mercado_pago/
?? docs/superpowers/
?? experiments/
?? server/controllers/fechamentoIncidentesController.js
?? server/repositories/fechamentoIncidenteRepository.js
?? server/routes/fechamentoIncidentesRoutes.js
?? server/services/fechamentoFinanceiro/incidente/
?? server/sql/migrations/20260910_fechamento_incidentes.sql
?? server/tests/detectarIncidenteFechamento.test.js
?? server/tests/fechamentoIncidentStorageService.test.js
?? server/tests/fechamentoIncidenteControllerIntegracao.test.js
?? server/tests/fechamentoIncidenteRepository.test.js
?? server/tests/fechamentoIncidentesController.test.js
?? server/tests/fechamentoIncidentesSeguranca.test.js
?? venforce_md_v2/
~~~

As exclusões e alterações acima já existiam. Em especial, Financeiro e server/index.js têm trabalho local em andamento. Nenhuma exclusão, alteração ou arquivo não rastreado dessa lista foi produzido por esta auditoria.

## Convenções de leitura

**FATO ATUAL** descreve código encontrado e conectado. **DECISÃO DE PRODUTO** descreve intenção humana. **GAP** indica o que separa ambos. **RECOMENDAÇÃO** é uma proposta deste plano, ainda sem implementação. Evidências usam “arquivo :: símbolo”, sem números de linha. Os caminhos são relativos à raiz do repositório.

# 1. Resumo executivo

A arquitetura de produto é viável, mas **não está pronta para ser implementada apenas compondo componentes existentes**. O investimento reaproveitável é significativo: resolução de conta, Shell, leituras da Central de Vendas, motores determinísticos da V2, componentes React e Full. Existem **7 bloqueadores críticos de contrato**, enumerados B01–B07 na seção 24.

O principal achado é preciso: **a Cliente 360 V2 não é account-aware**. Controller, ResultadoService e FechamentoAdapter não transportam clienteContaId. Na consulta real, ausência de conta significa **cliente_conta_id IS NULL**, e não a soma de todas as contas. Portanto a V2 pode deixar de enxergar snapshots novos corretamente vinculados e ler apenas o universo legado de identidade não comprovada. O teste chamado ReadinessMultiConta valida a lista operacional de clientes, não o resultado da V2. Evidências: server/controllers/cliente360ResultadoController.js :: obterResultado; server/services/cliente360/cliente360FechamentoAdapter.js :: lerPeriodo; server/services/centralVendas/centralVendasRepository.js :: condicaoContaSql; server/tests/cliente360ReadinessMultiConta.test.js :: run/getClientesOperacional.

Levar a conta aos argumentos é necessário, mas insuficiente: a Ponte reconstitui resultado por item com defaults numéricos e rateios próprios, enquanto a Central de Vendas preserva resultado indisponível quando faltam componentes. A reconciliação existente da V2 confronta principalmente faturamento de pedidos e itens; não prova paridade do resultado operacional. A nova 360 precisa de um universo canônico e testes financeiros que atravessem essa fronteira. Evidências: cliente360PonteEngine.js :: agregarProdutos; cliente360FechamentoAdapter.js :: reconciliar; centralVendasService.js :: buildResumoFromRange, todos sob server/services nos respectivos diretórios.

A Visão é **PARCIALMENTE confirmada como base técnica**: Shell, validação de conta e isolamento de falhas são bons pontos de partida. Seu endpoint atual mistura fontes por cliente e por conta, carrega integrações caras no mesmo request, possui links que perdem contexto e declara resultado account-scoped mesmo quando a Central de Vendas não resolve conta para marketplace não MELI. Deve-se reaproveitar o padrão, não promover o payload inteiro a contrato canônico.

**Recomendação executável:** evolução aditiva dos contratos de domínio e uma nova ilha isolada durante a migração, reutilizando a integração com Shell da Visão e a apresentação analítica da V2. Depois de paridade, autorização e cobertura funcional verificadas, o nome de produto pode convergir para Cliente 360. Não retirar V1 ou Cliente Operação antes de dar destino às capacidades exclusivas, especialmente revisão de custo Seller, entregas e históricos locais.

Squad ativo permanece no target aprovado P2.9. Deve pertencer ao Shell/contexto de sessão; a 360 herda esse contexto. Não deve se tornar substituto dos gates de autorização nem alterar o Squad principal persistido.

# 2. Veredito sobre a arquitetura proposta

**Veredito geral: PARCIAL — produto preservado, contratos e sequência de migração precisam adaptação.**

| Afirmação da proposta | Veredito técnico | Evidência e consequência |
|---|---|---|
| Página densa com trilho, blocos condicionais e drawers | DECISÃO DE PRODUTO viável | Nenhum requisito obriga redesenhar em abas. A implementação deve conservar contexto e carregar detalhes sob demanda. |
| Visão é a fundação técnica e “o contrato” | PARCIAL | server/services/visaoService.js :: obterVisao/bloco valida identidade e isola falha; não fornece fonte/confiança universais nem escopo exato em todas as fontes. |
| Componentes/motores V2 entram íntegros | PARCIAL | Componentes são reaproveitáveis por props; contrato de entrada, universos, ausência e paridade dos motores exigem adaptação. cliente360ResultadoService.js :: getResultado. |
| CV é account-aware | CONFIRMADO para o caminho MELI explícito; PARCIAL para o domínio todo | centralVendasService.js :: resolveRangeContext/resolveRangeImports só resolve conta quando marketplace=meli. |
| V2 já tem maturidade multiconta por existir teste | REFUTADO | cliente360ReadinessMultiConta.test.js só invoca getClientesOperacional. |
| Ads é account-aware | MISTO | mlAdsService.js :: resolverContextoConta é account-aware; adsService.js :: DDL/upserts mensais não é. |
| Basta rotular loja_campanha para mitigar Ads multiconta | REFUTADO como garantia técnica | Texto livre não é FK de conta/seller. “todas” agrega um universo sem identidade comprovada. |
| Financeiro V3 e entregas já conhecem conta | PARCIAL | Coluna e filtros existem; rows NULL permanecem legados, upload não comprova seller e listarEntregas omite payload_json usado na composição. |
| V2 substitui comparação A/B de entregas V1 | REFUTADO como equivalência | ComparacaoMensal compara métricas calculadas; V1 compara payloads de duas entregas/publicações. São objetos distintos. |
| V2 possui interface para executar diagnóstico e registrar ação | REFUTADO no React montado | Cliente360Page/cliente360Api não oferecem essas escritas; os endpoints existem em routers backend. |
| Não há ABC × margem baixa atual | PARCIAL | cliente360ProdutosEngine.js :: curvaAporFaturamento/montarProdutos já produz curvaARisco, mas sobre seu próprio universo e sem evidências da Central de Margem. |
| Oportunidade/simulação de corte de TACoS | REFUTADO como capacidade atual; exige outra decisão/modelo | RecuperacaoEngine não soma Ads; SimuladorEngine bloqueia campos de mídia. Testes cliente360Ads/Cliente360Page preservam a separação. |
| Full permite estoque/cobertura/reposição | CONFIRMADO com recorte próprio | fullRules puro + fullService. Estoque atual e operações dos últimos 14 dias; não snapshot da competência escolhida. Reposição é sugestão, sem endpoint de execução. |
| Placar mede recuperação comprovada | REFUTADO como prova causal | cliente360PlacarService.js :: getPlacar atribui variação M+1 por fator, pode repetir crédito e usa listas truncadas por produto. |
| me/portfolio sustenta carteira operacional | CONFIRMADO para prontidão; PARCIAL para fila financeira | server/services/meService.js :: obterPortfolio possui contas e readiness em lote, sem todo o ranking financeiro proposto. |
| Ausência atual de Squad ativo elimina sua implementação | REFUTADO | Squads_migration/VENFORCE_V3_P2_9_DECISOES_FINAIS_APROVADAS.md :: hierarquia aprovada exige o conceito no target. |
| Cliente Operação pode fornecer configuração real sem auditoria adicional | REFUTADO | Portal/cliente-operacao.js :: FALLBACK_CLIENTE/buildChannels/renderChannels possui fallback sintético e canais de preview renderizados. |
| Todos os aprofundamentos podem ser drawers baratos | PARCIAL | Pedido CV possui detalhe restrito por rowId; margem pode consultar APIs; Full usa snapshot/cache; faltam contratos compostos de produto. |
| “Financeiro ainda não sofreu cutover” em comentários/documentos | Não representa todo o atual | Portal/vf-shell.js :: registro de módulos/rotaPorMarketplace já direciona MELI/Shopee ao financeiro-v3. Preservar o roteamento real. |

A proposta é referência de produto, não aprovação automática para mudar fórmulas, permissões ou atribuir dados históricos a contas. Os wireframes com valores são ilustrações; não validam disponibilidade de uma fonte.

# 3. Estado atual vs target

| Tema | ESTADO ATUAL — FATO | ALVO APROVADO / proposta | GAP | IMPLEMENTAÇÃO NECESSÁRIA |
|---|---|---|---|---|
| Hierarquia | Role + memberships + principal; carteira autorizada é união quando enforcement está ativo | Role → memberships → Squad ativo da sessão → carteira desse Squad → Cliente → Conta → módulos | Squad ativo não é estado global implementado | Contexto de sessão no Shell; recorte validado com memberships sem trocar principal |
| Seleção | vf-context exige contexto; 0/1/N contas possuem comportamentos próprios; V1/V2 têm seletores independentes | Uma seleção Cliente+Conta | Entradas e defaults conflitantes | Integrar nova ilha ao Shell; nenhuma seleção arbitrária entre várias contas |
| Competência | Shell/Visão usam periodo; V2 usa competencia; CV usa dateFrom/dateTo | Conta+competência e comparação coerente | Tradução e validação dispersas | Resolver período canônico no servidor e adaptadores de URL |
| Resultado | CV e Ponte usam caminhos/cálculos diferentes | Um número explicado por uma ponte reconciliada | Paridade não demonstrada | Mesmo conjunto de snapshots e regras de computabilidade |
| Configuração | Clientes/contas/bases existem; operação monta visão legacy | Entender na 360; configurar no dono | Revisão Seller e alguns atalhos sem destino consolidado | Inventário de capacidades e deep-links com gates preservados |
| Legado | NULL de conta em várias tabelas | Operação identificada | Sem lineage histórico confiável | Migrações aditivas; legado explícito, sem atribuição automática |
| Histórico | Fontes diferentes e logs não tipados por conta | Linha do tempo contextualizada | Competência/autor/status heterogêneos | Composição tipada, preservando a semântica de cada evento |
| Placar | Apuração heurística no cliente | Proposta desloca para Carteira/Squad | Falta identidade e método auditável | Adiar crédito “comprovado”; preservar leitura histórica separada |

Evidências principais: Portal/vf-context.js :: estado/setCliente/setConta; Portal/vf-shell.js :: buildHref/linkParamsCliente360V2; server/services/meService.js :: obterContexto/obterPortfolio; server/services/squads/authorizationService.js :: resolvePortfolioClientes; documento P2.9 :: hierarquia e decisões finais.

# 4. Mapa das fontes e escopos

“Account-scoped” abaixo exige identidade validada e filtro efetivo na fonte. Receber conta na URL ou exibir seu nome não é suficiente.

| Domínio | Classificação HOJE | Conta + competência possível hoje? | Limite técnico / fonte |
|---|---|---|---|
| CV API/Read MELI | ACCOUNT-SCOPED, com compatibilidade legacy | Sim, conta explícita e snapshots atribuídos | resolveRangeContext → resolveImportsForRange; includeLegacy pode admitir NULL em cenário de uma conta ativa |
| CV não MELI | PRECISA MIGRAÇÃO | Não há isolamento completo comprovado | Conta não resolvida no caminho não MELI; consulta NULL-only |
| Cliente 360 V2 | CLIENT-SCOPED/LEGACY; PRECISA MIGRAÇÃO | Não | Adapter consulta slug+marketplace+mês sem conta; NULL-only |
| Cliente 360 V1 | MISTO | Só requisições específicas de métricas/Ads | Snapshot, diagnóstico, base, entregas e fallback continuam client-level |
| Visão | MISTO | Envelope valida conta; apenas alguns blocos a usam | Saúde/margem/entregas por cliente; resultado não MELI exige correção |
| Ads ao vivo MELI | ACCOUNT-SCOPED | Sim, range aceito e grant utilizável | resolveMarketplaceAccountContext; seller repassado às chamadas |
| Ads registro mensal | CLIENT-SCOPED / AMBÍGUO / PRECISA MIGRAÇÃO | Não | slug+mes_ref+loja_campanha não identifica conta |
| Full | ACCOUNT-SCOPED | Conta sim; competência histórica não | Estoque atual + duas janelas de 7 dias; cache por conta |
| Margem projetada | CLIENT-SCOPED na API; resolvedor interno parcialmente account-aware | Não pela API atual | motorMargemService não propaga conta; pode bloquear multiconta com 409 |
| Margem realizada | CLIENT-SCOPED/LEGACY | Não | centralVendasEvidenceAdapter sem conta lê imports NULL |
| Fechamento calculado CV | MISTO por marketplace | MELI atribuído sim | Não equivale a entrega/publicação |
| Upload Financeiro V3 | MISTO | Metadado opcional de conta e competência; conteúdo não prova seller | fechamentosFinanceiroController; arquivo enviado define universo |
| Entrega | MISTO | Coluna nullable; conta explícita permite recorte | listarEntregas inclui NULL por default quando há conta |
| Diagnóstico automático 360 | CLIENT-SCOPED | Não | cliente360DiagnosticoEngine/contexto legado |
| Relatórios de automações | MISTO/AMBÍGUO para composição histórica | Depende da lineage de base/relatório, não inferir conta | cliente360Repository busca via vínculos; não prova conta+competência |
| Bases/vínculos/custos | MISTO | Vínculo conta existe; custo pertence à Base | base_cliente_vinculos.cliente_conta_id nullable; base compartilhada não é erro por si só |
| Ações/intervenções | CLIENT-SCOPED / PRECISA MIGRAÇÃO | Não | cliente_360_acoes tem competência e marketplace, não conta |
| Sync runs CV | ACCOUNT-SCOPED com legado nullable | Range sim, competência derivada | run carrega conta, seller, grant, base, datas |
| activity_logs | AMBÍGUO para cliente/conta | Não de forma estruturada | details textual; não há colunas dedicadas no INSERT encontrado |

Fontes: server/services/centralVendas/{centralVendasService,centralVendasRepository}.js :: resolvedores; server/services/cliente360/* :: adapters e repositories; server/services/ads/{adsService,mlAdsService}.js; server/services/full/fullService.js; server/services/motorMargem/motorMargemService.js; server/services/entregasClienteService.js :: listarEntregas; server/services/activityLogService.js :: registrarLog.

# 5. Visão

## 5.1 Caminho real até runtime

frontend-react/visao.html → src/visao-main.jsx → src/pages/VisaoPage.jsx → src/hooks/useVfContext.js :: useOperacaoAtual → src/hooks/useVisao.js → src/services/visaoApi.js :: obterVisao → GET /operacao/visao/:cliente?conta=&periodo= → server/routes/visaoRoutes.js → server/controllers/visaoController.js → server/services/visaoService.js :: obterVisao.

A entrada e os assets são definidos por frontend-react/vite.entries.js e vite.config.js; o HTML entregue é Portal/visao.html. Usa vf-shell/vf-context, escopo account, sem migrar o Portal todo para React. server/index.js monta visaoRoutes em /operacao/visao.

Componentes reais sob frontend-react/src/components/visao: BlocoCard, SaudeOperacional, ResultadoPeriodo, MargemBloco, AdsBloco, FechamentoBloco, AtividadeBloco. Apoio: src/utils/periodoUrl.js e visaoLabels.js. O resultado usa dados.filteredSummary; usar o bootstrap cru produziria leitura errada de contrato.

## 5.2 Resolução e transporte

- Cliente vem do contexto resolvido pelo Shell; slug é transportado na rota.
- Conta vem de operacaoAtual; o request envia conta. resolverContaObrigatoria verifica inteiro positivo, pertence ao cliente e ativo. Marketplace é derivado da conta sanitizada.
- Backend aceita ausência de período e infere mês atual, marcando periodoInferido; rejeita inválido. Frontend lerPeriodoDaUrl substitui inválido/ausente por mês atual antes do request. Esse comportamento não equivale a um período obrigatório estrito.
- Hook usa AbortController e sequência para concorrência de requests. **INFERÊNCIA a partir do estado:** ao trocar um contexto válido por outro, mantém dados anteriores até a resposta; o cabeçalho do Shell pode já mostrar a nova conta. A nova ilha deve vincular payload ao contextKey e ocultar valores incompatíveis.
- Período do hook é estado inicializado pela URL; uma limpeza de URL feita pelo Shell não garante atualização desse estado React. Testar troca de cliente com mês selecionado.

Evidências: useVisao.js :: useVisao; useVfContext.js :: cache/listener vf:context/useOperacaoAtual; periodoUrl.js :: lerPeriodoDaUrl; visaoService.js :: resolverContaObrigatoria/resolverPeriodo.

## 5.3 Todos os blocos e dependências

| Bloco | Chamada real | escopoConta declarado | Escopo efetivo / ausência / custo |
|---|---|---:|---|
| Saúde | cliente360Service.getCliente360(slug, competência) | false | Client-level: resumos, grants, bases, relatórios, diagnóstico, Ads e entregas. GET chama ensure de schema; não é simples agregação barata |
| Resultado | centralVendasReadService.getCentralVendasReadBootstrap(slug, marketplace, conta, range) | true | Conta MELI comprovada; não MELI não está totalmente isolado. Carrega período inteiro internamente, embora a Visão use só filteredSummary |
| Margem | motorMargemService.obterResumo(slug, datas) | false | Apenas MELI; sem conta; resumo amostral com APIs externas |
| Ads | mlAdsService.buscarPerformanceML(slug, competência, null, conta.id) | true | Apenas MELI; conta real, API externa, retorno semDados ainda pode estar em bloco disponivel=true |
| Fechamento | entregasClienteService.listarEntregas(slug, tipo fechamento_mensal, limit 12) | false | Sem filtro de conta; filtra competência após limitar; prefere publicado/recente. Pode selecionar entrega de OUTRA conta do mesmo cliente |
| Atividade | centralVendasSyncRunService.listarSyncRuns(slug, conta, limit 10) | true | Conta real; sem filtro de competência, eventos recentes de outros meses podem aparecer |

obterVisao executa os seis em Promise.all. Falha individual vira indisponível, mas a latência total ainda espera a fonte mais lenta. A margem ou Ads externos podem atrasar todos os resultados.

## 5.4 Contratos honestos e contratos incompletos

bloco devolve disponivel/escopoConta/dados ou motivo. Não há status padronizado por ausência, erro, desabilitado e não aplicável; fonte, timestamp, versão e confiança não fazem parte de todos os blocos. Um retorno null pode ser “disponível” no envelope. Não é correto converter esses casos em zero.

Saúde exibe checklist incluindo frete, enquanto computeSetup do serviço pontua cinco sinais, sem frete. Rótulo “diagnóstico inicial” não transforma relatórios de automações em outro domínio. Comentários antigos de FechamentoBloco/visaoService sobre inexistência de coluna de conta estão superados pela migration de entregas; o problema atual é a chamada que não a filtra.

## 5.5 Deep-links reais

VisaoPage constrói links diretamente, fora do buildHref do Shell:

| Destino | Parâmetros atuais | Perdas / adaptação necessária |
|---|---|---|
| fechamentos-api.html | cliente, conta | Não leva competência/dateFrom/dateTo |
| central-margem.html | cliente | Perde conta e datas; módulo hoje não suporta conta end-to-end |
| anuncios-meli.html | cliente | Perde conta/mês; anúncios não equivalem ao acompanhamento mensal de Ads |
| financeiro.html | cliente | Perde conta/mês e ignora resolução atual de financeiro-v3 pelo Shell |
| próximo passo de Saúde | href da fonte legacy | Validar destino, identidade e gate antes de expor como ação contextual |

Não resolver isso acrescentando parâmetros que o destino ignora: cada destino precisa de teste de ida e retorno.

## 5.6 Testes e veredito

server/tests/visaoServiceComposicao.test.js e visaoPeriodoContrato.test.js cobrem composição/validação com dependências injetadas. frontend-react/src/pages/VisaoPage.test.jsx testa filteredSummary, null, escopo e falha parcial. Portal/visao-shell-ui.test.js verifica integração visual/Shell. Esses testes não provam SQL multiconta de cada serviço chamado nem coerência de todas as navegações.

**VEREDITO: PARCIAL.** Reaproveitar o acesso ao contexto, componentes simples e padrão de falha parcial. Adaptar carregamento, escopos, período e links. Não incorporar Saúde legacy, Margem atual e seleção de entrega como se fossem fontes account-scoped.

# 6. Cliente 360 V2

## 6.1 Mapeamento frontend e runtime

frontend-react/cliente-360-react.html → src/main.jsx → App → Cliente360Page; frontend-react/vite.entries.js :: entrada cliente-360-react gera Portal/cliente-360-react.html e assets próprios. Host usa layout.js, diferente da integração Shell da Visão. CSS: src/styles/cliente360.css, fundação compartilhada do Portal; utilities currency/numbers/percentage/dates/cenario.

useCliente360 lê slug, competencia, compararCom, marketplace e margemAlvo; cliente360Api usa /operacao/cliente-360. O hook carrega lista de clientes e pode escolher lista[0].slug. Não possui clienteContaId no estado nem no contrato HTTP. O mês padrão do frontend é o anterior fechado; helpers do backend têm fallback próprio. Não unificar esses defaults por acidente.

server/index.js monta cliente360ResultadoRoutes antes de cliente360Routes no mesmo prefixo. O router de resultado monta resultado, simular, elasticidades, placar e ações; o legacy monta lista de clientes, cockpit antigo, diagnósticos, frete e oportunidades antigas. Nome de namespace compartilhado não significa fonte compartilhada.

## 6.2 Componentes e maturidade

| Componente/capacidade | Entrada e comportamento atual | Reaproveitamento / gap |
|---|---|---|
| Cliente360Header/Filters | Cliente e filtros próprios; sem conta | Reaproveitar rótulos; substituir seleção pelo Shell |
| FechamentoResumo | fechamento.atual, resultado operacional e indicadores | Adaptar props ao resumo canônico e declarar receita computável |
| ComparacaoMensal | atual/anterior/variações; indicadores operacionais | Reutilizar tabela; não substitui comparação de entregas |
| PonteResultado | Linhas, decomposição, fórmula, produtos, resíduo | Reutilizar interação; drawer e contexto novos |
| ProdutosImpacto | Listas top que ajudaram/prejudicaram | Não usar top truncado como universo composto |
| ProdutosNegativos | Produtos de resultado negativo | Nome concreto da capacidade “ProdutosNoVermelho” |
| ProdutosAbaixoMeta | Produtos abaixo de margem-alvo | Meta V2 default 15%, distinta da Margem |
| OportunidadesRecuperacao | Oportunidades/total do motor | Não tratar cenários sobrepostos como ganho somável |
| SimuladorResultado | Perfis/cenário, request server-side | Conta, lineage, limites e carregamento sob demanda necessários |
| ConfiancaDados | Coberturas, reconciliação e pedidos problemáticos | Reusar apresentação, separar atual/comparabilidade e preservar rowId |
| AdsFechamento | Ads atual/anterior, fonte, motivo, TACoS/resultados após Ads | Não sabe a conta; depende integralmente do serviço |
| PlacarConsultor | Busca sob demanda; interface admin | Fora do novo dossiê segundo produto; método ainda heurístico |
| DataTable/Loading/Empty/Error | Primitivos de apresentação e estados | Reuso após conferência de semântica/acessibilidade |

Não há formulário React de registro de intervenção ou execução de diagnóstico em Cliente360Page/cliente360Api. Há APIs de escrita no backend e ações na V1. Corrigir o inventário funcional antes de aposentar qualquer tela.

## 6.3 Contrato de CADA serviço/engine conectado

Todos os arquivos desta tabela estão em server/services/cliente360/. “Puro” significa cálculo sem acesso próprio ao banco; **não significa que a entrada foi isolada por conta**.

| Arquivo :: símbolo | ENTRADAS / FILTROS | FONTE / ESCOPO / dependência de ClienteConta | SAÍDA | MATURIDADE / TESTES lidos |
|---|---|---|---|---|
| cliente360ResultadoService.js :: createResultadoService/getResultado | slug, competência, comparação, margemAlvo, marketplace livre | Cliente repo; adapter atual/anterior + Ads atual/anterior. Nenhuma conta | cliente, período/comparação, fechamento, ponte, produtos, oportunidades, confiança, narrativa, perfis | Orquestração real; cliente360Resultado/Ads/Contratos. Falta integração conta→SQL e paridade |
| cliente360FechamentoAdapter.js :: createFechamentoAdapter/lerPeriodo | cliente, range, marketplace | getCentralVendasByRange sem conta nem includeLegacy: somente imports NULL; buildPayloadFromRange | pedidos normalizados, totais operacionais, reconciliação, metadados | Adapter real; testes injetam repo/build; Contratos também verifica exports reais |
| cliente360FechamentoAdapter.js :: reconciliar/totaisOperacionais | pedidos/itens/ajustes/range | Mesmo universo legacy; status elegíveis | Faturamento detalhe versus pedidos; diferenças/ajustes; contagens/ticket | Não prova identidade ou reconciliação do resultado da Ponte com CV |
| cliente360PonteEngine.js :: agregarProdutos/montarPonte/totaisDoPeriodo | pedidos atuais/anteriores, ajustes, materialidade | Pure; universo recebido, key MLB→SKU→sem-produto; sem conta | Fatores preço/volume/mix/custo/frete/comissão/imposto/ajustes; perfis e impactos | Determinístico; cliente360Ponte/Resultado. Falta semântica de bloqueados e lineage |
| cliente360ProdutosEngine.js :: montarProdutos/curvaAporFaturamento | ponte/perfis, margemAlvo e topN | Pure; mesmos pedidos do adapter | ajudaram/prejudicaram top5; negativos e abaixo da meta até20; curvaARisco até10; contagens | Algoritmo existente, usa curva A própria. Testes Resultado/Ponte não provam composição CV+Margem |
| cliente360ConfiancaEngine.js :: coberturaPeriodo/avaliarConfianca/classificar | pedidos dos dois períodos, reconciliação atual, ponte | Pure; confianca/statusCustos/statusFrete dos pedidos, sem conta | nível, coberturaResultado/custo/frete, receita/pedidos bloqueados, alertas, top15 pedidos | Fórmulas explícitas; Resultado/Ponte. Conflui atual e anterior; falta rowId canônico |
| cliente360RecuperacaoEngine.js :: avaliarRecuperacao | ponte, produtos, confiança/meta | Pure; operacional do mesmo universo, não Ads | perdas por fator, gaps margem top10, negativos, mix perdido, alertas | Determinístico; Resultado/Ads. Oportunidades podem se sobrepor |
| cliente360NarrativaEngine.js :: gerarNarrativa/gerarLeituraAds | fechamento, ponte/produtos/oportunidades/confiança e Ads separado | Pure; nenhuma IA/API | Texto reproduzível e leitura descritiva Ads | Reutilizável depois da paridade; não prova causalidade |
| cliente360AdsService.js :: createAdsService/getInvestimento/montarBlocoAds | slug/range; sem marketplace/conta no investimento | Preferência resumo mensal “todas”, fallback ML ao vivo sem conta | investimento/fonte/status/motivo, comparação, TACoS, resultado/margem após Ads | Testes cliente360Ads; multiconta e marketplace incompatível permanecem gaps |
| cliente360SimulacaoService.js :: createSimulacaoService/simular | slug, competência, marketplace, cenário, elasticidades | Reconstrói pedidos via mesmo adapter sem conta; Ads sem conta | antes/depois, deltas, avisos, cenário server-side | Não escreve; testes Resultado/Ads/Contratos. Cliente pode fornecer elasticidades sem provenance |
| cliente360SimuladorEngine.js :: simular/aplicar/totalizar | ponte._perfis.map1; intervenções por MLB; elasticidades; Ads constante | Pure, universo atual; defaults numéricos da Ponte | What-if preço/custo/frete/volume/pausa e resultado; campos Ads ignorados com avisos | Modelo linear local; não executa preço/pausa real. Testes preservam Ads constante |
| cliente360SerieService.js :: getSerie/getElasticidades | slug, marketplace, referência e meses (controller 2–24) | Leituras sequenciais de N competências do mesmo adapter sem conta | Série mensal por produto e estimativas | Funcional, custo cresce por mês; falta cache/account lineage |
| cliente360ElasticidadeEngine.js :: estimarElasticidades | Série quantidade/preço | Pure; regressão log-log; mín.3 meses e 2 preços distintos | elasticidade, R², amostras/status; clamp [-5,0] | R² <0,5 é fraco; positivo suspeito. Comentário de três preços não descreve a condição real |
| cliente360PlacarService.js :: createPlacarService/getPlacar | slug, marketplace, horizonte; ações | listarAcoes; Resultado M→M+1; sem conta | Créditos por ação/fator e legado Ads separado | Heurística, pode duplicar crédito e perder produto fora do top; não prova resultado verificado |
| cliente360AcoesRepository.js :: registrarAcao/listarAcoes/removerAcao/marcarCredito | slug, marketplace, competência, fator/tipo, MLB, autor, valores | SQL cliente_360_acoes; sem conta | Linhas de ações; crédito pode ser atualizado por função exportada | listarAcoes captura qualquer erro e devolve []; marcarCredito não tem chamador encontrado |
| cliente360Periodo.js :: resolverPeriodos/normalizarCompetencia/rangeDaCompetencia | competência, comparação e relógio | Pure, America/Sao_Paulo; limita comparação ao nº de dias quando atual parcial | ranges inclusivos/dias/labels | Validação regex aceita mês “13”; default backend distinto do front; usar validador canônico |
| cliente360Service.js :: montarContexto/getCliente360/getClientesOperacional | slug, competência; lista operacional | Repo client-level: snapshot, grants, bases, relatórios, entregas, Ads | Cockpit legacy, saúde, prontidão por conta só na lista | Não é fonte account-scoped do Resultado V2; Capacidades/Readiness |
| cliente360SyncService.js :: sincronizarResumoMensal | slug, competência, requestedBy | metricasService sem conta + Ads mensal + relatório; INSERT/UPDATE resumo client-level | Snapshot mensal e job de sync legacy | Escrita admin, diferente de sincronização da CV; Capacidades |
| cliente360DiagnosticoEngine.js :: avaliarRegras/persistirDiagnostico | Contexto legacy e autor | Regras puras + persistência de diagnóstico separado; sem conta | Score saúde, itens, oportunidades/recomendações | Capacidade existente; não equivale a diagnóstico por item/account da Margem |
| cliente360DataQualityService.js :: avaliarQualidadeDados | bases, grant, relatórios, entregas, itens, período | Client-level em memória; timestamps e período textual | Score100 menos penalidades, flags/problemas | Não é ConfiancaEngine V2; há mismatch criadoEm/created_at |
| cliente360CoberturaService.js :: montarCoberturaBaseFaturamento | Snapshot topProdutos e relatório/itens | MLB exato; SKU único fallback; snapshot client-level truncável | Cobertura de faturamento, ranking/matriz, confiança | Dependência da qualidade e data do diagnóstico; não é ABC full-universe |
| cliente360FreteHistoricoService.js :: leitura do histórico por cliente/período | slug, competência/item/SKU | cliente_360_frete_historico, sem conta | amostra/faixa/média/confiança ou sem_amostra | Não constitui frete conciliado de pedido; não projetar onde não há amostra |

Para métodos internos não exportados, ler também o factory que os fecha: o ponto relevante é a assinatura efetivamente chamada, não o comentário de cabeçalho.

## 6.4 Dez respostas críticas de conta

| Pergunta | Resposta | Evidência |
|---|---|---|
| 1. ResultadoService recebe clienteContaId? | **REFUTADO** | createResultadoService/getResultado e obterResultado não o transportam |
| 2. FechamentoAdapter recebe? | **REFUTADO** | lerPeriodo(cliente, range, marketplace); getCentralVendasByRange sem conta |
| 3. ProdutosEngine trabalha por qual universo? | **CONFIRMADO:** perfis da Ponte, provenientes de imports sem conta | montarProdutos → ponte._perfis; condicaoContaSql NULL-only |
| 4. Ponte trabalha por qual universo? | **CONFIRMADO:** pedidos do adapter atual/anterior elegíveis por status; não seleciona conta por si | agregarProdutos/montarPonte |
| 5. Confiança trabalha por qual universo? | **CONFIRMADO:** mesmos pedidos legacy, ambos os meses | avaliarConfianca/coberturaPeriodo |
| 6. Recuperação trabalha por qual universo? | **CONFIRMADO:** perfis/fatores/produtos da mesma Ponte | avaliarRecuperacao |
| 7. Simulador reconstrói pedidos de qual conta? | **REFUTADO que seja da conta ativa.** Nenhuma conta identificada | SimulacaoService → adapter. Conta originária real dos NULL: NÃO DETERMINÁVEL |
| 8. AdsFechamento sabe qual conta está ativa? | **REFUTADO** | Componente recebe bloco pronto; AdsService.getInvestimento sem conta |
| 9. Marketplace livre ou derivado? | **CONFIRMADO: livre/default meli na V2** | Controller/ResultadoService; não deriva de ClienteConta |
| 10. Onde pode misturar duas contas do mesmo cliente? | **CONFIRMADO o risco**, não comprovada ocorrência em dados reais | Ads mensal “todas”; ações client-level; snapshots NULL de origem desconhecida; V1 combina Ads da conta com faturamento client-level. Não dizer que SQL da V2 faz UNION das contas explícitas |

## 6.5 Riscos matemáticos que antecedem a migração

1. **Bloqueio versus zero:** agregarProdutos converte faltantes numéricos em zero e recalcula contribuição por item. CV pode manter pedido.resultado=null. Exemplo analítico derivado do código, não executado: item com receita 100 e custo ausente não autoriza presumir contribuição 100. Reutilizar somente a álgebra da ponte sem suas regras de computabilidade perpetua esse problema.
2. **Rateio distinto:** Ponte rateia comissão/frete pelo faturamento; o ledger CV possui componentes e comissão por item. Resultado total pode até coincidir e impacto por produto divergir.
3. **Comparação insuficiente:** getResultado usa um gate para ponte/produtos/oportunidades quando falta comparação ou confiança. Isso pode esconder problemas reais do mês atual, como produtos negativos. Separar disponibilidade “resultado atual”, “composição atual” e “comparação”.
4. **Recuperação sobreposta:** corrigir custo e atingir margem-alvo sobre o mesmo produto não são dois ganhos independentes. Não exibir soma como promessa; definir grupos de exclusão/cenários.
5. **Simulação:** imposto unitário permanece observado enquanto comissão acompanha preço; resposta de volume é linear q×(1+elasticidade×variação). Não é recalcular tributos/fee futuros com garantia fiscal. Registrar premissas e avisos; cenário neutro deve reconciliar com base.
6. **Elasticidade:** correlação mensal não isola preço de mix, sazonalidade, ruptura ou Ads. Não rotular estimativa como causal; calcular no servidor com origem e versão. Atual fluxo busca seis meses automaticamente ao montar simulador.
7. **Crédito de ação:** listas truncadas e fatores repetidos não sustentam “ganho verificado”. Separar expectativa, observação e atribuição; nunca substituir confirmação humana pela variação simples.
8. **Períodos:** formato regex não valida calendário, e mês parcial de duração diferente é limitado ao último dia do comparado. O contrato deve devolver ranges efetivos; título “mesmo número de dias” não é sempre literalmente possível.

## 6.6 Evidência de testes: o que provam e o que não provam

cliente360Resultado.test.js/cliente360Ponte.test.js exercitam cálculos determinísticos e cenários preparados; cliente360Ads.test.js preserva Ads fora da ponte/recuperação e simulação de mídia. cliente360Contratos.test.js foi criado após falha real de export e testa imports default: reaproveitá-lo é importante, mas ele não substitui isolamento no repo.

Cliente360Page.test.jsx cobre loading, erro, ausência, ordem dos blocos, formatação, Ads separado, ponte expandida, cancelamento de request e placar. DataTable.test.jsx e utils/formato.test.js cobrem apresentação. Nenhuma dessas provas demonstra que conta A não lê B na query de resultado. O futuro teste deve executar controller/service/adapter/repo reais com DB fake que interprete o predicado de conta, e também teste de integração em banco descartável posteriormente autorizado.

# 7. Cliente 360 V1

Portal/cliente-360.html e Portal/cliente-360.js compõem um cockpit vanilla com CSS próprio e dependências de style.css, venforce-ui-v2.css e cliente-operacao.css. O seletor é próprio, persiste slug em localStorage, e não herda o contrato completo do Shell. A rota principal usa GET legado de Cliente 360 e busca contas ML à parte; não transforma o cockpit inteiro em leitura account-scoped.

Quando a chamada unificada falha, o frontend executa fallback amplo para entregas, vínculos de base, métricas, relatórios de automações, Ads e resumo de métricas. Isso não é restrito a 404. Há escolhas de primeiro item, matching por nome e comparação textual; relatório/base mais recente e Ads atual podem ser escolhidos sem identidade de conta. O seletor de conta melhora chamadas específicas de métricas/Ads, mas aplicar Ads de uma conta contra faturamento client-level é mistura de escopo. Evidências: Portal/cliente-360.js :: carregarCockpit/carregarContasMl360/aplicarAdsNoCockpit/computeSetup; server/services/cliente360/cliente360Service.js :: getCliente360.

A ação de sincronizar chama o sync legado de resumo mensal; ele usa metricasService e grava cliente_360_resumos_mensais por cliente+mês. Não é Central de Vendas sync, não cria snapshot de pedidos e não deve ser nomeada apenas sincronizar no novo dossiê. Evidência: server/services/cliente360/cliente360SyncService.js :: sincronizarResumoMensal.

| Capacidade V1 | Sobrevive? | Destino futuro | Backend reutilizável? | Front reutilizável? |
|---|---|---|---|---|
| Resumo/cockpit mensal | Parcial | Cliente 360, somente dado com escopo declarado | Parcial | Não como container |
| Sync de resumo | Sim, até substituir | Central de Vendas/Configurar operação | Adaptar ou aposentar após migração | Não |
| Entregas/lista/publicação | Sim | Histórico e módulo de Entregas/Financeiro | Sim, com conta/competência | Parcial |
| Comparação A/B de entrega | Sim | Histórico de entregas | Sim, preservando payload publicado | Adaptar |
| Custo Seller/revisão | Sim | Central de Margem/Base/Custos | Sim: sellerRoutes | Não |
| Bases | Sim | Configurar operação | Sim | Não |
| Diagnóstico/relatórios | Sim, escopo honesto | Saúde e módulo Diagnóstico | Parcial | Não |
| Métricas/Ads | Não como cópia | CV e Ads canônicos | Parcial | Não |
| Histórico local no navegador | Não | Não migrar | Não | Aposentar |

Informações exclusivas que exigem destino antes de desligar V1: revisão de submissão de custo Seller, comparação/publicação de entregas e atalhos operacionais. O histórico local não é auditável e não deve ser migrado como fato. A V1 não deve ser reutilizada como base técnica por fallback amplo, first-item assumptions e seleção independente.

# 8. Cliente Operação

Portal/cliente-operacao.html, Portal/cliente-operacao.js e Portal/cliente-operacao.css representam setup/configuração, não fonte canônica de análise. O código contém FALLBACK_CLIENTE, marcado mock, seleção de primeiro cliente/base/token/relatório, listas globais e canais de preview. buildChannels cria canais previstos; renderChannels os apresenta com ações como vincular base, copiar link ML e rodar diagnóstico. Evidências: Portal/cliente-operacao.js :: FALLBACK_CLIENTE/normalizarClienteWorkspace/buildChannels/renderChannels/buildPricingPreviewMock/buildFretePreviewMock.

O fallback de cliente e previews não inventam necessariamente uma métrica monetária, mas inventam contexto operacional suficiente para não poderem alimentar a Cliente 360. A pontuação de setup mistura estado de base, grant, diagnóstico e fechamento; token qualquer pode aparecer como grant, e histórico é sintetizado de timestamps de base/grant/relatório. Não é activity log.

| Classe | Conteúdo identificado | Destino |
|---|---|---|
| CONFIGURAÇÃO | ClienteConta, base vinculada, Grant/OAuth, canais, elegibilidade de base | Configurar operação, fora da 360 |
| ANÁLISE | Prontidão, pendências, resumo de diagnóstico | Saúde da 360, somente leitura/fonte declarada |
| LEGADO | Fallback, mocks, canais futuros, score sintético | Não reutilizar |
| AÇÃO ADMINISTRATIVA | OAuth, vincular base, criar/editar conta, desconectar grant | Módulos donos, gates preservados |

RECOMENDAÇÃO: Configurar operação deve conter metadados ClienteConta, status de Grant, vínculo/eligibilidade de Base e rotas administrativas. Deve excluir resultado, ponte, produtos, métricas e narrativa. A nova 360 mostra pendência e deep-link contextual; não embute esses fluxos.

# 9. Central de Vendas

FATO ATUAL: server/routes/centralVendasRoutes.js monta leitura para roles de automações e carteira; importação, sync, runs e settlement são admin. A Read API recebe clienteContaId, marketplace, dateFrom/dateTo e lê snapshots persistidos; GET não faz coleta externa. Bootstrap deriva resumo, linhas, diário e ABC a partir de uma reconstrução do período. O detalhe por rowId restringe importes/range e busca pedido/itens/componentes específicos, O(1) em número de pedidos do período na forma da consulta, sem garantia de latência constante do banco. Evidências: centralVendasRoutes.js :: rotas; centralVendasReadService.js :: getCentralVendasReadBootstrap/getOrderDetail; centralVendasRepository.js :: getPedidoDetailByRowId.

O contrato de filtros é assimétrico: summary é todo o universo, filteredSummary usa resumoFiltro, filtros de linhas/paginação são em memória e diário/ABC mantêm período inteiro. Não usar uma tabela filtrada para reconstruir KPI nem bootstrap como fonte de todos os drawers. CentralVendasService constrói componentes, status, cancelamentos/pós-venda, cobertura de campos e resultado computável; pedido com dados críticos ausentes pode preservar resultado nulo.

Sync run registra cliente, conta, seller, grant, base, faixa, requested_by, status, timestamps, erro e metadata. Completude é eixo separado: completed pode ser partial. Pedidos, shipments, claims e base são fontes estruturais; pagamentos não integram essa completude. Mercado Pago possui reconciliação separada por pagamentos, charges, movimentos e reports e expõe resultado conciliado sem sobrescrever resultado operacional. Evidências: centralVendasSyncRunService.js :: criar/listar/marcarRunCompleted; centralVendasSyncSourceService.js :: calcularCompletudeDoRun; centralVendasMp3ReadService.js :: getMercadoPagoReconciliationForRange; centralVendasMp3ResultadoConciliadoService.js :: computeOrderMpReconciliation.

Pode alimentar diretamente a 360, depois de normalização: contexto de snapshot, faturamento/pedidos/cancelamentos/ticket, resultado operacional computável, cobertura/completude, série diária, ABC por item, produtos e detalhe de pedido, além da reconciliação MP como bloco separado.

Não copiar para a 360: tabela completa de pedidos, todos os filtros operacionais, importação, execução de sync, runs detalhados, settlement e reconciliação por pagamento. A 360 oferece resumo e drawer/deep-link, não uma segunda Central de Vendas.

Limite multiconta: para MELI explícito, resolver contexto e filtrar importes é account-aware. Para marketplace diferente, o resolvedor não alcança o mesmo caminho; o uso deve ser bloqueado ou indisponível até contrato específico, não apresentado como conta.

# 10. Ads

Há dois domínios distintos. Ads ao vivo: server/services/ads/mlAdsService.js :: resolverContextoConta/buscarPerformanceML recebe clienteContaId, resolve conta MELI ativa e grant, passa seller às requisições ML; calcula investimento, GMV Ads, ROAS, ACOS, CTR, CPC e vendas como anúncios com total_amount positivo. A lista de advertiser escolhe um advertiser do seller; EVIDÊNCIA INSUFICIENTE para afirmar que múltiplos advertisers devem ser somados.

Ads de registro mensal/acompanhamento: server/services/ads/adsService.js e tabelas de resumo usam cliente_slug, mes_ref e loja_campanha. Não têm cliente_conta_id, seller ou marketplace. A chave todas não pode identificar uma conta quando existem duas MELI.

As rotas GET/PUT de acompanhamento/resumo são auth + requireAutomacoesAccess + carteira, não admin; modificar isso por conveniência da 360 seria alteração de produto/autorização. Evidência: server/routes/adsRoutes.js.

V2 AdsFechamento consulta preferencialmente o registro mensal todas; se não o encontra, tenta vivo sem conta e converte falha em indisponibilidade. Pode aplicar registro mensal MELI a leitura não MELI se o slug coincide, e em mês parcial pode subtrair investimento mensal integral. Não transportar esse bloco para V3 sem identidade da conta, intervalo comparável e status de completude.

O nível por anúncio existe na integração viva, mas não há contrato composto seguro com contribuição operacional. Não atribuir Ads a produto pelo título.

# 11. Full

Full é o domínio mais limpo para conta, mas não é fonte de competência mensal. server/routes/fullRoutes.js só expõe rotas se FULL_CENTRAL_ENABLED for exatamente true; desligada, a rota responde indisponível antes do uso normal. Controller e fullService resolvem cliente pela conta, não aceitam seller do browser. A página FullGestaoPage tem seletor próprio e deep-link clienteContaId, separado do Shell.

O snapshot consulta Full/ML, guarda cache por conta+janelade14 dias e mantém sucesso por três minutos; erro por quinze segundos; cache pode devolver stale. A janela termina no presente, usa duas janelas de sete dias, calcula tendência, ritmo de 30 dias equivalente, giro diário, cobertura, status e sugestão de reposição. Inventário é estoque atual; movimentos são cursorizados; detalhe encontra inventory no snapshot em memória. Evidências: server/services/full/fullService.js :: snapshot/detail/movements; fullCache.js; fullRules.js :: calculateTrend/equivalentThirtyDayPace/calculateCoverage/classifyOperationalStatus/calculateBaseReplenishment; frontend-react/src/pages/full/FullGestaoPage.jsx.

fullCommercialAdapter não verifica lineage comercial por padrão e retorna account_scope_unverified; não usar Full para cruzar margem/resultado até resolver essa condição. A 360 deve mostrar bloco condicional: flag desligada, capability/conta não aplicável, ou resumo cacheado com qualidade/data. Detalhe e movimentos ficam em drawer on-demand. Reposição é recomendação operacional; não há endpoint de envio/execução.

# 12. Margem

Central de Margem e motor não são atualmente account-scoped ponta a ponta. motorMargemService :: prepararWorkspaceContext/exigirContextoPronto recebe slug/base/datas; contexto de precificação já possui resolução de conta em contextoPrecificacaoService, mas o motor não propaga ClienteConta para leitura de vendas. centralVendasEvidenceAdapter :: carregarVendasDoPeriodo lê vendas por slug/range/marketplace sem conta, portanto realizados caem no legado NULL. Em multiconta, parte do resolvedor pode retornar ambiguidade 409 em vez de misturar; isso é preferível a escolher silenciosamente, mas não satisfaz a 360.

BaseCustosService prefere vínculo exato de conta a NULL; contextoPrecificacaoService foi testado para estreitar bases com conta explícita. Há uma brecha a revisar depois: validação de base informada valida cliente/marketplace/ativo, sem prova conclusiva de que a base pertence à conta selecionada. Evidências: server/services/automacoes/contextoPrecificacaoService.js :: resolverContextoPrecificacao/validarBaseInformada; server/services/bases/baseCustosService.js :: resolverBaseVinculada; server/tests/contextoPrecificacaoContaScoped.test.js.

Estados: UNVALIDATED, SUSPECT_DATA, LOSS, LOW_MARGIN, RECONCILING, HEALTHY. Confiança por item: HIGH/MEDIUM/LOW/UNKNOWN, pior evidência crítica; preço/frete/comissão podem ser projetados via ML, custos/realizados via Base/CV e settlement permanece não integrado. obterResumo percorre itens ativos em lotes e devolve média aritmética dos itens computáveis, misturando realizado/projetado; não é margem agregada de competência. Evidências: motorMargemService.js :: obterResumo; motorMargem/core/marginEngine.js; adapters de base, CV, ML e settlement.

Para cruzar impacto V2 + ABC CV + margem + problemas, criar adapter servidor que receba contexto de conta/período, produza identidade canônica e mantenha tipo de margem, evidências, status, confiança e motivos por produto. Não chamar Margem no navegador por linha e não converter estimativa atual em margem realizada histórica.

# 13. Financeiro / Fechamento

| Conceito | Fonte atual | Semântica |
|---|---|---|
| Fechamento calculado | Central de Vendas / resultado operacional / reconciliação MP | Cálculo de snapshots/componentes; pode estar parcial |
| Entrega publicada | entregas_cliente | Artefato editorial/payload, rascunho/publicado, token/expiração |
| Upload por planilha | fechamentosFinanceiroController + Financeiro V3 | Processamento de arquivo; conta/competência informadas não provam seller |

financeiroVisaoService exige conta válida, cliente correto e competência canônica. Seleciona entregas da conta e legadas NULL, com preferência conta/publicação/recência/id e declara ambiguidade. Relatórios permanecem deliberadamente mistos. É padrão útil de honestidade, mas entregasClienteService :: listarEntregas seleciona projection sem payload_json; financeiroVisaoService :: extrairComposicaoDoFechamento espera esse campo. A composição pode sair vazia em runtime mesmo com entrega existente. O teste injeta payload e não demonstra a projection real.

Entregas possuem cliente_conta_id nullable; sem backfill, NULL significa legado sem operação registrada, não qualquer conta. Há anti-duplicata na aplicação, mas DDL único não é comprovado nesta auditoria e período é VARCHAR livre. Evidências: server/services/{financeiroVisaoService,entregasClienteService}.js :: obterFinanceiro/listarEntregas; server/services/schema/schemaEnsure.js :: ENTREGAS_CLIENTE_DDL; migration de entregas conta.

Upload Financeiro V3 e mudanças em fechamentosFinanceiroController.js estavam no working tree inicial. Não foram alterados nem assumidos estáveis. Futuro contrato deve declarar origem, conta, competência, intervalo, cálculo/payload e publicação separadamente.

# 14. Confiança

As quatro confianças devem permanecer separadas:

| Medida | Fórmula/fonte | Escopo | Uso visual |
|---|---|---|---|
| Cliente 360 V2 | cobertura receita com resultado/custo/frete; pior período; divergência material | universo V2, hoje sem conta | Chip de resultado e drawer de pendências |
| Margin confidence | pior evidência crítica | produto/item | Chip por produto |
| Completude CV | fontes/sync run | conta+faixa | Selo do snapshot |
| Reconciliação MP | payment/charge/movement/settlement | conta MELI+faixa | Bloco financeiro separado |

ConfiancaEngine usa 0,90/0,70 e divergência material 0,005; não considera Ads. CV preserva campos computáveis e MP não sobrescreve resultado. Evidências: cliente360ConfiancaEngine.js :: avaliarConfianca/classificar; centralVendasSyncSourceService.js; centralVendasMp3ResultadoConciliadoService.js.

RECOMENDAÇÃO visual: quatro chips nomeados com fonte, e não um score geral. Um resumo de saúde só é permitido se listar dimensões, sem média inventada.

# 15. Produtos / cruzamento de fontes

| Fonte | Identificador | Cruzamento seguro | Limite |
|---|---|---|---|
| CV pedidos/ABC | MLB quando existe, pedido_row_id, SKU parcial | MLB na mesma conta/marketplace/período; rowId para drawer | Sem MLB vira sintético; SKU não é global |
| Ponte V2 | MLB, fallback SKU, sem-produto | Apenas MLB normalizado na mesma origem | Fallback não cruza externo |
| Margem | itemId/MLB, variação/inventory | MLB para item ML | Não inclui conta hoje |
| Base/diagnóstico | MLB; SKU fallback único | MLB; SKU só com unicidade explícita | Nunca título |
| Ads vivo | anúncio/listing | EVIDÊNCIA INSUFICIENTE para CV/ponte | Não JOIN por título |
| Full | account:inventoryId, MLB/variation | inventory exato; MLB se único | Ambiguidade é explícita |
| Ações | MLB opcional | Nenhum até incluir conta | Título livre é descrição |

RECOMENDAÇÃO: composição server-side por chave canônica clienteContaId, marketplace, produtoChave tipada e competência. Para MELI, MLB normalizado é o join inicial; variation/inventory são subidentidades Full. Retornar joinStatus matched, missing, ambiguous ou not_applicable. Se não houver chave segura, não compor.

# 16. Histórico / entregas / ações

| Registro | Fatos observados | Gap |
|---|---|---|
| cliente_360_resumos_mensais | cliente, slug, competência, métricas/payload/timestamps; cliente+mês | Sem ClienteConta |
| cliente_360_acoes | slug, marketplace, competência, fator, MLB opcional, valores, crédito, autor texto, created_at | Sem ClienteConta, item_id, estado, updated_at, autor FK, esperado/verificado formal |
| entregas_cliente | conta nullable, tipo/período/status/payload/created_by/timestamps/token | Legado indefinido, período livre, projection incompleta |
| central_vendas_sync_runs | conta/seller/grant/base/faixa/status/requested_by/timestamps/erro | Log técnico, não intervenção editorial |
| activity_logs | user/action/details/IP/status/timestamp | Details textual, sem cliente/conta/competência estruturados |

cliente_360_acoes não tem cliente_conta_id; não tem item_id, somente MLB opcional; tem autor texto e competência; não tem resultado esperado nem resultado verificado depois como campos distintos. credito_apurado/competencia_medida não comprovam verificação e marcarCredito não apareceu como fluxo integrado. Evidências: server/sql/cliente_360_acoes.sql; cliente360AcoesRepository.js :: registrarAcao/marcarCredito; activityLogService.js :: registrarLog.

RECOMENDAÇÃO: novo ledger de intervenção somente após decisão humana: conta obrigatória em linhas novas, produto-chave tipada opcional, autor FK/snapshot, expectativa, evidência/resultado observado, status e timestamps. Histórico legado fica client_legacy, sem atribuição automática.

# 17. Squads + contexto

| Tema | ESTADO ATUAL | TARGET P2.9 |
|---|---|---|
| Autorização de carteira | Memberships e enforcement; admin total; união possível | Permanece autoridade de acesso |
| Squad principal | Persistido | Continua principal, não é Squad ativo |
| Squad ativo | Não há store/resolvedor global | Obrigatório em sessão, descartado no próximo login |
| Carteira | Filtro/grupo de squad, sem recorte ativo global | Carteira do Squad ativo |
| Contexto | vf-context guarda cliente/slug/conta; período na URL | Cliente/Conta subordinados ao recorte ativo |
| Cliente 360 | Só usa contexto atual | Herda Squad do Shell, sem seletor próprio |

P2.9 aprovado descreve role → squads acessíveis → principal persistido → active session → carteira → cliente → conta → módulos. A ausência atual é GAP, não refutação. Evidências: Portal/vf-context.js; Portal/vf-shell.js; server/services/meService.js; server/services/squads/authorizationService.js; documento P2.9.

RECOMENDAÇÃO: Shell mantém activeSquadId na sessão/usuário, validado contra memberships. Troca de Squad cancela requests, invalida cache/drawers e remove Cliente/Conta fora do novo recorte, sem selecionar primeiro substituto. Autorização do endpoint continua por carteira/membership; Squad ativo é recorte de trabalho.

# 18. Autorização

| Ação | Endpoint/caminho | Gate atual | Quem pode hoje | Mudança necessária? |
|---|---|---|---|---|
| Sync CV | POST central-vendas sync-runs/sincronizar | auth + admin + carteira | admin | Não no primeiro corte |
| Diagnóstico legado | POST cliente-360 legado | auth + admin + carteira | admin | Definir dono antes de expor |
| Reconectar Grant | GET ml/conectar-conta/:id | público, state assinado, conta MELI ativa | Link compartilhável | Revisar compartilhamento |
| Vincular Base | PUT cliente-contas/:id/base | auth + admin + carteira | admin | Não |
| Revisar custo Seller | PATCH seller/custos-submissoes/:id | admin | admin | Deep-link |
| Registrar intervenção | POST cliente-360/:slug/acoes | auth + admin + carteira | admin | Novo ledger requer policy |
| Gerar/processar fechamento | POST fechamentos/financeiro | auth + automações + carteira | Roles internas | Preservar gate |
| Publicar entrega | POST entregas-cliente/:id/publicar | auth + automações + autorização por entrega | Roles internas | Não alterar sem decisão |
| Editar configuração | cliente-contas PATCH/PUT/DELETE | auth + admin + carteira | admin | Não |
| Criar ClienteConta | POST clientes/:cliente/contas | auth + admin | admin | Não |

requireAutomacoesAccess aceita admin/user/membro no caminho lido; interno não está comprovado nesse gate. Seller/reviewer não ganham Cliente 360 automaticamente. Capabilities devem vir do servidor; frontend não é autoridade.

# 19. Frontend / build

Vite compila ilhas isoladas: Cliente 360 V2, Full, Visão e Financeiro. Cada build preserva Portal com emptyOutDir falso, mas o script de cada ilha limpa os próprios assets antes de produzir novos. Não executar build nesta auditoria. Evidências: frontend-react/vite.config.js :: defineConfig; package.json :: scripts build; vite.entries.js.

| Alternativa | Avaliação | Decisão |
|---|---|---|
| Evoluir Visão | Bom Shell/contexto e blocos; payload atual heterogêneo | Arriscada se substituir rota em uso |
| Evoluir V2 | Bons motores/apresentação; sem Shell/conta | Arriscada para contexto/coexistência |
| Criar nova ilha | Isola rollout, CSS/assets/rollback e importa padrões de ambas | RECOMENDADA |
| Reescrever Portal/Shell | Sem justificativa técnica | Rejeitada |

RECOMENDAÇÃO: nova entrada/host Cliente 360, sem remover Visão/V2. Reusar useVfContext/evento do Shell, foundation CSS e componentes de tabela/estado; adaptar componentes V2 por props. Não importar CSS global V1/Cliente Operação. URL preserva cliente, conta, período canônico e foco de âncora; Shell é a única fábrica de links. Garantir retorno/deep-link de módulo dono.

# 20. Performance / estratégia de carregamento

| Classe | Conteúdo | Motivo |
|---|---|---|
| CARREGAR NO BOOT | Contexto validado, CV resumo atual/comparação, capabilities, saúde leve, histórico resumido | Necessário para a dobra e decisão |
| CACHE | CV bootstrap por conta/faixa/publicação; portfolio; Full snapshot por conta; resposta V3 curta | Evita recomposição e chamadas ML |
| LAZY | Ads vivo, Margem workspace/evidências, Full snapshot se aberto, elasticidade/simulador | APIs externas, lotes e custo variável |
| DRAWER ON-DEMAND | Pedido CV rowId, evidências Margem, inventário/movimentos Full, diagnóstico/entrega | Não carregar tabelas completas |
| NÃO CARREGAR NA 360 | Imports, worker sync, CV completa, settlement por pagamento, editor de base/custo, upload | Execução ou módulo profundo |

Hoje Visão usa Promise.all de seis blocos e espera ML Ads/Margem; V2 carrega atual/anterior, Ads e pode iniciar série de elasticidade; CV bootstrap carrega período inteiro; Full chama ML e tem cache curto. O contrato novo deve ser bootstrap pequeno + blocos lazy, não endpoint monolítico. Falha parcial ocorre por bloco e payload nunca reaproveita dado da conta anterior. Números de produção são EVIDÊNCIA INSUFICIENTE.

# 21. Contrato técnico alvo

RECOMENDAÇÃO, sem criar rota nesta missão:

GET /operacao/cliente-360-v3/:clienteSlug/bootstrap com conta, periodo e compararCom.

GET /operacao/cliente-360-v3/:clienteSlug/blocos/ads|margem|full|produtos|historico|simulador com os mesmos contexto e período.

Entrada obrigatória: slug ou id resolvido uma vez, clienteContaId obrigatório, período canônico obrigatório, comparação opcional validada. Marketplace vem de ClienteConta, nunca como filtro livre. O resolvedor retorna contextKey/versão e valida carteira. Deve recusar conta de outro cliente, inativa ou marketplace não aplicável, sem escolher uma conta.

Envelope de cada bloco:

| Campo | Semântica |
|---|---|
| disponivel | Fonte pode responder ao contexto? |
| motivo/codigo | Ausência, não aplicável, capability, falha ou ambiguidade |
| escopo | account, client_legacy, mixed_legacy ou not_applicable |
| fonte | nome, versão/publicação e geradoEm |
| confianca | tipo, nível e detalhes específicos |
| dados | Só valores que a fonte comprovou |

| Bloco | Fonte futura | Carregamento |
|---|---|---|
| contexto | cliente+conta+marketplace+período/capabilities | Boot |
| resultado | CV canônico | Boot |
| ponte | Ponte adaptada ao mesmo snapshot | Boot se computável |
| produtos | Adapter CV/ponte/margem | Lazy após identidade segura |
| oportunidades | Cenários operacionais | Resumo boot; detalhe lazy |
| Ads | Vivo ou mensal identificado por conta | Lazy |
| Full | Full snapshot | Lazy/capability |
| margem | Workspace/evidências | Lazy |
| confiança | Quatro dimensões | Resumo boot |
| saúde | Readiness/configuração | Boot leve |
| histórico | Entregas, ações, runs tipados | Lazy/paginado |

Bootstrap + lazy é preferível a endpoint único porque CV é banco intensivo e Ads/Margem/Full chamam API externa. Cada lazy recebe contextKey e cancelamento; cache inclui conta, período e versão de publicação.

# 22. Matriz de reaproveitamento

| Componente atual | Reutilizar | Adaptar | Aposentar | Motivo |
|---|---:|---:|---:|---|
| VisaoPage |  | Sim |  | Shell/contexto úteis; payload/links não |
| ResultadoPeriodo | Sim |  |  | Após resumo CV canônico |
| SaudeOperacional |  | Sim |  | Legacy precisa escopo/fonte |
| MargemBloco |  | Sim |  | Margem ainda client-level |
| AdsBloco |  | Sim |  | Boa ausência visual; falta conta |
| FechamentoBloco |  | Sim |  | Entrega não é fechamento calculado |
| Cliente360Page |  | Sim |  | Apresentação útil, seleção própria não |
| FechamentoResumo | Sim |  |  | Props canônicos |
| ComparacaoMensal | Sim |  |  | Operacional, não entrega A/B |
| PonteResultado | Sim |  |  | Só depois de paridade |
| ProdutosImpacto |  | Sim |  | Top truncado não é universo |
| OportunidadesRecuperacao |  | Sim |  | Sobreposição e ausência Ads |
| ConfiancaDados |  | Sim |  | Dimensões distintas |
| Simulador |  | Sim |  | Conta/provenance/premissas |
| Cliente 360 V1 |  |  | Sim como cockpit | Migrar capacidades, não UI |
| Cliente Operação |  |  | Sim como fonte | Reancorar somente configuração |

# 23. Source of truth de cada métrica

| Informação | Fonte canônica futura | Escopo | Motivo |
|---|---|---|---|
| faturamento | CV snapshot publicado/legado declarado | account | Pedidos persistidos |
| pedidos | CV | account | rowId/status |
| cancelamentos | CV | account | Regra explícita |
| ticket | CV | account | Mesmo universo |
| resultado operacional | CV computável + ponte reconciliada | account | Uma base, explicada |
| resultado após Ads | Resultado + Ads identificado | account | Não é lucro líquido |
| margem | Motor por item, tipo declarado | account quando adaptado | Realizada/projetada distintas |
| ABC | CV por item | account+competência | Universo de pedidos |
| impacto produto | Ponte adaptada | account+competência | Não UI |
| Ads | ML vivo ou mensal com conta | account | Fonte/versionamento |
| Full | Snapshot Full | account+janela | Estoque atual |
| Base | cliente_contas/base_vinculos | account/legado | Configuração |
| Grant | conta/token resolvedor | account | OAuth seller |
| diagnóstico | relatório/engine com escopo | client legacy até migração | Honestidade |
| fechamento calculado | CV/Financeiro calculado | account+competência | Cálculo |
| entrega | entregas_cliente | account/client_legacy | Publicação |
| confiança | Dimensões nomeadas | conforme fonte | Sem score fundido |
| histórico | Eventos tipados por fonte | account/client_legacy | Semântica preservada |

# 24. Gaps técnicos

## BLOQUEADORES TÉCNICOS

| ID | Bloqueador | Efeito | Saída mínima |
|---|---|---|---|
| B01 | V2/adapter/simulador/série não recebem ClienteConta; sem conta lê NULL | Resultado/ponte/produtos podem não representar operação | Propagar conta até repo e testar A/B/NULL |
| B02 | Ponte e CV não têm paridade de computabilidade/rateio demonstrada | Número e impacto podem divergir | Contrato/fixtures de reconciliação financeira |
| B03 | Ads mensal não tem conta/seller/marketplace | Mistura multiconta e TACoS errado | Nova identidade ou client_legacy |
| B04 | Não há adapter produto com chave/lineage segura | Cruzamento ABC/margem/impacto errado | Chave canônica e joinStatus |
| B05 | Margem/diagnóstico não são account-aware ponta a ponta | Blocos profundos não afirmam operação | Propagar contexto/separar legado |
| B06 | listagem de entrega omite payload esperado pelo Financeiro | Composição vazia/ambígua | Projection adequada/período canônico |
| B07 | V2 sem Shell/conta; Visão perde parâmetros/dado pode permanecer | Navegação/contexto incorreto | ContextKey/link factory/testes |

Gaps altos não bloqueantes: Full não é histórico da competência; Placar não é causal; activity_logs não é timeline tipada; imports não MELI não têm semântica account comprovada; role frontend não é capability.

# 25. Decisões humanas

| Pergunta | Opções | Impacto | Recomendação | Por que humana |
|---|---|---|---|---|
| Entrega pertence à conta? | Exigir nova; permitir ambas; migrar manualmente | Histórico/publicação | Nova por conta; legado client_legacy | Atribuição histórica é operacional |
| Ads mensal multiconta | Por ClienteConta; agregado cliente; descontinuar | TACoS/resultado após Ads | Nova chave por conta | Significado comercial |
| Meta margem | 10%, 15%, por conta/base/categoria | Oportunidades | Configuração versionada | Não é bug técnico |
| Placar | 360, Carteira/Squad ou pausar | Incentivo | Tirar do dossiê até método auditável | Crédito não é neutro |
| Intervenção | Admin; roles internas; workflow | Auditoria/autorização | Preservar admin até ADR | Responsabilidade |
| Diagnóstico | Cliente legado; conta; dupla transição | Saúde/histórico | Legado explícito, migração por conta | Processo/dado |
| Não MELI | Bloquear; contrato específico; client legacy | Escopo | Bloquear account não comprovado | Produto/integr. |
| Snapshots NULL | Legado; manual; excluir | Histórico | client_legacy | Banco não conhece origem |
| Nome/rota | Nova; substituir Visão; substituir V2 | Rollout | Nova durante coexistência | Lançamento |

# 26. Plano de implementação por fases

## Fase 0 — identidade, período e paridade

Objetivo: tornar ClienteConta/competência obrigatórias no Resultado V2/CV adaptado e provar paridade financeira. Vem primeiro porque B01/B02 bloqueiam todo número posterior.

Arquivos envolvidos: cliente360ResultadoController/Service/FechamentoAdapter/SimulacaoService/SerieService, centralVendasRepository/ReadService/Service, Ponte/Confianca e testes cliente360/CV.

Backend: resolver contexto uma vez, derivar marketplace, transportar conta e definir política NULL. Frontend: nenhum lançamento. Testes: A/B/NULL, outra conta, inativa, marketplaces, custo/frete ausente, multi-item, cancelado, ajuste, mês parcial. Dependência: decisão de legado. Risco: mudar resultado sem paridade. Aceite: novo contrato não lê outra conta e cenário neutro ponte=resultado na tolerância declarada. Rollback: endpoint/param aditivo, V2 atual preservada. NÃO FAZER: backfill automático, fórmula silenciosa, remover V1.

## Fase 1 — Shell e contrato V3

Objetivo: nova rota/ilha que herda cliente+conta Shell e bootstrap V3. Vem após Fase 0 para eliminar seleção própria sem carregar números não confiáveis.

Arquivos: vf-shell/vf-context/link params, nova entry/host Vite, useVfContext, route/controller/service V3. Backend: capabilities/contexto/resultado breve. Frontend: contextKey, loading/erro/trilho. Testes: troca cliente/conta/squad, URL, 403. Dependência: Fase 0. Aceite: contas não compartilham payload/cache. Rollback: feature flag/menu; URLs antigas seguem. NÃO FAZER: substituir Visão/V2.

## Fase 2 — resultado, ponte e confiança

Objetivo: migrar FechamentoResumo, ComparacaoMensal, Ponte e confiança operacional. Backend separa atual, comparação e indisponibilidade. Frontend reusa componentes com fonte/escopo e drawer rowId. Testes de paridade, ausência, comparação e acessibilidade. Dependência: Fases 0/1. Aceite: ponte e resultado fecham no mesmo universo. Rollback: feature flag de bloco. NÃO FAZER: Ads/Margem dentro da ponte.

## Fase 3 — produto composto e Margem

Objetivo: produto com ABC, faturamento, impacto, margem e problemas por chave segura. Arquivos: CV, Margem/adapters, Produtos e novo adapter V3. Testes: MLB repetida por conta, SKU ambíguo, item sem MLB, margem indisponível. Dependência: Fase 0 e meta aprovada. Aceite: nenhum JOIN por título. Rollback: ocultar margem mantendo CV. NÃO FAZER: API de margem por linha no browser.

## Fase 4 — Ads, Full e Saúde condicional

Objetivo: blocos independentes sem comparabilidade fictícia. Ads só por conta identificada; Full capability/flag; Saúde leve de escopo declarado. Testes: duas MELI, mês parcial Ads, flag Full desligada, stale/partial. Dependência: decisão Ads mensal. Aceite: falha de bloco não derruba bootstrap. Rollback: bloco/capability desligável. NÃO FAZER: somar Ads todas ou Full no boot.

## Fase 5 — Histórico, intervenções e configuração

Objetivo: timeline e CTAs aos módulos donos. Corrigir projection de entrega, definir ledger de intervenção aprovado e capabilities servidor. Testes: entrega conta/legado, duplicidade, matriz de autorização, autor/timestamps. Dependência: decisões de entrega/intervenção. Aceite: eventos trazem fonte/escopo/tempo e CTA respeita 403. Rollback: leitura/CTAs flagáveis. NÃO FAZER: migrar activity_logs textual como fato.

## Fase 6 — coexistência e aposentadoria

Objetivo: promover 360 após cobertura funcional. Manter contratos antigos, criar redirects testados e só retirar telas após matriz sem lacunas. Aceite: favoritos/deep-links e capacidades V1 têm destino. Rollback: menu/hosts antigos. NÃO FAZER: apagar hosts/tabelas/assets.

# 27. Mapa de execução para Claude Code

## FASE 0

LER: server/controllers/cliente360ResultadoController.js; services cliente360 ResultadoService, FechamentoAdapter, SimulacaoService, SerieService, PonteEngine, ConfiancaEngine; services centralVendas Repository, Service, ReadService.

ALTERAR PROVAVELMENTE: os serviços acima e rotas de resultado.

CRIAR PROVAVELMENTE: adapter/contrato account-scoped e fixtures multiconta.

TESTAR: cliente360Resultado.test.js, cliente360Ponte.test.js, cliente360Contratos.test.js, centralVendasGetAccountScoped.test.js, centralVendasM10ReadPerformance.test.js.

NÃO TOCAR: dados legados reais, backfill, hosts V1/V2.

## FASE 1

LER: Portal vf-shell/vf-context; frontend Vite entries/config; useVfContext/useVisao; visaoService.

ALTERAR PROVAVELMENTE: Shell/link factory, entries, context hook e rotas aditivas.

CRIAR PROVAVELMENTE: host/entrada Cliente 360 V3, hook, route/controller/service bootstrap.

TESTAR: visao-shell-ui, VisaoPage e novos contextKey/transição.

NÃO TOCAR: layout global/CSS V1, contrato visao existente.

## FASE 2

LER: FechamentoResumo, ComparacaoMensal, PonteResultado, ConfiancaDados e engines Fase 0.

ALTERAR PROVAVELMENTE: mappers V3/componentes.

CRIAR PROVAVELMENTE: drawer pedido/testes API/UI.

TESTAR: Cliente360Page, DataTable, cliente360Ponte.

NÃO TOCAR: fórmulas Ads, placar.

## FASE 3

LER: centralVendasReadService, motorMargemService, adapters margem, ProdutosEngine, Full identity.

ALTERAR PROVAVELMENTE: propagação conta Margem/componentes Produto.

CRIAR PROVAVELMENTE: produtoCompostoService/adapter e fixtures join.

TESTAR: motorMargemAdapters, contextoPrecificacaoContaScoped, centralVendas item/ABC.

NÃO TOCAR: JOIN por título, APIs externas no cliente.

## FASE 4

LER: mlAdsService/adsService, fullService/fullCache/fullRules/fullCommercialAdapter e blocos Visão.

ALTERAR PROVAVELMENTE: contratos Ads/Full/capabilities.

CRIAR PROVAVELMENTE: loaders/blocos V3 e registro Ads por conta se aprovado.

TESTAR: cliente360Ads, adsMetricasAccountContext, full testes.

NÃO TOCAR: Ads histórico sem decisão, flag Full.

## FASE 5

LER: entregasClienteService, financeiroVisaoService, cliente360AcoesRepository, activityLogService, rotas contas/seller/entregas.

ALTERAR PROVAVELMENTE: projection entrega, capabilities e ações conforme ADR.

CRIAR PROVAVELMENTE: histórico tipado/migration somente aprovada.

TESTAR: financeiroVisaoServiceComposicao, entregasClienteContaOperacao, authzEntregasCliente, testes intervenção.

NÃO TOCAR: linhas legadas sem policy.

## FASE 6

LER: vf-shell, hosts Portal cliente-360/visao/cliente-360-react e links V1.

ALTERAR PROVAVELMENTE: menu, redirects, flags.

CRIAR PROVAVELMENTE: testes navegação e guia rollback.

TESTAR: Shell/UI, favoritos/deep-links, matriz capacidades.

NÃO TOCAR: exclusão de hosts/tabelas/assets.

# 28. Testes e critérios de aceite

Fixture essencial: Cliente X com Conta A e B MELI, MLB/SKU iguais, imports publicados distintos e legado NULL. Cada endpoint V3 deve provar que A nunca retorna B e a política NULL é explícita. Incluir conta de outro cliente, inativa e usuário fora da carteira.

Fixture financeira: pedido multi-item, custo ausente, frete parcial, comissão por item, ajuste, cancelado/pós-venda e resultado MP. Verificar CV, ponte, confiança e produto composto; cenário vazio do simulador preserva a base.

UX: contextKey troca limpa números/drawers; URL mantém conta/período; indisponível explica sem zero; lazy falha isolado; deep-link aceita parâmetros; 403 não produz CTA enganoso.

Critério global: blocos exibidos têm fonte, escopo, atualização e disponibilidade; não existe JOIN por título; V1 só é desativada sem lacunas. Esta auditoria não executou testes.

# 29. Estratégia de coexistência / rollback

Manter Visão, V2, V1 e Cliente Operação acessíveis enquanto a nova rota estiver atrás de feature flag/menu controlado. V3 é aditivo; não mudar payloads existentes. Instrumentar erros/códigos/latência em ambiente autorizado, sem copiar dados entre contas.

Rollback: ocultar item/flag e voltar à rota anterior; snapshots, entregas e ações permanecem intactos. Migrations futuras são aditivas, nullable quando necessárias e sem backfill automático. Não publicar V3 como substituta enquanto Ads mensal, Margem ou entregas forem escopo misto sem rótulo.

# 30. Ordem recomendada de implementação

1. Aprovar escopo legado, Ads mensal, meta, intervenções e entrega.
2. Fase 0: identidade e paridade.
3. Fase 1: Shell + bootstrap V3.
4. Fase 2: resultado/ponte/confiança.
5. Fase 3: produtos/margem.
6. Fase 4: Ads/Full/Saúde.
7. Fase 5: histórico/intervenções/CTAs.
8. Fase 6: coexistência e eventual aposentadoria.

## Conferência final de integridade

Este documento é a única escrita desta auditoria. Alterações anteriores do working tree foram preservadas. A conferência final de status está abaixo.

~~~text
 D AUDITORIA_FECHAMENTO_PLANILHAS_REAIS_V1.md
 D BACKEND_V3_AUTHORIZATION_COVERAGE.md
 D BACKEND_V3_INITIAL_AUDIT.md
 D CENTRAL_MARGEM_FRONTEND.md
 D CODIGO_LEGADO_AUDITORIA.md
 D DESIGN.md
 D GUIA_PARA_IA.md
 D IMPLEMENTACAO_DASHBOARD_CARTEIRA_PRONTIDAO.md
 D IMPLEMENTACAO_DASHBOARD_VENFORCE.md
 D PRODUCT.md
 D Portal/assets/financeiro-v3/financeiro-v3-BGEmadke.js
 M Portal/financeiro-debug.css
 M Portal/financeiro-debug.html
 M Portal/financeiro-debug.js
 M Portal/financeiro-v3.html
 M Portal/financeiro.js
 D TELA_CENTRAL_VENDAS_V2.md
 D VENFORCE_V3_CONTEXT_MASTER_AUDIT.md
 M frontend-react/src/components/financeiro/NovoFechamento.jsx
 M server/controllers/fechamentosFinanceiroController.js
 M server/index.js
?? .agents/
?? .claude/
?? .codex/
?? .impeccable/config.json
?? .impeccable/critique/
?? .impeccable/live/
?? Central_vendas/
?? Portal/assets/financeiro-v3/financeiro-v3-DBDiY_Rs.js
?? Projeto_cliente360/
?? auditoria_cliente_convergencia/
?? docs/AUDITORIA_FECHAMENTO_PLANILHAS_REAIS_V1.md
?? docs/AUDITORIA_STACK_TECNOLOGICA_VENFORCE_SERVER.md
?? docs/CENTRAL_MARGEM_FRONTEND.md
?? docs/DESIGN.md
?? docs/IMPLEMENTACAO_DASHBOARD_CARTEIRA_PRONTIDAO.md
?? docs/IMPLEMENTACAO_DASHBOARD_VENFORCE.md
?? docs/Novo_mapeamento21ago.zip
?? docs/Novo_mapeamento21ago/
?? docs/VENFORCE_CLIENTE_OPERATING_MODEL_V1.md
?? docs/bakup/
?? docs/financeiro/
?? docs/mercado_pago/
?? docs/superpowers/
?? experiments/
?? server/controllers/fechamentoIncidentesController.js
?? server/repositories/fechamentoIncidenteRepository.js
?? server/routes/fechamentoIncidentesRoutes.js
?? server/services/fechamentoFinanceiro/incidente/
?? server/sql/migrations/20260910_fechamento_incidentes.sql
?? server/tests/detectarIncidenteFechamento.test.js
?? server/tests/fechamentoIncidentStorageService.test.js
?? server/tests/fechamentoIncidenteRepository.test.js
?? server/tests/fechamentoIncidentesControllerIntegracao.test.js
?? server/tests/fechamentoIncidentesSeguranca.test.js
?? venforce_md_v2/
~~~
