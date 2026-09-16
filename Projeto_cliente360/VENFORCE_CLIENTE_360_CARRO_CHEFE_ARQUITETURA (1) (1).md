---
type: plan
status: proposta — aguarda decisão humana
last_verified: 2026-09-09
source_commit: e2e2f201cfdd0e43923c23344cabb484a26db68b
working_tree_dirty: true
confidence: medium
---

- **Data:** 2026-09-11
- **Commit da documentação consultada:** `e2e2f20` · **Branch:** `feat/v3-client-create-with-squad` · **Working tree limpo?** não
- **Escopo:** arquitetura de produto/UX da Cliente 360 como superfície central, convergindo Visão + Cliente 360 V1 + Cliente 360 V2 + Cliente Operação, e definindo como Central de Vendas, Ads, Full, Margem, Diagnóstico, Financeiro e Bases a alimentam.
- **Modo:** read-only. **Nenhum código-fonte foi lido** — só o mapeamento canônico anexado.
- **Limites:** ver §0.2. Este documento é `Output/` — **nível 4** na hierarquia do [[AGENT_RULES]]. Não é source of truth.

---

# Cliente 360 como carro-chefe — arquitetura de produto

## 0. Base factual desta análise

### 0.1 O que eu li

Todo o `venforce_md_v2` anexado: `AGENT_RULES`, `PROJECT_OVERVIEW`, `CURRENT_STATE`, `ARCHITECTURE`, `PRODUCT_MAP`, `USER_ROLES`, `API`, `SERVICES`; as telas `00_INDEX`, `TELA_VISAO`, `TELA_CLIENTE_360`, `TELA_CLIENTE_360_V2`, `TELA_CLIENTE_360_V2_VUE_ORFA`, `TELA_CARTEIRA`, `TELA_FECHAMENTOS_API`, `TELA_FINANCEIRO_V3`, `TELA_CENTRAL_MARGEM`, `TELA_ADS`, `TELA_FULL_GESTAO`, `TELA_BASES`; os domínios `CLIENTES_E_CONTAS`, `SQUADS_E_CARTEIRAS`, `VENDAS_E_PEDIDOS`, `FECHAMENTO`, `ADS`, `BASES_E_CUSTOS`; os fluxos `SELECAO_DE_CLIENTE_E_OPERACAO`, `TROCA_DE_SQUAD_E_CARTEIRA`, `COLETA_DE_VENDAS`; e `VENFORCE_V3_P2_9_DECISOES_FINAIS_APROVADAS` (decisão humana, nível 2).

### 0.2 O que não recebi — e o efeito

| Faltou | Efeito real |
|---|---|
| `TELA_CLIENTE_OPERACAO.md` | tudo sobre Cliente Operação vem de terceiros (briefing §9, `PRODUCT_MAP`, `API`). **Não consigo inventariar as capacidades dela com o mesmo rigor das outras três.** |
| `TELA_DIAGNOSTICO_INICIAL.md` e `DIAGNOSTICOS.md` | a distinção entre os **dois** diagnósticos do sistema (§4, C-07) está derivada de `API` + `SERVICES`, não do domínio |
| `PRECIFICACAO_E_MARGEM.md`, `DATABASE.md`, `AUTH.md` | escopo exato do vínculo de Base e colunas de `cliente_360_acoes` ficam `PRECISA VALIDAÇÃO` |
| `AUDITORIA_CLIENTE_360_V1_V2_CLIENTE_OPERACAO.md` (nível 4, presente na rodada anterior) | onde uso um achado dela, marco como **não reverificado nesta rodada** |
| **Código-fonte** | o briefing o cita como evidência mais forte. Nada aqui foi verificado contra o código; toda afirmação é documental |

### 0.3 Como tratei a hierarquia

Segui a ordem do briefing §31. Onde decisão humana (nível 2) e mapeamento do código (nível 1/3) discordam, **registrei os dois lados separadamente** (§4) em vez de reconciliar. Há um caso grave disso, e ele afeta diretamente o cabeçalho da nova 360.

---

## 1. O que mudou em relação à proposta anterior

Confirmo cinco mudanças de entendimento. Três invalidam coisas que **eu mesmo propus na rodada anterior** — anoto isso explicitamente, porque um plano que não se corrige vira dívida.

**1. Visão deixa de ser "uma tela a convergir" e passa a ser a fundação técnica.** `TELA_VISAO` documenta `data-vf-scope="account"`, `clienteContaId` **obrigatório**, service que **nunca escolhe a conta sozinho**, composição server-side por blocos independentes e — o mais importante — cada bloco carregando `disponivel` e `escopoConta`. Esse é o único contrato honesto de escopo do produto. A hipótese do briefing §25 está certa e é mais forte do que parece: Visão não é só a primeira dobra, é **o contrato**.

**2. O problema não é número de telas. É número de escopos incompatíveis na mesma leitura.** Hoje, para o mesmo cliente e o mesmo mês, quatro superfícies podem mostrar números diferentes porque estão em escopos diferentes: Central de Vendas e Financeiro V3 são `scope=account`; Central de Margem é `scope=client`; Cliente 360 V2 navega por `slug` + `marketplace` sem conta (`linkParamsCliente360V2`); Cliente 360 V1 tem seletor próprio. Reduzir telas sem resolver escopo só esconde a divergência atrás de um layout melhor.

**3. Full, Curva ABC, série diária e conciliação Mercado Pago existem e são caras — e nenhuma proposta anterior as usava.** `full/fullRules.js` é motor puro com giro, cobertura em dias, ritmo equivalente 30d, classificação operacional e quantidade sugerida de reposição, e o snapshot é indexado por **`clienteContaId`** — é o módulo mais account-aware do sistema. A Read API da Central de Vendas entrega `/read/daily`, `/read/products` e `/read/orders/:rowId` em O(1). Deixar isso fora é desperdiçar a parte mais difícil do produto.

**4. ⟨correção do meu plano anterior⟩ Abas eram a estrutura errada.** Eu propus `Estado | Resultado | Produtos | Ads | Ação | Histórico`. Está errado para o uso real. O trabalho dominante desta superfície é **leitura narrativa antes de uma conversa** — a ponte explica o resultado, os produtos explicam a ponte, as oportunidades explicam o que fazer. `NarrativaEngine` gera texto **sem IA porque precisa ser reproduzível numa reunião** (`TELA_CLIENTE_360_V2`); isso diz qual é o uso. Abas quebram narrativa e forçam o operador a lembrar em que aba estava o número que ele quer mostrar ao cliente. A estrutura certa é **documento denso com trilho de âncoras**.

**5. ⟨correção do meu plano anterior⟩ "Camada Ação" como terceira aba era uma fila disfarçada.** O briefing §33 proíbe "transformar tudo em alerta" e §17 exige que oportunidade seja um **valor recuperável com produtos e causa**, não três alertas. Oportunidade não é um item de fila: é uma conclusão analítica que pertence ao lado do número que a originou. A fila pertence à Carteira (que já tem os dados para isso em `/me/portfolio`), não à 360.

E uma coisa que **não** mudou e deve ser preservada: a regra de que nenhum número aparece sem dizer seu escopo e sua fonte.

---

## 2. Por que `Cliente Hoje + Performance + Setup` ficou pequeno demais

Seis razões, em ordem de gravidade:

**(a) "Hoje" é um recorte que o sistema não produz.** Todo número do VenForce é de uma **competência**. `utils/competenciaCanonica.js` existe; `PERIODO_OBRIGATORIO` × `PERIODO_INVALIDO` existem justamente para **impedir o fallback silencioso para o mês atual** (Financeiro V3, BLOCO C). Uma tela chamada "Hoje" ou inventa um agregado que nenhum service calcula, ou é a competência corrente com outro nome. As duas opções são ruins: a primeira cria um motor novo, a segunda cria um sinônimo.

**(b) "Cliente Hoje" seria uma regressão de escopo.** Ela seria client-scoped, enquanto a Visão que ela substituiria já é account-scoped. Trocar uma superfície que sabe qual loja está lendo por uma que não sabe é andar para trás no problema mais caro do sistema (`MULTIPLE_MARKETPLACE_ACCOUNTS` existe como alias permanente e não pode nem ser renomeado — é quanto ele importa).

**(c) Chamar a V2 de "Performance" apaga a única coisa que ela faz e ninguém mais faz: explicar POR QUÊ.** `PonteEngine` (atribuição preço/volume/mix), `ElasticidadeEngine`, `RecuperacaoEngine`, `SimuladorEngine`, `ProdutosEngine`, `ConfiancaEngine` — seis motores puros e determinísticos. "Performance" é um rótulo de dashboard; o que existe ali é um **motor de atribuição de resultado**.

**(d) Setup não é uma intenção de leitura.** Ninguém acorda querendo "abrir o Setup". A pessoa quer o resultado, esbarra num bloqueio (`GRANT_DESCONECTADO` 424, `BASE_AUSENTE` 424) e precisa resolver. Setup como destino separado obriga a sair do contexto para depois voltar; setup como **estado sinalizado com ação no ponto onde o bloqueio aparece** resolve. O briefing §26 chega perto disso; eu vou além: o estado não vira uma seção, vira **uma faixa de bloqueio no topo, acima dos números que ele invalida**.

**(e) A proposta media sucesso em telas e o custo real está em outro lugar.** Depois dela, existiriam `Carteira → Visão → Cliente Hoje → Performance → Setup`. Uma tentativa de simplificar que adiciona duas camadas.

**(f) Não havia lugar para Full, ABC, série diária, conciliação MP e produtos por impacto.** Capacidades prontas, testadas e caras ficando fora da superfície principal.

---

## 3. Entregável 1 — mapa das capacidades reais

Escopo declarado como está **hoje**, não como deveria ser. `⚠️` = escopo que a nova 360 precisa corrigir.

| Capacidade | Onde existe hoje | Escopo | Maturidade | Serve à nova 360? | Como |
|---|---|---|---|---|---|
| **Resultado operacional** | `cliente360ResultadoService` + `PonteEngine` · `GET /operacao/cliente-360/:slug/resultado` | Cliente (slug) ⚠️ | alta | **sim — é o núcleo** | dobra 2, íntegra |
| **Faturamento** | `centralVendasReadService` (`/read/bootstrap`) · `visaoService.ResultadoPeriodo` | **Conta** (CV) / Cliente (V2) ⚠️ | alta | sim | dobra 1, com chip de fonte |
| **Pedidos** | `central_vendas_pedidos` · `/read` paginado · `/read/orders/:rowId` (O(1)) | **Conta** | alta | sim | KPI + drill em drawer |
| **Ticket médio** | `visaoService.ResultadoPeriodo` | **Conta** | média | sim | dobra 1 |
| **Cancelamentos** | `normalizePedidoStatus`, `STATUS_FORA_DO_RESULTADO` | **Conta** | alta | sim | dobra 1 + confiança |
| **Fechamento** | `cliente360FechamentoAdapter` (fonte de verdade = Central de Vendas) · `financeiroVisaoService` · `entregas_cliente` | Conta *nullable* ⚠️ | alta, **semântica ambígua** | sim | ver C-08; separar "calculado" de "publicado" |
| **Ads (ao vivo)** | `ads/mlAdsService` — ROAS, ACOS, GMV, investimento; códigos próprios (`NO_TOKEN`) | **Conta** (teste `adsMetricasAccountContext`) | média | sim | dobra Ads, **só meli** |
| **Ads (registro mensal)** | `ads_acompanhamentos`, `ads_resumos_mensais` | `cliente_slug` + `mes_ref` + `loja_campanha` ⚠️ | média | parcial | ver C-09 — não distingue Loja 1 de Loja 2 |
| **Margem** | `motorMargem/core/*` — status (`HEALTHY/LOW_MARGIN/LOSS/UNVALIDATED/SUSPECT_DATA/RECONCILING`), confiança como **classe com motivos**, meta MC 10% | **Cliente** ⚠️ e **só meli** | alta | sim | dobra Margem, escopo declarado |
| **Base / custo** | `base_cliente_vinculos` (tem `cliente_conta_id`), `custos` | Cliente **+ Conta** | alta | sim | faixa de estado + confiança |
| **Cobertura de custo** | `cliente360/CoberturaService` · `GET /operacao/base-cobertura` | Cliente ⚠️ | média | sim | confiança; ⚠️ endpoint só com `auth` (C-12) |
| **Grant** | `ml_tokens`, `grantStatus` em `/me/portfolio`, `mlTokenService` (refresh com advisory lock) | **Conta** | alta | sim | faixa de bloqueio (424) |
| **Sync / completude** | `central_vendas_sync_runs` + `_sync_sources`; `SOURCES`/`REQUIRED`/`STRUCTURAL` | **Conta** | alta | sim | confiança + estado |
| **Produtos (impacto)** | `ProdutosEngine` — ajudaram, prejudicaram, no vermelho, abaixo da meta | Cliente ⚠️ | alta | **sim** | dobra Produtos |
| **Produtos / Curva ABC** | `/read/products` (M9) | **Conta** | alta | **sim** | mesma dobra, cruzado |
| **Ponte de atribuição (PVM)** | `cliente360PonteEngine` | Cliente ⚠️ | alta | **sim — insubstituível** | dobra 2 |
| **Oportunidades de recuperação** | `RecuperacaoEngine` · `GET /:slug/oportunidades` | Cliente ⚠️ | alta | **sim** | dobra própria, com R$ |
| **Simulador** | `cliente360SimulacaoService` — **server-side**, reconstrói o perfil dos **mesmos** pedidos da ponte · `POST /:slug/resultado/simular` | Cliente ⚠️ | alta | sim | colapsado, ao lado das oportunidades |
| **Elasticidade** | `ElasticidadeEngine` · `/:slug/elasticidades` | Cliente ⚠️ | alta | sim | dentro do simulador |
| **Confiança dos dados** | `ConfiancaEngine` (**% do faturamento**) · `marginConfidence` (classe + motivos) · completude do sync | **três fontes diferentes** ⚠️ | alta | sim | ver C-08; apresentar, não fundir |
| **Diagnóstico (360)** | `cliente360DiagnosticoEngine` — determinístico, sem IA · `cliente_360_diagnosticos`, `_itens` · `POST /:slug/diagnostico-automatico` (**admin**) | Cliente ⚠️ | média | sim, resumido | dobra Saúde |
| **Diagnóstico Inicial** | `/operacao/diagnosticos-iniciais` — manual, onboarding, meli+shopee | Cliente | média | **não** — é outro produto | permanece módulo (C-07) |
| **Full — estoque/giro/cobertura/reposição** | `full/fullRules.js` puro · `GET /operacao/full/contas/:clienteContaId/snapshot` | **Conta** ✅ | alta | **sim, condicional** | dobra Full |
| **Full — movimentos por inventário** | `/inventories/:id` e `/movements` | **Conta** | alta | sim | drawer |
| **Histórico mensal** | `cliente_360_resumos_mensais` · `ComparacaoMensal` | Cliente ⚠️ | alta | sim | dobra Histórico |
| **Entregas ao cliente** | `entregasClienteService` — rascunho × publicado, `token_publico`, `expires_at` | Cliente (+ conta *nullable*) | alta | sim | dobra Histórico |
| **Relatórios** | `automacoes/relatorios`, `relatoriosService` (+ pastas, export) | Cliente | média | link | módulo profundo |
| **Conciliação Mercado Pago** | `/read/mercado-pago/reconciliation` + `resultadoConciliadoMp` | **Conta** | alta | sim, como confiança | não duplicar a Central de Vendas |
| **Responsáveis** | `cliente_responsaveis` (gestor/auxiliar/designer) — **organização, não autorização** | Cliente | alta | sim | dobra Cliente |
| **Carteira / portfólio** | `GET /me/portfolio` — contas, `grantStatus`, `baseVinculada`, `statusOperacional`, `pendencias`, `ultimaSincronizacao`, em **1 requisição** | Cliente + Conta | alta | **sim, mas na Carteira** | é a base da fila (§8) |

**Três conclusões que esse mapa impõe:**

1. **O sistema já é account-aware onde o dado é caro** (Central de Vendas, Full, Ads ao vivo, Financeiro V3, Visão) e **ainda é client-scoped exatamente onde a análise é mais rica** (todos os motores da Cliente 360 e o Motor de Margem). A convergência é, em uma frase, **levar a conta até os motores**.
2. **Existem três "confianças" e duas "coberturas"** com fórmulas legitimamente diferentes. Fundi-las seria destruir informação.
3. **Nada do que o briefing pede precisa de motor novo.** Precisa de escopo, composição e apresentação.

---

## 4. Entregável 2 — sobreposição das telas, e conflitos com a documentação antiga

### 4.1 Matriz de sobreposição

`✔` presente · `—` ausente · `~` parcial

| Informação / ação | Visão | 360 V1 | 360 V2 | Cliente Operação* | Outro módulo | Classificação |
|---|:--:|:--:|:--:|:--:|---|---|
| Seleção de Cliente | Shell V3 | seletor próprio | `?slug` | seletor próprio | Carteira | **DUPLICADO** — melhor fonte: Shell V3 |
| Seleção de Operação | ✔ obrigatória | ~ | — | ~ `[0]`* | Carteira | **MELHOR FONTE: Visão** |
| Faturamento / resultado do período | ✔ | ✔ | ✔ | — | Central de Vendas, Financeiro V3 | **DUPLICADO 3×** — melhor fonte: Central de Vendas |
| Lucro e margem de contribuição | ✔ | ~ | ✔ | — | Central de Margem | **COMPLEMENTAR** (agregado × por item) |
| Ticket, pedidos, cancelamentos | ✔ | ✔ `/metricas` | ~ | — | Central de Vendas | **DUPLICADO** |
| Ponte de atribuição (PVM) | — | — | ✔ | — | — | **ÚNICO — V2** |
| Produtos por impacto | — | ~ top MLB | ✔ | — | — | **MELHOR FONTE: V2**; V1 é LEGADO |
| Curva ABC | — | — | — | — | Central de Vendas `/read/products` | **ÚNICO — CV** |
| Produtos no vermelho / abaixo da meta | — | — | ✔ | — | Central de Margem (por item) | **COMPLEMENTAR** |
| Oportunidades de recuperação (R$) | — | ~ ações do diagnóstico | ✔ | — | — | **ÚNICO — V2** |
| Simulador + elasticidade | — | — | ✔ | — | — | **ÚNICO — V2** |
| Confiança dos dados | ~ por bloco | ~ | ✔ % faturamento | ~ | Margem (classe), CV (completude) | **COMPLEMENTAR — 3 medidas** |
| Ads (ROAS/ACOS/GMV) | ✔ | ✔ 3 endpoints | ✔ `AdsFechamento` | ~ acompanhamento | Ads | **DUPLICADO 4×** — melhor fonte: `/ads/performance` |
| Fechamento / competência | ✔ | ✔ | ✔ | — | Financeiro V3 | **DUPLICADO** — melhor fonte: Central de Vendas via adapter |
| Entregas / publicação | ~ | ✔ inclui DELETE | — | ✔ | Financeiro V3 | **MELHOR FONTE: Financeiro V3** |
| Comparação A/B de entregas | — | ✔ local | ✔ `ComparacaoMensal` | — | — | V1 **LEGADO**, V2 vence |
| Saúde / prontidão | ✔ `SaudeOperacional` | ✔ score 20 pts | — | ✔ score com pesos | `/me/portfolio` | **DUPLICADO 4×** ⚠️ |
| Grant / integração | ✔ | ✔ | — | ✔ | Clientes, ML Tokens | **DUPLICADO** |
| Base vinculada | ~ | ✔ lista | — | ✔ | Bases, Clientes | **MELHOR FONTE: Bases** |
| Cobertura de custo | — | ✔ | ~ confiança | ✔ | — | **COMPLEMENTAR** |
| Revisão de submissão de custo do Seller | — | ✔ **PATCH** | — | — | Seller | **ÚNICO — V1** ⚠️ |
| Sincronizar (admin) | — | ✔ POST | ✔ POST | — | Central de Vendas | **DUPLICADO** |
| Executar diagnóstico | — | ~ botão inativo* | ✔ POST admin | — | — | **ÚNICO — V2** |
| Placar do consultor | — | ~ | ✔ admin | — | — | **ÚNICO — V2** |
| Registro de ação/intervenção | — | ~ | ✔ `cliente_360_acoes` | — | — | **ÚNICO — V2** |
| Estoque Full, giro, reposição | — | — | — | — | Central Full | **ÚNICO — Full** |
| Histórico operacional de eventos | — | ✔ aba | — | ✔ | `activity_logs`* | **PRECISA VALIDAÇÃO** (C-10) |
| Atividade / sync runs | ✔ `AtividadeBloco` | ~ | — | — | Central de Vendas, Control Center | **MELHOR FONTE: Visão** |

\* Linhas marcadas sobre Cliente Operação e sobre o botão de diagnóstico da V1 vêm do briefing §9 e de um output nível 4 da rodada anterior; **não foram reverificadas** e `TELA_CLIENTE_OPERACAO.md` não chegou.

### 4.2 Conflitos entre documentação/intenção e o mapeamento atual

Registrados, **não reconciliados** (AGENT_RULES §3.3).

| # | Conflito | Lado A | Lado B | Impacto na 360 |
|---|---|---|---|---|
| **C-01** | **Existe "Squad ativo da sessão"?** | **Decisão humana P2.9 (nível 2):** `SQUAD ATIVO DA SESSÃO → CARTEIRA DESSE SQUAD → CLIENTE`. Briefing §4 repete isso. | **Mapeamento do código (nível 3):** *"⚠️ Não existe 'trocar de squad ativo' na sessão"*; a carteira é a **união** dos squads; squad é agrupamento e filtro na Carteira (D5/D7); `squadPrincipalId` é rótulo/ordenação | **alto.** Define se o cabeçalho da 360 tem seletor de Squad. Hoje, pelo código, **não teria**. Eu não invento o seletor. |
| **C-02** | **Visão deve absorver a Cliente 360?** | MASTER_SPEC antigo (citado no briefing §30): *"Visão absorve Dashboard + Cliente 360 + Cliente Operação"* | `TELA_VISAO` canônica: *"A Visão **não substitui** a Cliente 360 V2: nenhum bloco reproduz o motor de Resultado"* | médio. Resolvo mantendo os dois: Visão vira o **container**, V2 vira o **conteúdo** — nenhum dos dois é absorvido pelo outro |
| **C-03** | **Qual é o parâmetro de competência?** | V2 usa `competencia` | Shell V3 propaga `periodo` (`buildHref`); Visão e Financeiro V3 usam `periodo` | médio. **INFERIDO:** como `linkParamsCliente360V2` só declara `slug` e `marketplace`, navegar do Shell para a V2 **provavelmente perde o período**. Precisa auditoria |
| **C-04** | **A V2 é multiconta?** | `cliente360ReadinessMultiConta.test.js` existe | Nenhuma rota de `/operacao/cliente-360` documentada em `API` aceita `conta`; o gate é `carteira("slug")`; `linkParams` não passa conta | **crítico.** É a pré-condição de tudo. `PRECISA AUDITORIA DE CÓDIGO` |
| **C-05** | **Ads é account-aware?** | Domínio: *"Ads é account-aware"*, com teste | As tabelas são chaveadas por `cliente_slug` + `mes_ref` + `loja_campanha` — não por `cliente_conta_id` | alto para multiconta. Leitura ao vivo separa por conta; o **registro mensal da equipe não** |
| **C-06** | **A V1 deve morrer?** | Ideações anteriores e o próprio nome "legado" | `00_INDEX` e `TELA_CLIENTE_360`: ela foi **recuperada para o menu** por uma auditoria forense — ação humana recente e deliberada | médio. Aposentar a V1 é reverter uma decisão; exige que cada escrita dela tenha casa antes |
| **C-07** | **Existem dois "Diagnósticos"** | `cliente360DiagnosticoEngine` — determinístico, sobre dados de venda | `/operacao/diagnosticos-iniciais` — manual, de onboarding, com `gerar` e `concluir` | médio. O briefing trata "Diagnóstico" como um. São dois produtos diferentes; só o primeiro entra na 360 |
| **C-08** | **"Fechamento" e "confiança" têm 3 significados cada** | fechamento = período calculado (CV) / entrega publicada (`entregas_cliente`) / upload de planilha | confiança = % do faturamento (`ConfiancaEngine`) / classe com motivos (`marginConfidence`) / completude por fonte (sync) | **alto.** Um "número único" aqui seria um número mentiroso |
| **C-09** | Entrega vinculada à conta | `entregas_cliente.cliente_conta_id` existe (P2.6 D1), **nullable** | `periodo` é `VARCHAR(100)` livre; sem índice UNIQUE; unicidade só na aplicação | alto. Define se a entrega é por Cliente ou por Operação (decisão humana, §11) |
| **C-10** | `activity_logs` | `activityLogService` insere; `logsController` lê | **Não há DDL para ela em lugar nenhum do repositório** | alto. "Histórico operacional" pode não ter fonte |
| **C-11** | Full existe? | módulo completo, testado, 13 arquivos de teste | `router.use(requireFullCentralEnabled)` → **404 no namespace inteiro** sem a env; estado em produção **não confirmado** | alto. A dobra Full pode simplesmente não existir em produção |
| **C-12** | `GET /operacao/base-cobertura` | consumido por `cliente-operacao.js` | gate é **`auth` apenas** — sem role, sem carteira | achado de segurança colateral. Não usar esse endpoint na nova 360 sem revisão |

---

## 5. Entregável 3 — quatro arquiteturas reais

Todas partem do mesmo fundamento não-negociável: **`data-vf-scope="account"`, `clienteContaId` obrigatório, nenhuma escolha silenciosa de conta.** O que muda é o **modelo mental da leitura**.

### Modelo A — Dossiê: página única densa com trilho de âncoras

Uma superfície, ~9 dobras, trilho lateral fixo, dobras condicionais não renderizam.

- **Densidade:** ✓✓ máxima.
- **Clareza:** ✓ a ordem das dobras é a ordem do raciocínio.
- **Velocidade operacional:** ✗ para quem volta todo dia ao mesmo ponto, precisa rolar ou usar âncora.
- **Uso em reunião:** ✓✓ imbatível — é um relatório que se percorre.
- **Uso diário:** ~.
- **Multi-conta / multi-marketplace:** ✓ dobras somem quando não se aplicam.
- **Implementação:** ✓ montagem incremental dobra a dobra.
- **Reaproveitamento:** ✓✓ os componentes da V2 entram quase como estão.
- **Crescimento:** ✓ nova capacidade = nova dobra.

### Modelo B — Macro-tabs (3-4) com identidade única

`Operação | Resultado | Produtos | Histórico`.

- **Densidade:** ✓ por aba. **Clareza:** ✓✓ imediata. **Velocidade:** ✓✓ retorno direto.
- **Uso em reunião:** ✗ quebra a narrativa; obriga a lembrar onde está cada número.
- **Multi-conta:** ✓. **Implementação:** ✓. **Reaproveitamento:** ✓.
- **Crescimento:** ✗ toda capacidade nova vira disputa por uma aba, e o número de abas cresce — que é exatamente como se chegou a quatro telas.
- **Risco real:** as abas viram as telas de hoje com outro nome.

### Modelo C — Workbench de duas colunas

Leitura à esquerda; coluna direita **persistente** com contexto, confiança, oportunidades e ações.

- **Densidade:** ✓✓. **Clareza:** ~ (duas hierarquias competindo). **Velocidade:** ✓✓.
- **Uso em reunião:** ~ a coluna direita é interna e atrapalha ao compartilhar tela.
- **Implementação:** ✗ exige repensar todos os componentes da V2 para largura reduzida.

### Modelo D — 360 como camada sobre os módulos

Não há tela: um painel invocável de qualquer módulo, sempre no contexto atual.

- **Interessante** conceitualmente: elimina a viagem entre módulos.
- **Uso em reunião:** ✗✗ não existe destino para abrir.
- **Implementação:** ✗✗ exige que todos os módulos (inclusive os 13 do `layout.js` legado) falem o mesmo contexto. Impossível como Fase 1.
- **Guardar a ideia:** o *drill-down em drawer* do modelo vencedor é a parte boa do D, aplicada para dentro.

### Modelo E — **VENCEDOR** — Dossiê + Trilho + Drawer

A é a base, com duas regras que mudam o comportamento e que não são cosméticas:

> **Regra 1 — Entender nunca navega. Editar sempre navega.**
> Todo aprofundamento analítico (um pedido, um produto, uma evidência de margem, um inventário Full, um item do diagnóstico) abre em **drawer sobre o dossiê**, preservando posição, conta e competência. Só se sai da 360 para **escrever** em um módulo dono.
>
> Isso é viável porque os endpoints O(1) já existem: `/read/orders/:rowId` (M10, criado justamente para isso — a motivação medida foi 8,31 s de carga inicial), `/central-margem/itens/:itemId/evidencias`, `/full/inventories/:id/movements`.

> **Regra 2 — O trilho é o índice do raciocínio, não um menu.**
> Ele mostra as dobras **que existem para esta operação neste mês**, cada uma com seu estado (número-chave, indisponível com motivo, ou ausente por marketplace). O trilho é onde a pessoa que volta todo dia clica direto — resolve o único ponto fraco do Modelo A.

| Critério | A | B | C | D | **E** |
|---|:--:|:--:|:--:|:--:|:--:|
| Densidade | ✓✓ | ✓ | ✓✓ | ✓ | **✓✓** |
| Clareza | ✓ | ✓✓ | ~ | ✗ | **✓✓** |
| Velocidade operacional | ✗ | ✓✓ | ✓✓ | ✓ | **✓✓** |
| Uso em reunião | ✓✓ | ✗ | ~ | ✗✗ | **✓✓** |
| Uso diário | ~ | ✓✓ | ✓✓ | ✓ | **✓** |
| Multi-conta | ✓ | ✓ | ✓ | ✓ | **✓✓** |
| Multi-marketplace | ✓✓ | ✗ | ✓ | ✓ | **✓✓** |
| Implementação | ✓ | ✓ | ✗ | ✗✗ | **✓** |
| Reaproveitamento do que existe | ✓✓ | ✓ | ✗ | ✗ | **✓✓** |
| Crescimento futuro | ✓ | ✗ | ✓ | ✓✓ | **✓✓** |

**Escolho E.** Não por ser o meio-termo — por ser o único que serve às duas situações reais e incompatíveis em que essa tela é usada: **a reunião mensal** (leitura contínua, compartilhando tela com o cliente) e **a volta diária** (ir direto a um ponto e agir). Abas servem só à segunda; página longa pura serve só à primeira.

---

## 6. Entregável 4 — a recomendação, dobra a dobra

**Nome:** Cliente 360. Sem sufixo. `escopo = account`.
**Contrato de URL:** `?cliente=&conta=&periodo=&comparar=&foco=` — o contrato **do Shell V3**, não o da V2. `foco` é a âncora da dobra.
**Contrato de bloco (universal, herdado da Visão e do Financeiro V3):** todo bloco carrega `disponivel`, `motivo`, `escopoConta`, `fonte`, `confianca`. Um bloco que não pode ser calculado **diz por quê**; nunca mostra zero.

Legenda de prontidão: **EXISTE** · **PARCIAL** · **ADAPTAÇÃO** · **CONTRATO NOVO** · **FUTURO**.

---

### Dobra 0 — Contexto (fixo no topo, não é uma dobra do trilho)

- **Pergunta:** de quem, de qual loja e de qual mês eu estou falando?
- **Dados:** Cliente · Operação (com `externalAccountLabel`) · marketplace · competência · comparação · ações globais.
- **Fonte:** Shell V3 (`vf-context`), `GET /clientes/:cliente/contas`.
- **Escopo:** CLIENT + ACCOUNT.
- **Ação:** trocar operação · trocar competência · escolher comparação · `⚙ Configurar operação` · `⟳ Sincronizar` (admin).
- **Quando aparece:** sempre. Sem conta resolvida, a 360 **não renderiza números** — renderiza o seletor.
- **Prontidão:** **EXISTE** (o Shell já faz isso na Visão e no Financeiro V3).

### Dobra 0.5 — Faixa de bloqueio (condicional, acima de tudo)

- **Pergunta:** existe algo que invalida os números abaixo?
- **Dados:** `GRANT_DESCONECTADO` (424) · `BASE_AUSENTE`/`BASE_AMBIGUA` (424) · `CONTA_INATIVA` (409) · sync estrutural falhado (`orders`/`base`).
- **Fonte:** `erroContextoCanonico`, `mlTokenService`, `baseVinculosService`, `centralVendasSyncSourceService`.
- **Escopo:** ACCOUNT.
- **Ação:** reconectar (deep-link OAuth `/ml/conectar-conta/:clienteContaId` — **já é account-scoped**) · vincular base · abrir Clientes.
- **Quando aparece:** só quando há bloqueio. **Nunca** uma faixa verde de "tudo ok" — isso é ruído.
- **Prontidão:** **ADAPTAÇÃO** (os estados existem; falta compor numa faixa única).

> Isto substitui a "tela de Setup". O bloqueio aparece **onde ele dói**, com a ação ao lado, e o resto da página continua legível com os dados históricos preservados.

---

### Dobra 1 — RESULTADO DO PERÍODO *(a Visão, absorvida e evoluída)*

- **Pergunta:** quanto vendeu, quanto sobrou, e isso é melhor ou pior que o mês passado?
- **Dados:** faturamento · pedidos · ticket · cancelamentos · lucro de contribuição · MC% · resultado **antes** e **depois** de Ads · Δ vs. comparação · série diária.
- **Fonte:** `centralVendasReadService` (`/read/bootstrap`, `/read/daily`) · `visaoService.ResultadoPeriodo` · `cliente360FechamentoAdapter`.
- **Escopo:** **ACCOUNT**.
- **Ação:** trocar comparação; clicar num dia → drawer com os pedidos daquele dia.
- **Aprofundamento:** Central de Vendas (pedido a pedido).
- **Quando aparece:** sempre.
- **Prontidão:** **EXISTE** os números; **ADAPTAÇÃO** a série diária dentro da 360.

> A separação **resultado operacional × resultado após Ads** da V2 sobe para cá. É a distinção mais útil da tela e hoje está enterrada no meio da V2.

### Dobra 2 — POR QUE MUDOU *(ponte de atribuição)*

- **Pergunta:** o resultado mudou por preço, por volume, por mix, por custo, por frete, por comissão ou por Ads?
- **Dados:** ponte PVM com contribuição de cada fator em R$ · narrativa determinística.
- **Fonte:** `cliente360PonteEngine` + `NarrativaEngine` (`GET /:slug/resultado`).
- **Escopo:** **hoje CLIENTE ⚠️ → alvo ACCOUNT**.
- **Ação:** clicar num fator → filtra a dobra Produtos por aquele fator.
- **Quando aparece:** sempre que houver competência de comparação.
- **Prontidão:** **EXISTE** o motor; **ADAPTAÇÃO relevante de backend** para receber `clienteContaId` (C-04).

> É a dobra que justifica o produto. Nenhuma outra ferramenta da assessoria responde "por quê" com número.

### Dobra 3 — PRODUTOS *(impacto × ABC × margem × problema)*

- **Pergunta:** quem puxou, quem destruiu, quem está no vermelho, e quais Curva A têm margem ruim?
- **Dados:** uma tabela única com lentes: **Impacto** (`ProdutosEngine`) · **ABC** (`/read/products`) · **Margem** (`motorMargem` status por item) · **Problemas** (vermelho, abaixo da meta, sem custo).
- **Fonte:** três — e cada coluna declara a sua.
- **Escopo:** ACCOUNT (CV) + CLIENTE ⚠️ (V2, Margem).
- **Ação:** linha → drawer do produto com evidências, série, custo, elasticidade, e os atalhos "abrir em Margem / Anúncios / Automações **já neste item**".
- **Aprofundamento:** Central de Margem, Anúncios ML.
- **Quando aparece:** sempre que houver pedidos.
- **Prontidão:** **PARCIAL** — as três fontes existem; o **cruzamento numa tabela só é CONTRATO NOVO** (uma composição server-side por `item_id`).

> É aqui que se responde a pergunta do briefing §13 — *"quais Curva A estão destruindo margem?"* — que hoje **nenhuma tela responde**, porque ABC está na Central de Vendas e margem na Central de Margem.

### Dobra 4 — OPORTUNIDADES *(dinheiro na mesa)*

- **Pergunta:** quanto dá para recuperar, onde, e como?
- **Dados:** potencial recuperável total em R$ · por fator (custo, frete, preço, comissão, imposto, mix, produto no vermelho) · produtos envolvidos · e — separadamente — **alertas sem valor estimável**.
- **Fonte:** `RecuperacaoEngine`, `GET /:slug/oportunidades`.
- **Escopo:** hoje CLIENTE ⚠️ → alvo ACCOUNT.
- **Ação:** simular o cenário · registrar intervenção (`POST /:slug/acoes`, hoje **admin**) · abrir o módulo dono.
- **Quando aparece:** quando há oportunidade mensurável. A lista de alertas sem valor fica **colapsada**, nunca misturada.
- **Prontidão:** **EXISTE**; **ADAPTAÇÃO** no escopo e na autorização da escrita.

> O motor **já distingue** oportunidade mensurável de alerta sem valor. A UI precisa honrar essa distinção em vez de achatar tudo em "3 alertas".

### Dobra 5 — SIMULADOR *(colapsado por padrão)*

- **Pergunta:** e se eu parar os produtos no vermelho, subir preço ou reduzir custo?
- **Fonte:** `POST /:slug/resultado/simular` — **server-side, reconstruindo o perfil a partir dos mesmos pedidos da ponte**.
- **Escopo:** segue a ponte.
- **Ação:** simular · registrar a decisão como intervenção.
- **Quando aparece:** colapsado; abre ao clicar numa oportunidade.
- **Prontidão:** **EXISTE**.

> Colapsado **não** é escondido. É a diferença entre "capacidade disponível" e "capacidade que ocupa espaço todo dia".

### Dobra 6 — ADS

- **Pergunta:** Ads ajudou ou pressionou o resultado?
- **Dados:** investimento · GMV Ads · ROAS · ACOS · **TACoS** · participação no resultado · evolução · estado da conexão.
- **Fonte:** `ads/mlAdsService` (ao vivo) + `ads_resumos_mensais` (registro) + `cliente360AdsService` (**adapter que diz de onde veio o número**).
- **Escopo:** ACCOUNT ao vivo; **`cliente_slug` + `loja_campanha` no registro ⚠️** (C-05).
- **Ação:** abrir Ads na competência.
- **Quando aparece:** **só `marketplace = meli`**. Em Shopee, a dobra não existe — não aparece vazia.
- **Prontidão:** **EXISTE** com ressalva de multiconta.
- **Regra:** não inventar atribuição de Ads por produto (não existe) e **não tratar corte de Ads como recuperação garantida**.

### Dobra 7 — FULL *(condicional)*

- **Pergunta:** tenho risco de ruptura ou excesso?
- **Dados:** estoque disponível/total/indisponível · vendas 7d vs. 7d anterior · tendência · ritmo equivalente 30d · giro diário · cobertura em dias · críticos · sugestão de reposição com motivo.
- **Fonte:** `GET /operacao/full/contas/:clienteContaId/snapshot` + `fullRules` (puro).
- **Escopo:** **ACCOUNT nativo** — é o mais limpo do sistema.
- **Ação:** item → drawer com movimentos.
- **Aprofundamento:** Central Full.
- **Quando aparece:** `marketplace = meli` **e** `FULL_CENTRAL_ENABLED` **e** a conta tem inventário. Sem isso, a dobra não existe. **Nunca "Full: OK ✓".**
- **Prontidão:** **EXISTE** atrás de flag (C-11).

### Dobra 8 — MARGEM

- **Pergunta:** qual é a margem e quanto confio nela?
- **Dados:** MC média · itens com/sem margem · distribuição por status (`HEALTHY`/`LOW_MARGIN`/`LOSS`/`UNVALIDATED`/`SUSPECT_DATA`) · cobertura de custo.
- **Fonte:** `motorMargemService` + `CoberturaService`.
- **Escopo:** **CLIENTE ⚠️ e só meli** — declarado no chip, não escondido.
- **Ação:** abrir Central de Margem já no filtro.
- **Quando aparece:** `meli`.
- **Prontidão:** **EXISTE**; tornar account-aware é **BACKEND RELEVANTE** (depende de `contextoPrecificacaoService`).
- **Regra preservada:** *margem ruim ≠ dado ruim.* 3% com dado bom é problema de preço; 3% com frete inconsistente é problema de dado.

### Dobra 9 — CONFIANÇA DOS DADOS

- **Pergunta:** posso confiar nos números que estou vendo?
- **Dados, mantidos separados:**
  1. **Cobertura do resultado** — `ConfiancaEngine`, em **% do faturamento**: receita sem apuração, pedidos bloqueados, cobertura de custo e de frete, reconciliação detalhe × fechamento, diferença sem origem, pedidos que derrubam a confiança. Níveis: confiável / parcial / insuficiente.
  2. **Completude da coleta** — por fonte: `orders`, `shipments`, `claims`, `returns`, `base`, `payments`, distinguindo estrutural de parcial.
  3. **Conciliação Mercado Pago** — `resultadoConciliadoMp`.
- **Fonte:** três, nomeadas.
- **Escopo:** ACCOUNT (1 e 2 podem ser; 1 hoje segue o escopo da V2 ⚠️).
- **Ação:** lista dos pedidos que derrubam a confiança → drawer O(1) · sincronizar (admin).
- **Quando aparece:** sempre. **Quando a confiança é insuficiente, ela sobe para logo abaixo da Dobra 1.**
- **Prontidão:** **EXISTE**; a composição das três numa dobra é **ADAPTAÇÃO**.

> Este é o maior diferencial de produto do VenForce e o mais fácil de destruir. "Dados confiáveis ✓" jogaria fora nove medidas distintas.

### Dobra 10 — SAÚDE E DIAGNÓSTICO

- **Pergunta:** a operação está configurada e o que o diagnóstico apontou?
- **Dados:** grant · base · última sync · idade do diagnóstico · críticos · atenção · principais problemas e oportunidades.
- **Fonte:** `visaoService.SaudeOperacional` + `cliente_360_diagnosticos` + `/me/portfolio`.
- **Escopo:** ACCOUNT (alvo) / CLIENTE hoje ⚠️.
- **Ação:** executar diagnóstico (admin) · `⚙ Configurar operação`.
- **Quando aparece:** sempre, **no fim** — porque quem abre a 360 quer resultado, e o que é bloqueante já subiu para a Dobra 0.5.
- **Prontidão:** **EXISTE**.
- **Nota:** é o diagnóstico **da 360**. O **Diagnóstico Inicial** (`/operacao/diagnosticos-iniciais`) é onboarding manual e **continua sendo outro módulo** (C-07).

### Dobra 11 — HISTÓRICO E ENTREGAS

- **Pergunta:** como este cliente evoluiu e o que já foi entregue?
- **Dados:** série de competências (faturamento, resultado, MC%) · entregas (rascunho/publicado, token, expiração) · sync runs · intervenções registradas.
- **Fonte:** `cliente_360_resumos_mensais` · `entregasClienteService` · `central_vendas_sync_runs` · `cliente_360_acoes`.
- **Escopo:** CLIENTE + ACCOUNT (misto, declarado por linha).
- **Ação:** abrir competência (troca o `periodo` da própria 360) · abrir entrega · publicar/despublicar (módulo dono: Financeiro V3).
- **Quando aparece:** sempre, no fim.
- **Prontidão:** **EXISTE**, exceto "eventos de setup", que depende de `activity_logs` (C-10) — **CONTRATO NOVO / PRECISA VALIDAÇÃO**.

### Dobra 12 — CLIENTE *(client-scoped, explicitamente)*

- **Pergunta:** quem é este cliente e como as operações dele se comparam?
- **Dados:** operações lado a lado (faturamento, MC%, grant, base, cobertura) · responsáveis (gestor/auxiliar/designer) · squad · API key · pendências.
- **Fonte:** `/me/portfolio`, `clienteResponsaveisService`, `listarContasDoCliente` (com `dedupeById`).
- **Escopo:** **CLIENT** — a única dobra assim, e rotulada como tal.
- **Ação:** trocar de operação · `⚙ Configurar` · gerenciar responsáveis.
- **Quando aparece:** **só quando o cliente tem 2+ operações.** Com uma, é ruído.
- **Prontidão:** **EXISTE** os dados; a tabela comparativa é **ADAPTAÇÃO**.

> **Não há totalização.** Ver §7.2.

---

## 7. Como a arquitetura resolve os problemas duros

### 7.1 Como o contexto viaja

| Evento | Comportamento |
|---|---|
| Entrar pela Carteira | 1 conta → entra direto; 2+ → só pelo chip; 0 → "Configurar →". **Já é assim** |
| Trocar de operação | mantém competência, mantém dobra (`foco`), **recarrega todos os blocos account-scoped** |
| Trocar de competência | mantém operação e dobra |
| Trocar de Cliente | **zera o período** (regra §8.5 do Shell — preservar) e zera a conta |
| Abrir um módulo | `buildHref` propaga `cliente`, `conta`, `periodo` + `retorno=` com a dobra |
| Voltar | mesma conta, mesma competência, **mesma dobra e mesma posição** |
| Refresh | `sessionStorage["vf-ctx"]` + URL reconstroem tudo |
| Nova sessão | contexto de aba, não de máquina — comportamento atual, correto |
| Deep-link colado | conta de outro cliente → `CONTA_NAO_PERTENCE_AO_CLIENTE`; período inválido → `PERIODO_INVALIDO`; nunca cai no mês atual em silêncio |
| **Squad** | **não há seletor** — ver C-01. A carteira é a união dos squads; Squad é filtro na Carteira. Se a intenção do P2.9 for implementada, o seletor entra **no Shell**, não na 360 |

### 7.2 Como funciona um cliente multi-marketplace

`N97 Comercial = ML Principal + ML Outlet + Shopee`.

1. A 360 abre **sempre em uma operação**. Nunca no agregado.
2. Trocar de operação **muda o conjunto de dobras**: ML Principal mostra Ads, Full e Margem; Shopee **não mostra nenhuma das três** — elas não existem, não aparecem vazias. `PRODUCT_MAP` é explícito: Shopee não tem API de pedidos, frete real, Ads, Full nem margem.
3. A Dobra 12 compara as três lado a lado, com um traço onde a métrica não existe naquele marketplace.
4. **Não existe "faturamento do cliente" somado.** Se essa soma for necessária, ela é uma decisão humana (§11 · H-2) e, se aprovada, nasce como bloco próprio, rotulado, com confiança igual à pior das partes — nunca como o número do topo.
5. Consequência prática: uma operação Shopee terá uma 360 estruturalmente mais pobre. **Isso é honesto e deve aparecer**, não ser compensado com seções decorativas.

### 7.3 Trabalho × informação — e onde mora a fila

A 360 **não é uma fila**. Ela classifica em quatro naturezas, visualmente distintas:

| Natureza | Onde vive | Critério |
|---|---|---|
| **Bloqueio** | Dobra 0.5, acima de tudo | invalida números abaixo (grant, base, sync estrutural) |
| **Oportunidade** | Dobra 4 | tem **R$ estimado**, produtos e fator — vem do `RecuperacaoEngine` |
| **Alerta sem valor** | Dobra 4, colapsado | o motor **já sabe** que não é mensurável |
| **Informação** | a dobra a que pertence | não tem ação nem impacto |

**A fila de trabalho fica na Carteira.** Ela já tem o insumo: `GET /me/portfolio` entrega `statusOperacional`, `pendencias`, `grantStatus`, `baseVinculada` e `ultimaSincronizacao` de todos os clientes em **uma requisição**. Transformar a Carteira em fila é barato e é onde a pergunta "o que eu faço hoje?" realmente acontece — entre clientes, não dentro de um.

### 7.4 Ownership das ações

> **Autoridade é do módulo. Invocação pode ser da 360. Retorno preserva posição.**

Ação **limitada** → drawer sobre a 360, chamando o endpoint do módulo dono. Ação **aberta** (CRUD, upload, OAuth) → deep-link com retorno.

| Ação | Autoridade | Gate hoje | Forma na 360 |
|---|---|---|---|
| Criar ClienteConta | `clienteContasRoutes` | **admin** | deep-link (Clientes) |
| Conectar/reconectar Grant | `/ml/conectar-conta/:clienteContaId` | sem gate (OAuth) | **deep-link** — nunca drawer |
| Vincular Base | `PUT /cliente-contas/:id/base` | **admin** | drawer (escolher entre elegíveis) |
| Revisar custo do Seller | `PATCH /seller/custos-submissoes/:id` | **admin** | drawer com a lista |
| Sincronizar | `POST /:slug/sincronizar` ou sync-runs | **admin** | inline no cabeçalho + progresso |
| Executar diagnóstico | `POST /:slug/diagnostico-automatico` | **admin** | inline na Dobra 10 |
| Gerar/publicar entrega | `entregasClienteRoutes` | autom | deep-link Financeiro V3 |
| Excluir entrega | `DELETE /entregas-cliente/:id` | autom | **fora da 360** — destrutivo |
| Trabalhar Ads | módulo Ads | autom | deep-link com conta+competência |
| Registrar intervenção | `POST /:slug/acoes` | **admin** ⚠️ | inline — ver H-4 |

⚠️ **Achado que reordena o roadmap:** metade das ações úteis exige `requireAdmin` — sincronizar, diagnóstico, revisar custo, vincular base, criar conta, registrar intervenção. Um gestor não-admin abriria a 360, veria o problema e **não poderia resolver nada**. Ou a 360 assume que ações são de admin (e para os demais é leitura + deep-link), ou a autorização é expandida. **É decisão humana (§11 · H-4) e é pré-requisito de qualquer ambição de "superfície de ação".**

### 7.5 Roles — mesma estrutura, defaults diferentes

Correção necessária ao vocabulário do briefing: **"coordenador", "analista" e "auxiliar" não são roles.** São três eixos distintos (`USER_ROLES`):

| Eixo | Valores reais | O que pode mudar na 360 | O que **nunca** muda |
|---|---|---|---|
| `users.role` | `admin`, `user`, `membro`, `interno`, `seller`, `shopee_reviewer` | ações admin visíveis; grupo Administração | a estrutura da tela |
| `squad_members.funcao` | `membro`, `coordenador` | administrar o próprio squad; visão agregada na Carteira | acesso a Cliente |
| `cliente_responsaveis.papel` | `gestor`, `auxiliar`, `designer` | **ordenação e default da Carteira** | **nada** — teste `responsabilidadeNaoAutoriza` |

- **admin** — mesma 360 + ações inline (sync, diagnóstico, custo, intervenção) + placar. Bypass de carteira continua no backend.
- **user / membro** — a 360 inteira em leitura; ações admin aparecem como **desabilitadas com motivo** (`aria-disabled` + `title`, padrão já usado no Shell), nunca somem.
- **coordenador (função)** — ganha agregação **na Carteira**, não na 360.
- **interno** — ⚠️ hoje **toma 403 no gate de módulo** (D-05). Não desenhar para essa role até resolver.
- **seller** — não acessa. Mas suas submissões de custo aparecem na Dobra 4 de quem acessa.
- **shopee_reviewer** — vai para `cliente-operacao.html`. Ver §8.

O **placar do consultor** sai do Cliente e vai para Carteira/Squad: ele compara pessoas e períodos, não pertence à leitura de um cliente.

---

## 8. Entregável 7 — o que morre e o que sobrevive

| Atual | Destino | Por quê |
|---|---|---|
| **Visão** | **BASE TÉCNICA + ABSORVIDA** | a ilha `visao` (Shell V3, `scope=account`) vira o container da nova 360; `ResultadoPeriodo`/`Saúde`/`Atividade`/`Margem`/`Ads`/`Fechamento` viram as Dobras 1, 10, 6, 8. O **nome** desaparece; o **contrato** governa tudo |
| **Cliente 360 V1** | **APOSENTADA por etapas** | conteúdo migra (Dobras 1, 3, 6, 10, 11); as **escritas** (PATCH custo Seller, sincronizar, DELETE entrega) só saem depois de terem casa. Foi recuperada ao menu por decisão humana (C-06) — não sai sem substituição comprovada |
| **Cliente 360 V2 (React)** | **BASE TÉCNICA + ABSORVIDA** | os 6 motores e 17 componentes são as Dobras 2, 3, 4, 5, 9. **Nada é reduzido a link** |
| **`cliente-360-v2.html` (bundle Vue)** | **APOSENTADA** | órfã confirmada, sem fonte, nunca linkada. Candidata a `Archive/` — decisão humana |
| **Cliente Operação** | **CONTINUA TEMPORARIAMENTE, congelada** | é o **destino pós-login do `shopee_reviewer`** (`login.js`). Não recebe investimento; seus conceitos (integrações, tokens, base, cobertura, prontidão) já vão para a Dobra 0.5/10 e para `⚙ Configurar operação`. Aposentar só depois de um destino para aquela role |
| **Central de Vendas** | **CONTINUA MÓDULO PROFUNDO** | conciliação pedido a pedido. A 360 consome `/read/bootstrap`, `/read/daily`, `/read/products`, `/read/orders/:rowId` — **não replica as abas** |
| **Ads** | **CONTINUA MÓDULO PROFUNDO** | a 360 lê e resume; o registro mensal e o checklist ficam no módulo |
| **Central Full** | **CONTINUA MÓDULO PROFUNDO** | a 360 mostra a Dobra 7 resumida; gestão de reposição fica no módulo |
| **Central de Margem** | **CONTINUA MÓDULO PROFUNDO** | 4 camadas por item e evidências; a 360 resume e faz deep-link já no item |
| **Diagnóstico (da 360)** | **ABSORVIDO (resumo)** | Dobra 10, com execução inline (admin) |
| **Diagnóstico Inicial** | **CONTINUA MÓDULO** | onboarding manual — produto diferente (C-07) |
| **Financeiro V3** | **CONTINUA MÓDULO PROFUNDO** | dono do fechamento e da entrega; a 360 lê e faz deep-link. **Cutover para `financeiro.html` continua proibido sem decisão** ("é dinheiro") |
| **Bases** | **CONTINUA MÓDULO / VIRA CONFIGURAÇÃO** | invocável da 360 por drawer (vincular) e deep-link (criar/editar) |
| **Carteira** | **EVOLUI PARA FILA** | já tem `/me/portfolio` com pendências; é onde a fila pertence |
| **Dashboard** | **APOSENTADA** (decisão pendente) | já não é destino pós-login; só alcançável pelo `layout.js` (D-02) |

---

## 9. Entregável 5 — wireframe denso

Desktop ~1440px. `▸` = colapsado. `↗` = deep-link com retorno. `▸drawer` = abre sobre o dossiê.

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ≡  VenForce        N97 Comercial ▾   │  ML · Loja Principal ▾   ago/2026 ▾   vs jul/2026 ▾        │ STICKY
│                                       │  ⚙ Configurar operação    ⟳ Sincronizar (admin)           │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│ ⚠  Grant do Mercado Livre desconectado desde 02/09 · Ads e métricas ao vivo indisponíveis          │ condicional
│    Os números abaixo são da última coleta (05/09 04:12).            [ Reconectar ↗ ]               │
├────────────────┬─────────────────────────────────────────────────────────────────────────────────┤
│ TRILHO  STICKY │  1 · RESULTADO DO PERÍODO                              conta · Central de Vendas │
│                │  ┌────────────────┬────────────────┬────────────────┬────────────────┐          │
│ ● Resultado    │  │ Faturamento    │ Result. operac.│ Result. pós-Ads│ MC             │          │
│   R$ 412,9k    │  │ R$ 412.880     │ R$ 62.240      │ R$ 38.120      │ 9,2%           │          │
│                │  │ ▲ 8,4% vs jul  │ ▲ 2,1%         │ ▼ 11,3%        │ ▼ 1,4 p.p.     │          │
│ ○ Por que      │  └────────────────┴────────────────┴────────────────┴────────────────┘          │
│   mudou        │   Pedidos 1.284 ▲6%  ·  Ticket R$ 321 ▲2%  ·  Cancelados 74 (5,8%) ▲1,2 p.p.     │
│                │                                                                                  │
│ ○ Produtos     │   ▁▃▅▂▇▆▃▅█▄▂▅▇▃▁▄▆▅▃▇▅▂▄▆▃▅▇▄▂▁   série diária · clique no dia → ▸drawer        │
│   340 · 12 ⚠   │                                            [ Central de Vendas ↗ ]                │
│                │ ─────────────────────────────────────────────────────────────────────────────── │
│ ○ Oportunidades│  2 · POR QUE MUDOU                                     conta* · ponte PVM        │
│   R$ 11,2k     │   Resultado operacional  jul R$ 60.940  →  ago R$ 62.240      Δ +R$ 1.300        │
│                │                                                                                  │
│ ○ Simulador ▸  │   Preço        ████████████▏              +R$  9.400   ▸ 18 produtos             │
│                │   Volume       ██████▎                    +R$  4.800   ▸ 41 produtos             │
│ ○ Ads          │   Mix          ███▊                       -R$  2.100   ▸  9 produtos             │
│   TACoS 5,8%   │   Custo        ████████▌                  -R$  6.900   ▸ 12 produtos ⚠ sem base  │
│                │   Frete        ███▏                       -R$  2.400                             │
│ ○ Full         │   Comissão     █▌                         -R$  1.500                             │
│   3 críticos   │                                                                                  │
│                │   "O resultado subiu 2,1% apesar de custo e frete terem pressionado. O ganho veio │
│ ○ Margem       │    de preço em 18 produtos, parcialmente anulado por mix."      (sem IA)         │
│   9,2% ⚠ cli   │ ─────────────────────────────────────────────────────────────────────────────── │
│                │  3 · PRODUTOS          [ Impacto ] [ ABC ] [ Margem ] [ Problemas ]              │
│ ○ Confiança    │   ┌────────────────────┬─────┬──────────┬───────┬────────┬──────────┬─────────┐ │
│   parcial 78%  │   │ Produto            │ ABC │ Faturam. │ Impac.│  MC%   │ Status   │ Ação    │ │
│                │   ├────────────────────┼─────┼──────────┼───────┼────────┼──────────┼─────────┤ │
│ ○ Saúde        │   │ Kit Organizador 6p │  A  │  84.200  │ +9,1k │  14,2% │ HEALTHY  │ ▸drawer │ │
│   diag. 12d    │   │ Suporte TV 32-75"  │  A  │  61.800  │ -6,4k │   2,1% │ LOW_MARG │ ▸drawer │ │
│                │   │ Cabo HDMI 2m       │  A  │  44.100  │ -3,2k │  -1,8% │ LOSS     │ ▸drawer │ │
│ ○ Histórico    │   │ Luminária LED      │  B  │  22.400  │   —   │    —   │ UNVALID. │ vincular│ │
│   ago em aberto│   └────────────────────┴─────┴──────────┴───────┴────────┴──────────┴─────────┘ │
│                │    impacto·ponte   ABC·Central de Vendas   MC·Motor de Margem (cliente ⚠, meli) │
│ ○ Cliente      │    ⚠ 12 anúncios sem custo = 31% do faturamento         [ Central de Margem ↗ ] │
│   3 operações  │ ─────────────────────────────────────────────────────────────────────────────── │
│                │  4 · OPORTUNIDADES                            POTENCIAL RECUPERÁVEL  R$ 11.240  │
│ ────────────── │   ┌──────────────────────────────────────────────────────────────────────────┐ │
│ [Gerar entrega]│   │ CUSTO DESATUALIZADO                                          R$ 6.480     │ │
│ [Registrar     │   │ 12 anúncios sem custo na base · 31% do faturamento da competência         │ │
│  intervenção]  │   │ Resolve: revisar 2 submissões do Seller e vincular custo                  │ │
│                │   │           [ Revisar aqui ▸drawer ]   [ Bases ↗ ]                          │ │
│                │   ├──────────────────────────────────────────────────────────────────────────┤ │
│                │   │ PRODUTOS NO VERMELHO                                          R$ 3.100    │ │
│                │   │ 4 produtos com MC negativa · Cabo HDMI 2m responde por 62%                │ │
│                │   │           [ Simular ▸ ]   [ Automações ↗ ]                                │ │
│                │   ├──────────────────────────────────────────────────────────────────────────┤ │
│                │   │ TACoS ACIMA DA META                                           R$ 1.660    │ │
│                │   └──────────────────────────────────────────────────────────────────────────┘ │
│                │   ▸ 3 alertas sem valor estimável                                              │
│                │ ─────────────────────────────────────────────────────────────────────────────── │
│                │  5 · SIMULADOR ▸        6 · ADS        7 · FULL        8 · MARGEM               │
│                │  9 · CONFIANÇA          10 · SAÚDE     11 · HISTÓRICO  12 · CLIENTE             │
└────────────────┴─────────────────────────────────────────────────────────────────────────────────┘
```

**Acima da dobra:** contexto, bloqueio (se houver) e a Dobra 1 inteira. Em 900px de altura, a pessoa vê faturamento, resultado antes e depois de Ads, MC, pedidos, ticket, cancelamentos e o início da ponte. Nada de hero, nada de ilustração.

**Sticky:** o cabeçalho de contexto e o trilho. Mais nada.

**O trilho carrega valor, não só rótulo.** `Produtos 340 · 12 ⚠`, `Oportunidades R$ 11,2k`, `Confiança parcial 78%`. Ele é, sozinho, um resumo executivo — e é o que faz a página longa funcionar para o uso diário.

**O que colapsa:** simulador (sempre), alertas sem valor, tabelas longas (10 linhas + "ver todos" → drawer), evidências.

**O que some:** Ads e Margem em Shopee; Full sem inventário ou com a flag desligada; Dobra 12 com uma única operação; comparação sem competência anterior.

**Como não virar página infinita:** só 12 dobras, ordem fixa (a ordem do raciocínio), dobras condicionais não renderizam, o trilho dá acesso O(1) a qualquer uma, aprofundamento vai para drawer (nunca aumenta a página) e cada dobra tem **um** número dominante.

**Visual:** Hanken Grotesk. Raio 2–4px. Roxo só em estado ativo, seleção e link. Números tabulares alinhados à direita. Severidade por ícone **e** texto, nunca só por cor. A terceira linha de cada bloco é sempre a assinatura (`escopo · fonte`) em 11px.

---

## 10. Entregável 6 — fluxos reais

**Cenário 1 — Gestor abre N97 / ML Principal antes da reunião mensal.**
Carteira → clica N97 → 1 conta ativa? entra direto; 3 contas → escolhe ML Principal pelo chip → 360 abre em `ago/2026` com comparação `jul` pré-selecionada. Ele rola: resultado → por que mudou → produtos → oportunidades. Em ~40 segundos tem a narrativa. Clica em `[Gerar entrega]` → Financeiro V3 já na competência → publica → volta. **Tudo numa superfície, uma saída só, para escrever.**

**Cenário 2 — Produto Curva A destruindo margem.**
Dobra 3, lente `ABC`: "Suporte TV 32-75", Curva A, R$ 61,8k, impacto **-R$ 6,4k**, MC 2,1%, `LOW_MARGIN`. Clica → drawer: evidências de custo/frete/comissão, série de 6 meses, elasticidade, e o motivo da classe de confiança. Dois caminhos: `[Simular preço ▸]` (fica na 360) ou `[Central de Margem ↗]` (sai para corrigir, volta ao mesmo lugar). **Nunca "Margem: 14% · Abrir Margem".**

**Cenário 3 — Cliente usa Full e há risco de ruptura.**
Dobra 7 existe porque é meli, a flag está ligada e há inventário. Trilho mostra `Full · 3 críticos`. Três itens com cobertura < 7 dias, tendência de alta, sugestão de reposição com motivo. Clica → drawer com movimentos por `inventory_id`. Reposição de verdade: `[Central Full ↗]`. Em Shopee, **a dobra não aparece** — e o trilho não tem buraco.

**Cenário 4 — Confiança parcial.**
Trilho: `Confiança parcial 78%`. Porque é *parcial*, a Dobra 9 **sobe** para logo abaixo da Dobra 1 e o cabeçalho de cada número financeiro ganha o chip `parcial`. A dobra separa: 78% do faturamento apurado; 22 pedidos bloqueados; `shipments` 91% completo; frete ausente em 14 pedidos; reconciliação MP com R$ 1.840 sem origem. Clica em "22 pedidos bloqueados" → drawer com a lista, cada linha abrindo o pedido em O(1). Admin: `⟳ Sincronizar`. **Não vira um selo vermelho.**

**Cenário 5 — ML Principal + ML Outlet + Shopee.**
Abre em ML Principal. Dobra 12 aparece (3 operações) com as três lado a lado: ML Principal R$ 412,9k / MC 9,2% / grant ✗; ML Outlet R$ 88,4k / MC 12,1% / grant ✓; Shopee R$ 51,2k / MC — / base ✓. **Sem linha de total.** Clica em ML Outlet → recarrega em ML Outlet, mesma competência, mesma dobra. As dobras Ads/Full/Margem existem lá; ao ir para Shopee, **somem**. O `loja_campanha` do registro de Ads é onde a distinção entre as duas lojas ML fica frágil hoje (C-05).

**Cenário 6 — Coordenador troca de squad e abre outro cliente.**
⚠️ **Este cenário depende de C-01.** Pelo **código atual**, não há troca de squad: a carteira do coordenador já é a união dos seus squads (2, 3 e 6, no caso do Klayvert), e ele filtra por squad **na Carteira**. Ele filtra → Squad 6 → escolhe Fênix → escolhe a operação → 360. Trocar de cliente **zera o período** por regra do Shell.
Pela **decisão P2.9**, existiria um "Squad ativo da sessão" que recortaria a carteira, descartado no próximo login. **Se e quando isso for implementado, o seletor pertence ao Shell** (ao lado do de Cliente), não à 360 — a 360 herda. Não desenho o seletor porque o código não o tem.

---

## 11. Entregável 8 — gap técnico

| | Item |
|---|---|
| **JÁ EXISTE** | container Shell V3 `scope=account` (ilha `visao`) · contrato `disponivel`/`escopoConta` · os 6 motores da V2 · Read API da Central de Vendas (bootstrap, daily, products, orders O(1)) · `fullRules` + snapshot por `clienteContaId` · Motor de Margem com fonte e confiança · vocabulário canônico de erro · `/me/portfolio` · OAuth account-scoped (`/ml/conectar-conta/:clienteContaId`) · entregas com token público |
| **PRECISA ADAPTAÇÃO (frontend)** | trilho com valores · dobras condicionais · `foco` na URL + retorno de posição · drawers de drill-down · chips de escopo/fonte · faixa de bloqueio · colapsos |
| **PRECISA ADAPTAÇÃO (backend)** | **compor** as dobras num payload só (extensão do `visaoService`) · unificar `periodo` × `competencia` (C-03) · elevar `escopoConta` de margem e fechamento |
| **ALTERAÇÃO RELEVANTE DE BACKEND** | ⭐ **`clienteContaId` nos motores da Cliente 360** (`cliente360ResultadoService`, `FechamentoAdapter`, `ProdutosEngine`, `RecuperacaoEngine`, `ConfiancaEngine`) — **é o gargalo de tudo** (C-04) · Margem account-aware (depende de `contextoPrecificacaoService`, hoje só MELI) · Ads: separar registro mensal por conta (C-05) |
| **BACKEND NOVO** | cruzamento **Impacto × ABC × Margem × Problema** por `item_id` numa tabela só (Dobra 3) · fila agregada na Carteira · histórico de eventos de setup (depende de `activity_logs` existir — C-10) · consolidado entre operações, **se** aprovado (H-2) |
| **DEPENDE DE `clienteContaId`** | Dobras 1, 2, 3, 4, 6, 7, 9, 10 — praticamente tudo |
| **DEPENDE DE MARKETPLACE** | Ads, Full, Margem, Automações, Anúncios = **só meli**. Shopee = fechamento por planilha + base. TikTok **não cabe em `cliente_contas`** (CHECK do banco) — está fora do escopo desta superfície |
| **PROJETO FUTURO** | atribuição de Ads por produto (não existe) · fonte `MERCADO_PAGO` no Motor de Margem (declarada, não implementada) · frete real por pedido no histórico da 360 ("v1 HONESTA") · migrar a ilha `cliente-360-react` para o Shell V3 de vez |

**Restrição de implementação a respeitar desde já:** `vite.config.js` mantém **builds Rollup separados por ilha, deliberadamente** — um build multi-entrada extrairia chunk compartilhado e quebraria o isolamento. Montar os componentes da V2 dentro da ilha `visao` precisa de uma decisão de build explícita, tomada cedo. E `GUIA_PARA_IA.md` proíbe mudar rota ou payload existente sem autorização: **a composição nova deve ser uma rota nova**, nunca uma alteração de `GET /operacao/visao/:cliente` ou de `/:slug/resultado`. Atenção à ordem de montagem: `cliente360ResultadoRoutes` vem **antes** de `cliente360Routes` no mesmo prefixo.

---

## 12. Migração em três fases

**Fase 1 — O container certo com os motores certos.** Nova 360 sobre a ilha `visao` (Shell V3, `scope=account`); Dobras 0, 0.5, 1, 2, 3 (lentes Impacto + ABC), 6, 9, 10; `marketplace` deixa de ser parâmetro livre e passa a derivar da conta; `periodo` unificado; chips de escopo e fonte. **V1, V2, Visão e Cliente Operação continuam no ar, intactas.**
*Valor:* um lugar onde o número diz de qual loja é. *Validação:* para clientes de conta única, os números novos têm de bater **exatamente** com os da V2 atual. *Rollback:* menu volta às rotas atuais.
⚠️ **Pré-condição bloqueante: C-04.** Sem `clienteContaId` nos motores, isto vira "Fase 0 — tornar o resultado account-aware".

**Fase 2 — Profundidade e ação.** Dobras 4, 5, 7, 8, 11, 12; drawers de drill-down; ações inline conforme a decisão H-4; intervenção registrada com escopo de conta e competência. **V1 sai do menu → stub de redirect** (o padrão já existe no repositório), e só depois de cada escrita dela ter casa comprovada.
*Valor:* a 360 deixa de ser leitura. *Validação:* checklist item a item das escritas da V1. *Rollback:* esconder as dobras novas e devolver a V1 ao menu.

**Fase 3 — Fila, ciclo e aposentadoria.** Carteira vira fila real sobre `/me/portfolio`; placar migra para Carteira/Squad; `cliente-360-react.html` e `visao.html` viram redirects; nome final publicado; decisão sobre `cliente-360-v2.html` (Vue órfã) e sobre o destino do `shopee_reviewer`.
*Valor:* o coordenador opera a carteira. *Validação:* telemetria de uso das rotas legadas em zero por um período definido.

**Nada é apagado em nenhuma fase.** Aposentar = tirar do menu + redirect + telemetria. `GUIA_PARA_IA.md` proíbe remoção sem confirmação de não-uso, e `CURRENT_STATE` mostra um inventário de legado morto que ninguém apagou — por escolha.

---

## A. Decisões tomadas

1. A unidade de leitura é o par **(ClienteConta, competência)**. Nenhum número financeiro renderiza fora dele.
2. **Uma superfície densa** com trilho de âncoras — não abas, não cinco páginas.
3. **Entender nunca navega; editar sempre navega.** Drill-down em drawer.
4. **O container vem da Visão** (Shell V3, `scope=account`, contrato `disponivel`/`escopoConta`); **os motores vêm da V2, íntegros**; **as escritas vêm da V1, reancoradas nos módulos donos**.
5. **Marketplace deixa de ser filtro** e passa a ser propriedade da operação — elimina a classe de erro por construção.
6. **Assinatura de escopo e fonte em todo número** (`conta · Central de Vendas`, `cliente ⚠ · Motor de Margem`).
7. **Setup não é destino.** É faixa de bloqueio no topo + `⚙ Configurar operação` no cabeçalho.
8. **A fila fica na Carteira**, sobre `/me/portfolio`. A 360 não é árvore de alertas.
9. **Oportunidade mensurável e alerta sem valor permanecem separados** — o motor já os distingue.
10. **Três confianças e duas coberturas continuam três e duas.** Apresentadas juntas, nunca fundidas.
11. **Dobras condicionais não renderizam.** Nada de "Full: OK ✓" nem seção vazia por simetria.
12. **Sem seletor de Squad na 360** — o código não o tem (C-01); se for implementado, pertence ao Shell.
13. **Placar sai do Cliente** e vai para Carteira/Squad.
14. **Cliente Operação congelada**, mantida como home do `shopee_reviewer`.
15. **Diagnóstico Inicial continua módulo separado** — é outro produto.
16. **Nome "Cliente 360" preservado**, sufixos V1/V2 eliminados, "Visão" desaparece como nome de tela.
17. **Nada é apagado**; aposentadoria é menu + redirect + telemetria.

## B. Alternativas descartadas

| Descartada | Por quê |
|---|---|
| `Cliente Hoje + Performance + Setup` | §2 — seis razões, sendo a mais dura: "hoje" não é um recorte que o sistema produz |
| Macro-tabs (Modelo B) | quebra a narrativa de reunião e reconstrói as telas de hoje com outro nome |
| Workbench de duas colunas (Modelo C) | coluna interna atrapalha compartilhar tela; exige reescrever os componentes da V2 |
| 360 como camada sobre módulos (Modelo D) | exige contexto unificado nos 13 módulos do `layout.js`; sem destino para abrir |
| Visão absorve a 360 | contrato certo, profundidade insuficiente — seria regressão analítica |
| V2 absorve a V1 | a V2 não tem escrita nenhuma e navega sem conta |
| Cliente como escopo primário | não tem número próprio sem uma decisão explícita de soma |
| Consolidado do Cliente como default | é o risco de mistura silenciosa com aparência de feature |
| Fundir as três confianças num selo | destrói nove medidas distintas |
| Aposentar Cliente Operação agora | é a home de uma role inteira |
| Experiência diferente por role | role muda ação e default, não estrutura |

## C. Riscos

| Risco | Nível | Mitigação |
|---|---|---|
| Motores da 360 não aceitarem `clienteContaId` (C-04) | **CRÍTICO** | pré-condição da Fase 1; se falhar, vira Fase 0 |
| Escrita da V1 perdida ao tirá-la do menu | **ALTO** | checklist como gate da Fase 2; ela foi recuperada ao menu por decisão humana |
| Um número único e errado depois da convergência | **ALTO** | chip de fonte obrigatório; paridade numérica exigida na validação da Fase 1 |
| Metade das ações exigir `requireAdmin` | **ALTO** | decisão H-4 **antes** de prometer "superfície de ação" |
| Página longa virar página infinita | **ALTO** | 12 dobras, ordem fixa, condicionais, drill-down em drawer |
| Ads multiconta indistinguível no registro mensal (C-05) | **MÉDIO** | rotular por `loja_campanha`; não somar entre lojas |
| Full desligado em produção (C-11) | **MÉDIO** | dobra condicional desde o primeiro dia |
| `activity_logs` sem DDL (C-10) | **MÉDIO** | não prometer "histórico de eventos" antes de confirmar |
| Builds de ilha isolados por decisão | **MÉDIO** | decidir a estratégia de build na Fase 1 |
| `SQUADS_ENFORCEMENT` OFF em produção | **MÉDIO** | com OFF, papel interno vê **todos** os clientes ativos — a 360 não pode assumir carteira filtrada |
| Deep-links e favoritos da V1/V2 quebrados | **MÉDIO** | stubs de redirect traduzindo `?slug` para o contrato do Shell |
| `/operacao/base-cobertura` sem gate de carteira (C-12) | **MÉDIO** | não consumir na nova 360 sem revisão |

## D. Gaps que precisam auditoria de código

1. ⭐ **`cliente360FechamentoAdapter` e `cliente360ResultadoService` aceitam `clienteContaId`?** E `central_vendas_imports.cliente_conta_id` está populado para clientes multiconta? *(bloqueia a Fase 1)*
2. O que exatamente `cliente360ReadinessMultiConta.test.js` prende? É a prova ou a ausência de C-04.
3. `linkParamsCliente360V2` perde a competência ao navegar do Shell? (C-03)
4. `ads/mlAdsService.buscarPerformanceML` recebe conta e valida marketplace? O `AdsFechamento` da V2 é chamado com marketplace coerente com a conta?
5. `base_cliente_vinculos` — o vínculo efetivo é por Cliente ou por ClienteConta na prática?
6. Schema de `cliente_360_acoes`: tem conta, competência, produto, expectativa?
7. `activity_logs` existe em produção? (C-10)
8. `entregas_cliente.cliente_conta_id` está populado? (define H-1)
9. Quantas fórmulas de prontidão existem de fato (`logReadinessNoBoot`, V1, Cliente Operação) e qual é a canônica?
10. Estado de `FULL_CENTRAL_ENABLED` e de `SQUADS_ENFORCEMENT` em produção.
11. Cliente Operação: o fallback para objeto literal (`__mock`) existe mesmo? *(achado de nível 4 não reverificado — se existir, a única tela de uma role mostra dado sintético em falha de API)*
12. Role `interno` — D-05.
13. As rotas `/read/*` da Central de Vendas aceitam `conta` por querystring, ou o escopo vem do import publicado?

## E. Decisões humanas que só você pode tomar

1. **A entrega ao cliente é por Cliente ou por Operação?** Define se N97 recebe 1 relatório ou 3, e se `entregas_cliente.cliente_conta_id` deixa de ser nullable. *Recomendo: por operação, com capa consolidada opcional.*
2. **O consolidado do Cliente é número oficial ou só comparação lado a lado?** *Recomendo: comparação (Dobra 12), com total apenas onde for legítimo.*
3. **"Fechamento" no resumo = período calculado, entrega publicada, ou ambos com status separado?** *Recomendo: ambos, separados e nomeados.*
4. ⭐ **A 360 é superfície de ação para não-admin?** Hoje sync, diagnóstico, custo do Seller, vínculo de base e registro de intervenção são todos `requireAdmin`. Ou se expande a autorização, ou a 360 é leitura + deep-link para quem não é admin. *É pré-requisito da Fase 2.*
5. **Intervenção vira objeto de primeira classe** (escopo conta+competência+produto, com verificação na competência seguinte), e é visível a não-admin? *Recomendo: sim, visível ao autor e ao coordenador.*
6. **Cliente Operação: congelar indefinidamente ou dar prazo?** Envolve decidir o destino do `shopee_reviewer`. *Recomendo: congelar agora, prazo depois da Fase 3.*
7. **C-01 — existe "Squad ativo da sessão"?** A decisão P2.9 diz que sim; o código diz que não. Enquanto não for resolvido, a 360 não terá seletor de Squad. *Recomendo: manter como está (carteira = união, filtro na Carteira) e atualizar o P2.9, ou abrir um ADR para implementar o squad ativo no Shell.*

## F. Próximo prompt recomendado

> **Missão: AUDITORIA DE ESCOPO — a Cliente 360 é account-aware?**
> Modo: **read-only**, contra o código.
>
> Entrada: este documento + `server/services/cliente360/*`, `server/services/visaoService.js`, `server/services/centralVendas/*`, `server/routes/cliente360{,Resultado}Routes.js`, `frontend-react/src/{hooks/useCliente360.js,services/cliente360Api.js}`, `Portal/{vf-context.js,vf-shell.js}`, `frontend-react/vite.entries.js`.
>
> Responder, com caminho + símbolo (nunca número de linha) e sem propor solução:
> (a) `cliente360ResultadoService` e `cliente360FechamentoAdapter` recebem `clienteContaId` em algum caminho? Qual filtro de conta vai ao SQL?
> (b) o que `cliente360ReadinessMultiConta.test.js` de fato prende?
> (c) `useCliente360` lê conta? `linkParamsCliente360V2` perde a competência?
> (d) `cliente360AdsService` valida marketplace contra a conta?
> (e) `visaoService` — quais blocos são `escopoConta: false` e por qual limitação exata?
> (f) `cliente_360_acoes` e `entregas_cliente` — colunas reais.
> (g) as rotas `/read/*` aceitam conta por querystring?
>
> Entregar um veredito factual por item: **CONFIRMADO / REFUTADO / NÃO DETERMINÁVEL**, e atualizar C-03, C-04, C-05, C-09 e C-10 deste documento. Registrar divergências, não resolvê-las. Não alterar rota, payload ou schema.

---

## Documentos relacionados

[[AGENT_RULES]] · [[TELA_VISAO]] · [[TELA_CLIENTE_360]] · [[TELA_CLIENTE_360_V2]] · [[TELA_FECHAMENTOS_API]] · [[TELA_FINANCEIRO_V3]] · [[TELA_CENTRAL_MARGEM]] · [[TELA_ADS]] · [[TELA_FULL_GESTAO]] · [[TELA_CARTEIRA]] · [[CLIENTES_E_CONTAS]] · [[SQUADS_E_CARTEIRAS]] · [[VENDAS_E_PEDIDOS]] · [[FECHAMENTO]] · [[BASES_E_CUSTOS]] · [[SELECAO_DE_CLIENTE_E_OPERACAO]] · [[TROCA_DE_SQUAD_E_CARTEIRA]] · [[API]] · [[SERVICES]] · [[USER_ROLES]] · `VENFORCE_V3_P2_9_DECISOES_FINAIS_APROVADAS`
