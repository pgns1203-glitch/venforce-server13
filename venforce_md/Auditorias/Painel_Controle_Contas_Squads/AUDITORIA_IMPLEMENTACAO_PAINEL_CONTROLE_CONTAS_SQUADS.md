# Auditoria — Painel de Controle de Contas por Squad

**Repositório auditado:** `venforcecompany-sudo/venforce-server` (remote `origin` deste checkout)
**Branch base:** `main`
**SHA base:** `2fdc699293ece96695546d7393f52f395fe7642f`
**Branch da auditoria:** `audit/painel-controle-contas-squads`
**Data/hora da auditoria:** 2026-09-21, 16:47 (America/Sao_Paulo)
**Git status inicial (antes de qualquer ação):** árvore com 3 itens não rastreados, não relacionados a esta auditoria — `AUDITORIA_PLANILHA_PRECIFICACAO_MULTICONTAS.md`, `AUDITORIA_SKU_VARIACOES_PLANILHA_PRECIFICACAO.md`, `docs/Telas_17set/`. Confirmado que nenhum desses caminhos existe em `origin/main` (sem colisão) — foram deixados intocados durante `git switch main` / `git switch -c`.

## 0. Identidade do repositório (confirmada)

O repositório atual `venforce-server` (remote `origin` → `https://github.com/venforcecompany-sudo/venforce-server.git`) é o repositório correto e a fonte de verdade desta auditoria. `main` deste remote é a base usada (SHA acima).

O remote `gpt` → `https://github.com/pgns1203-glitch/venforce-server13.git` é um repositório auxiliar/referência, nunca fonte de verdade — usado nesta auditoria apenas para inspecionar a branch histórica `feat/central-executiva-contas` (Seção 21), que existe somente lá. Isso não é uma dúvida de implementação; é apenas onde uma referência histórica foi consultada.

---

## 1. Resumo executivo

O VenForce já tem uma fundação de autorização por Squad completa, testada e em produção (código deployado, enforcement hoje **desligado** — ver Seção 4) e uma fundação de múltiplas contas por cliente também completa. O painel novo **não precisa e não deve** criar uma segunda arquitetura de carteira: toda a autorização deve passar por `resolvePortfolioClientes` / `canAccessCliente` (`server/services/squads/authorizationService.js`), a mesma fonte que `/me/context`, `/me/portfolio`, `dashboardService` e `clienteContasRoutes` já usam.

Do lado financeiro, `FAT`, `LC` e `MC` têm definição de produto já estabelecida e confirmada em `Portal/relatorio-publico.js` (o relatório público que os clientes recebem): **LC = resultadoOperacional** e **MC = margemOperacional**, ambos já calculados pelo motor oficial (`cliente360ResultadoService` / `cliente360PonteEngine`). Só que esse motor é **por cliente, um de cada vez, e caro** (roda 5 engines + busca Ads em paralelo) — não serve para abrir uma tela com N clientes simultaneamente sem reformular a fonte de leitura. Existe uma tabela de snapshot mensal já persistida (`cliente_360_resumos_mensais`) que o próprio `dashboardService.js` já lê em lote (sem N+1) — essa é a base recomendada para o painel, com uma ressalva séria: **ela só é populada por sincronização manual disparada por admin, cliente a cliente** (não há job automático), então a cobertura/atualidade dos dados não é garantida para toda a carteira.

`ACOS` **existe** no projeto (é calculado em `server/services/ads/mlAdsService.js` e exibido em `Portal/ads.js`/`Portal/cliente-360.js`), mas deliberadamente **não** é exposto pelo motor financeiro oficial (`cliente360AdsService.js` diz isso explicitamente no cabeçalho). `COM`, `ATV` e `NPS` **não têm fonte de dado persistida e confiável hoje** — o candidato mais próximo (integração ClickUp) existe mas roda sem filtro de carteira por Squad e sem persistência histórica; NPS não tem fonte nenhuma (o único hit é um campo de formulário de diagnóstico inicial, não uma métrica recorrente).

A branch de referência `feat/central-executiva-contas` (só existe em `gpt`, 396 commits atrás de `origin/main`) contém um agregador de carteira reaproveitável como **padrão de algoritmo** (priorização, classificação de saúde, causas), mas seu endpoint agregado **tem um bypass de carteira real e confirmado**: não filtra por `resolvePortfolioClientes`, chama `getClientesOperacional()` sem nenhuma restrição, e é protegido só por `requireAutomacoesAccess` (papel, não carteira). Isso não pode ser herdado.

Não existe hoje nenhuma definição de "semana" no projeto — é uma decisão de produto em aberto, sem precedente algum no código. A recomendação técnica é semanas fixas por dia do mês (S1=01–07 etc.), por ser compatível com o resto do sistema (que é 100% ancorado em competência `YYYY-MM`), e não semana ISO.

## 2. Estado atual real do projeto

- `SQUADS_ENFORCEMENT` **não está definida** em `server/.env` → enforcement está **OFF** hoje neste ambiente (fail-safe padrão). Isso significa que, hoje, todo usuário de papel interno (`user`/`membro`/`interno`) enxerga **todos os clientes ativos**, não só os do seu Squad — é o comportamento legado, documentado e intencional (`server/config/squadsEnforcement.js`). Um painel implementado agora deve ser escrito contra `resolvePortfolioClientes` de qualquer forma — no dia em que o enforcement for ligado, o painel já respeita Squad automaticamente, sem precisar de mudança de código.
- Schema de Squads já existe e está migrado (`server/sql/migrations/20260827_squads_foundation.sql`, `20260828_cliente_responsaveis_p24.sql`), idempotente, aplicado tanto manualmente quanto no boot (`squadsRepository.ensureSquadsTables`).
- Fundação de múltiplas contas por cliente (`cliente_contas`) está completa, com regra de ambiguidade estabelecida (erro `409 MULTIPLE_MARKETPLACE_ACCOUNTS`) — nunca escolhe conta silenciosamente.
- Existe uma tabela de snapshot financeiro mensal já persistida por cliente (`cliente_360_resumos_mensais`), lida em lote (sem N+1) pelo `dashboardService.js` — é a peça mais importante para a arquitetura do painel novo (Seções 13/18).
- Não existe hoje nenhuma tela de "muitos clientes ao mesmo tempo com hierarquia expansível" — o mais próximo é o dashboard atual (cards, não tabela hierárquica) e a branch de referência (carteira executiva, com o bypass já citado).

## 3. Arquitetura atual de Squads

```
ROLE (users.role: admin | seller | user | membro | interno | outros)
  ↓
squad_members (user_id ↔ squad_id, funcao: 'membro' | 'coordenador', is_primary, ativo)
  ↓
SQUADS (id, nome, slug, ativo)
  ↓
cliente_squad_history (cliente_id ↔ squad_id, inicio_em, fim_em — fim_em IS NULL = vínculo ativo;
                        no máximo 1 linha ativa por cliente, garantido por índice único parcial;
                        histórico de transferências preservado, nunca apagado)
  ↓
CLIENTE (clientes.id)
  ↓
cliente_contas (cliente_id → marketplace/conta externa — Squad NUNCA é atribuído à conta,
                 sempre herdado: conta → cliente → squad)
```

Tabela auxiliar paralela, **não é autorização**: `cliente_responsaveis` (cliente_id, user_id, papel ∈ `gestor|auxiliar|designer`) — é organização/responsabilidade direta, documentada explicitamente no código como distinta de acesso (`squadsRepository.js:122-126`).

Schema exato (`20260827_squads_foundation.sql`):
- `squads`: id, nome, slug (único), ativo, timestamps.
- `squad_members`: id, squad_id, user_id, is_primary, funcao (`CHECK IN ('membro','coordenador')`), ativo. Único (squad_id,user_id); único parcial garantindo **no máximo 1 membership principal ativa por usuário**.
- `cliente_squad_history`: id, cliente_id, squad_id, inicio_em, fim_em, alterado_por, motivo. Único parcial `WHERE fim_em IS NULL` garante **no máximo 1 squad ativo por cliente**.
- `cliente_responsaveis`: id, cliente_id, user_id, papel (`CHECK IN ('gestor','auxiliar','designer')`), ativo, encerrado_em/encerrado_por/motivo (soft-delete).

## 4. Fluxo de autorização atual

Fonte única: `server/services/squads/authorizationService.js`. **Reutilizar exatamente essas funções — não replicar SQL de autorização em nenhum controller/service novo:**

- `resolvePortfolioClientes(user, db)` → lista `[{id,slug,nome}]` de clientes autorizados. **Esta é a função que o painel deve chamar primeiro, sempre, antes de qualquer filtro do frontend.**
- `canAccessCliente(user, clienteId, db)` → booleano.
- `assertClienteNaCarteira(user, ref, db)` → resolve id/slug + autoriza, lança 404/403 canônicos.
- `assertClienteContaNaCarteira(user, clienteContaId, db)` → autoriza por conta, herdando cliente → carteira (nunca "a conta existe, logo acessa").
- `clientesAutorizadosSet(user, db)` → Set de ids, para interseção em memória.
- `assertBaseNaCarteira` — não é necessário para este painel.

Regras por papel (`authorizationService.js:69-123`):
- **admin**: bypass total — todos os clientes ativos (`ativo=true`), inclusive sem Squad.
- **seller**: inalterado, via `seller_clientes` (Squads não tocam nesse caminho).
- **interno** (`user`/`membro`/`interno`, fonte canônica em `server/services/squads/rolesInternas.js`, `ROLES_COBRADAS_NA_AUDITORIA`): com enforcement ON, só clientes cujo Squad ativo é um dos Squads ativos do usuário; **Squad inativo nunca dá acesso operacional**, mesmo que o vínculo cliente↔squad siga "ativo" (`fim_em IS NULL`) — o JOIN em `squads s ON ... AND s.ativo = true` filtra isso. Com enforcement OFF (estado atual), interno vê todos os clientes ativos (comportamento legado, nunca carteira vazia por pendência de migração).
- **interno sem nenhuma membership**: com enforcement ON, carteira **vazia** — nunca cai em "todos os clientes" por segurança (comentário explícito no código, linha 7-8).
- **qualquer outro papel** (ex.: `shopee_reviewer`): carteira vazia sempre.

Middleware HTTP correspondente: `server/middlewares/carteiraMiddleware.js` — `requireClienteNaCarteira(source)` e `requireClienteContaNaCarteira(paramName)`, que chamam exatamente `assertClienteNaCarteira`/`assertClienteContaNaCarteira`. É o padrão já usado em `clienteContasRoutes.js` (`requireAutomacoesAccess` + `requireClienteNaCarteira("cliente")` — **os dois juntos**, papel E carteira). Este é o padrão que o painel deve seguir para qualquer rota `/painel-contas/:clienteId/...`.

Rollout gate (`server/config/squadsEnforcement.js` + `server/services/squads/rolloutGateBoot.js`): flag `SQUADS_ENFORCEMENT` cruzada com uma auditoria de prontidão de dados armada no boot (`server/index.js` ~linha 2015-2048). Fail-safe sempre OFF em qualquer dúvida. Hoje: flag ausente → OFF, o gate nem chega a ser consultado (curto-circuito). Isso é infraestrutura já pronta e não precisa de nenhuma mudança para o painel.

## 5. Fluxo /me/context e /me/portfolio

Ambos em `server/services/meService.js`, roteados por `server/routes/meRoutes.js` (`GET /me/context`, `GET /me/portfolio`, só `authMiddleware`, nunca 403 por falta de carteira — usuário sem clientes recebe `clientes: []`).

- `obterContexto(user)` (boot leve de toda página V3): `resolveEffectivePortfolio` (= `resolvePortfolioClientes`, ver Seção 6) + `squadsDoUsuario` em paralelo; depois contagem de contas ativas, squad ativo por cliente e responsáveis, **todos em lote** (`squadsRepo.squadsAtivosDeClientes(ids)`, `squadsRepo.responsaveisDeClientes(ids, userId)` — 1 query cada para N clientes, não N+1). Retorna `squads[]`, `squadPrincipalId`, `clientes[]` (cada um já com `squadId`, `responsavelDireto`, `contasAtivas`), `portfolio.totalClientes`.
- `obterPortfolio(user)` (a Carteira): mesma base + `listarContasDeClientesAtivos(ids)` (contas em lote), `cliente360Service.getClientesOperacional({restringirClienteIds: ids})` (prontidão em lote), `ultimaSyncPorConta(ids)` (última sincronização por conta, 1 query `DISTINCT ON` para todas as contas — comentário explícito no código: "nunca 1 por conta"). Cada cliente do payload já vem com `squad: {id,nome,slug,principalParaUsuario}`, `papeisDiretos[]`, `statusOperacional`, `pendencias[]`, `contas[]`.

**Isto é a prova de conceito, já em produção, de que dar carteira + squad + contas de N clientes em UMA leitura sem N+1 é possível e é exatamente o padrão que o backend do painel deve replicar** para sua lista inicial.

`squadPrincipalId`, `squads[]` do usuário, `cliente.squadId`/`cliente.squad` — ver distinção completa na Seção 17.

## 6. Estrutura cliente → contas

`server/services/clienteContas/clienteContaService.js`. Modelo: `cliente_contas` (marketplace ∈ `meli|shopee`, `is_primary`, `ativo`, `external_account_id`, `metadata_json` com `nickname` como desambiguador humano) → grant (`ml_tokens`, via LATERAL 1:1, nunca duplica linha) → base de custos (`base_cliente_vinculos`, também LATERAL 1:1, cardinalidade 1 conta = no máx. 1 base ativa, corrigida por auditoria anterior).

Regra de ambiguidade (`resolveMarketplaceAccountContext`, linhas 691-788): se `clienteContaId` não é informado e há **mais de uma** conta ativa do marketplace, lança `409 MULTIPLE_MARKETPLACE_ACCOUNTS` — **nunca escolhe a primeira**. Isso é usado em toda operação account-aware do projeto (Central de Vendas, Fechamento, OAuth ML). `listarContasDeClientesAtivos(clienteIds)` já é a versão em lote (usada por `/me/portfolio`), sem N+1.

## 7. Matriz das métricas

| Métrica | Definição | Fonte | Campo | Mensal | Semanal | Variação mês-a-mês | Status |
|---|---|---|---|---|---|---|---|
| FAT | Faturamento/Venda Total do período | `cliente360ResultadoService` (motor) / `cliente_360_resumos_mensais.faturamento` (snapshot) / `payload_json.porDia[].vendasBrutas` (diário, dentro do snapshot) | `resumo.faturamento` / `faturamento` / `porDia[].vendasBrutas` | SIM | **SIM** (somando `porDia` no intervalo da semana — já é o padrão usado por `dashboardService.js:237-247`) | SIM (`abs`+`pct`) | CONFIRMADO |
| LC | = `resultadoOperacional` = Venda Total − imposto − (tarifas+frete) − custo | `cliente360ResultadoService.montarResumo` / formula idêntica documentada em `Portal/relatorio-publico.js:373-378` | `resumoAtual.resultadoOperacional` | SIM (via motor, caro) | **NÃO** (sem componente diário persistido — só `faturamento` tem série diária) | SIM (`abs`+`pct`) | CONFIRMADO (equivalência validada, ver Seção 8) |
| MC | = `margemOperacional` = LC / Venda Total | idem LC; snapshot tem `mc_media` (de `relatorios`, o último salvo — não necessariamente da competência pedida) | `resumoAtual.margemOperacional` / `cliente_360_resumos_mensais.mc_media` | SIM | NÃO | SIM (`pp`, pontos percentuais) | CONFIRMADO, com ressalva de fonte (ver Seção 8) |
| INVEST ADS | Investimento total em Ads Mercado Livre da competência | `cliente360AdsService.getInvestimento` (resumo persistido `ads_resumos_mensais` → integração `mlAdsService` ao vivo) | `investimento_ads` / `ads.valor` | SIM | NÃO (só mês inteiro persistido; janela custom só ao vivo, caro em escala) | SIM (`abs`+`pct`) | CONFIRMADO |
| ACOS | Investimento Ads / GMV Ads × 100 | `server/services/ads/mlAdsService.js:369,541` (ao vivo) — **não** exposto por `cliente360AdsService` (decisão de produto explícita) | `acos` (calculado, não persistido como coluna própria; `ads_resumos_mensais` tem `gmv_ads` que permite derivar) | PARCIAL (derivável se `gmv_ads` persistido e >0) | NÃO | Derivável (`pp`) se ambos os meses tiverem `gmv_ads` | GAP DE PRODUTO (fonte existe, mas fora do contrato financeiro oficial — decisão precisa incluí-la) |
| TACOS | ADS / Receita Bruta × 100 | `cliente360AdsService.calcularTacos` / `cliente360SyncService.calcularTacos` / fórmula idêntica em `Portal/relatorio-publico.js:392-394` | `blocoAds.atual.tacos` / `cliente_360_resumos_mensais.tacos` | SIM | NÃO | SIM (`pp`) | CONFIRMADO |
| COM | Indefinido no produto hoje. Nenhum hit para "comunicação"/"comunicacao" no projeto inteiro. | Candidato mais próximo: integração ClickUp (`clickupService.js`, comentários/tarefas por cliente) — não persistida, não filtrada por carteira | — | NÃO | NÃO | NÃO | GAP DE PRODUTO — não implementar sem decisão |
| ATV | Indefinido. `activity_logs`/`activityLogService.js` é **auditoria técnica interna do app** (logins, ações admin), não atividade operacional do cliente — não confundir. Candidato: mesma integração ClickUp (contagem de tarefas por cliente). | ClickUp (`por_cliente` na resposta de `getResumoExecutivo`) — ao vivo, cache curto, sem histórico | — | NÃO | NÃO | NÃO | GAP DE PRODUTO |
| NPS | Indefinido como métrica recorrente. Único hit no projeto: campo `pontuacaoDesempenhoLoja.satisfacaoProduto` de um formulário de **diagnóstico inicial único** (onboarding), não uma pesquisa de satisfação recorrente/tracked. | — | — | NÃO | NÃO | NÃO | GAP DE PRODUTO/DADOS — não inventar |

## 8. FAT / LC / MC

Confirmação da equivalência semântica pedida pelo prompt, com evidência concreta:

`cliente360ResultadoService.js` (cabeçalho, linhas 12-17) declara textualmente:
```
resultadoOperacional = faturamento − comissão − frete − custo − imposto
resultadoAposAds     = resultadoOperacional − adsTotal
```

`Portal/relatorio-publico.js:373-378` (o relatório público que vai para o cliente final) declara, para o mesmo domínio de dado (fechamento Central de Vendas):
```
LC = Venda Total
   − (Venda Total × % Imposto)      ← tributos sobre a venda
   − (Venda Total − Total BRL)      ← tarifas + frete marketplace
   − (Custo unitário × Unidades)    ← custo do produto

MC = LC / Venda Total × 100
```

São a **mesma fórmula**: LC = resultadoOperacional, MC = margemOperacional. `LC` e `MC` já são vocabulário de produto real e usado (não é uma sigla nova inventada pelo wireframe) — aparecem em `Portal/relatorio-publico.js` (`getLcVal`, `getMcDec`, KPIs "LC total do fechamento"/"MC média do período") e em `Portal/cliente-360.js` / `cliente360CoberturaService.js` (`mc` por item). **Reaproveitar o motor oficial — não recalcular no painel.**

Duas ressalvas importantes, não equivalências perfeitas:
1. **`resultadoAposAds` ≠ "Resultado Final" do relatório público.** O relatório público subtrai também `venforce`/`affiliates` (despesas adicionais) de LC, não só Ads (`Portal/relatorio-publico.js:386`). O motor `cliente360ResultadoService` só chega até "resultado após Ads" — explicitamente não é lucro líquido (comentário linha 16-17). O painel deve mostrar `LC` e, se quiser uma coluna de "resultado após Ads", chamá-la assim, nunca "Resultado Final".
2. **`mc_media` no snapshot `cliente_360_resumos_mensais` vem do último `relatorios` salvo, não necessariamente da mesma competência do `faturamento` do snapshot** (`cliente360SyncService.js:138`, `mcMedia: ultimoRel ? ... : null` onde `ultimoRel = relatorios[0]` da consulta mais recente, sem filtro de competência). E o `faturamento` desse mesmo snapshot vem de uma fonte diferente (Orders API ao vivo via `metricasService.buscarResumo`, não do fechamento Central de Vendas). Isso significa que **hoje, o snapshot mensal mistura duas fontes que podem divergir**. Para o painel, isso precisa ser corrigido: ou (a) o backend do painel filtra `relatorios`/o fechamento pela competência exata pedida (mais correto, mais caro), ou (b) aceita-se a leitura atual do snapshot como aproximação e documenta-se a limitação na UI (mais barato, menos preciso). **Decisão humana necessária — ver Seção 29.**

## 9. Ads / ACOS / TACoS

`cliente360AdsService.js` confirma no próprio cabeçalho (linhas 6-9): "não busca ROAS, ACOS nem atribuição por produto" — By design, não é um bug nem uma lacuna de implementação, é escopo deliberado (o bloco Ads da Cliente 360 é só "descritivo": investimento total + TACoS).

ACOS **existe** de fato no projeto:
- `server/services/ads/mlAdsService.js:369` — `acos = totalAmount > 0 ? (cost / totalAmount) * 100 : 0` (via API oficial do Mercado Ads, métrica nativa `acos` no parâmetro `METRICS_PARAM`, linha 27).
- `Portal/ads.js:541` — `acos = gmv > 0 ? (cost / gmv) * 100 : 0`, comentário linha 141: `ACOS = investimentoAds / gmvAds * 100`.
- Já exibido em `Portal/ads.js` (tela de Anúncios/Ads) e em `Portal/cliente-360.js:2259` (`kpi('ACOS', ...)`) e testado em `Portal/visao-shell-ui.test.js` (garante que ACOS ausente mostra "—", nunca "0,0%" — mesma regra de honestidade que o resto do projeto usa).

A tabela `ads_resumos_mensais` (mensal, persistida, `cliente_slug + mes_ref + loja_campanha`) tem coluna `gmv_ads` mas **não tem coluna `acos` própria** — `resumoTemDado()` em `cliente360AdsService.js:78` já verifica o campo `roas` e `gmv_ads` na leitura, então a tabela está preparada para isso mesmo sem persistir ACOS diretamente. **Recomendação: derivar `ACOS = investimento_ads / gmv_ads × 100` na leitura, quando `gmv_ads > 0`; null caso contrário — nunca 0.**

Granularidade: só mensal. Não existe janela semanal persistida para Ads em lugar nenhum. A integração ao vivo (`mlAdsService.buscarPerformanceML`) aceita uma janela `{from,to}` customizada (usada hoje só para mês parcial), mas usar isso para gerar 4-5 semanas × N clientes seria uma chamada de API externa por cliente por semana — exatamente o risco de N+1/rate-limit que a Seção 18 do prompt pede para evitar. **Ads/ACOS semanal: retornar `null`/indisponível, nunca ratear o valor mensal.**

## 10. Comunicação / Atividades / NPS

**COM**: nenhuma ocorrência de "comunicacao"/"comunicação" em todo o projeto (`grep -rni` em `server`, `Portal`, `frontend-react`, zero hits). Não é um gap de granularidade — é ausência total de conceito de produto.

**ATV**: dois candidatos encontrados, nenhum serve como está:
1. `activity_logs` / `server/services/activityLogService.js` — é log técnico de auditoria do próprio app VenForce (login, ações administrativas: `INSERT INTO activity_logs (user_id, user_email, ..., acao, detalhes, ip, status)`). **Não é atividade operacional do cliente** — não deve ser confundido com "ATV" do painel.
2. `server/services/clickupService.js` / `clickupController.js` / `clickupRoutes.js` / `Portal/clickup-executivo.js` — integração real com uma lista do ClickUp (`Nova Gestão Tarefas`), resolve cliente por custom field, agrupa `por_cliente`, tem contagem de tarefas, comentários, responsáveis. É o candidato funcional mais próximo tanto de "ATV" (tarefas) quanto de "COM" (comentários/interações) — mas com três problemas para reuso direto:
   - É uma chamada **ao vivo** à API do ClickUp, com cache curto (TTL padrão 300s) — não há histórico persistido em banco VenForce, então não dá para responder "COM de FEV-26" depois que fevereiro passou, a menos que se adicione uma tabela de persistência.
   - **A rota (`server/routes/clickupRoutes.js:30-35`) usa só `requireAutomacoesAccess` (ou admin) — nenhum filtro de carteira por Squad.** Se o painel reaproveitar esse endpoint como está, qualquer usuário com acesso a automações veria dados de tarefas de clientes fora da sua carteira. **Não reaproveitar a rota como está; se a integração for usada, os dados precisam ser filtrados/reautorizados via `resolvePortfolioClientes` no novo endpoint do painel.**
   - Mapeamento "COM = comentários" vs "ATV = tarefas" (ou vice-versa) é uma decisão de produto que ninguém tomou ainda no código.

**NPS**: único hit em todo o projeto é `pontuacaoDesempenhoLoja.satisfacaoProduto`, um campo dentro do formulário de **diagnóstico inicial** (`Portal/diagnostico-inicial-schema.js:269`, `Portal/diagnostico-inicial.js:901`) — preenchido uma vez no onboarding do cliente, não uma pesquisa de satisfação recorrente. Não é NPS no sentido de "Net Promoter Score" tracked mensalmente.

**Recomendação**: tratar `COM`, `ATV`, `NPS` como fora do escopo da primeira implementação do painel (colunas presentes na UI, sempre `null`/"—" com um estado visual de "indisponível", nunca 0 nem dado inventado), e abrir uma frente de produto separada para decidir a fonte real antes de uma segunda fase. Isso está explicitamente permitido pelo prompt original ("propor o menor modelo persistente necessário, separado da primeira implementação").

## 11. Disponibilidade semanal

Não existe **nenhum** precedente de particionamento semanal no backend (`grep -rni "\bsemana\b"` em `server/**/*.js` e `server/sql/**/*.sql`, fora de testes: zero resultados). É uma decisão 100% em aberto.

Opções avaliadas:
- **(A) Semanas fixas por dia do mês** (S1=01–07, S2=08–14, S3=15–21, S4=22–fim, com S5 quando o mês tiver 5 blocos): compatível com o resto do sistema, que é inteiramente ancorado em competência `YYYY-MM` (relatórios, `ads_resumos_mensais.mes_ref`, `cliente_360_resumos_mensais.competencia`) e com dados diários simples (`payload_json.porDia[].data`, formato `YYYY-MM-DD`).
- **(B) Semana ISO**: cruza limites de mês (uma semana ISO pode ter dias de dois meses diferentes), o que não bate com nenhuma fonte financeira existente — o motor de fechamento e o snapshot mensal não têm noção de "semana que atravessa mês".
- **(C) Outra regra**: não há nenhuma no projeto.

**Recomendação técnica: Opção A.** É a única compatível sem retrabalho com as fontes existentes.

Granularidade real por métrica na semana (nunca ratear o valor mensal — regra do prompt, seguida):
- `FAT`: **disponível**, somando `payload_json.porDia[].vendasBrutas` no intervalo de dias da semana — mesmo padrão de LATERAL+`jsonb_array_elements` que `dashboardService.js:237-247` já usa em lote.
- `LC`, `MC`, `INVEST ADS`, `ACOS`, `TACOS`, `COM`, `ATV`, `NPS`: **sem fonte diária persistida** — semana retorna `null`/indisponível para essas colunas. Isso é uma limitação real dos dados, não uma escolha de implementação — não há como fazer melhor sem uma nova fonte diária de custo/Ads persistida.

## 12. Variação mês contra mês

Já existe um padrão pronto e testável em `cliente360ResultadoService.js:66-78`:
```js
delta(x,y)    = round2(y - x)                                   // null se x ou y forem null/undefined
deltaPct(x,y) = x !== 0 ? (y - x) / Math.abs(x) : null           // percentual (métricas absolutas: FAT, LC, ADS)
deltaPp(x,y)  = round2((y - x) * 100)                            // pontos percentuais (métricas de taxa: MC, ACOS, TACOS)
```
`montarVariacao()` (linhas 103-123) já aplica essa regra em produção, com `abs+pct` para FAT/resultadoOperacional/ads e `pp` para margemOperacional/tacos — **exatamente o contrato que o prompt pede**. O painel deve reusar essas três funções puras (extraídas ou reimplementadas identicamente) em vez de inventar uma nova.

Para `NPS` (se algum dia implementado): variação em pontos (não percentual), pela mesma lógica de `deltaPp`, já que NPS é uma escala fixa (-100 a 100 ou 0 a 10, a depender da metodologia escolhida — decisão de produto futura).

Regras obrigatórias já seguidas pelo motor oficial e que o painel deve herdar: anterior/atual ausente → `null`; nunca `Infinity` (o guard `x !== 0` em `deltaPct` previne isso); nunca 0 fabricado para ausência de dado (todo o `cliente360AdsService`/`cliente360ResultadoService` segue essa disciplina). Backend devolve números crus (sem formatação pt-BR) — `sanitizarParaJson()` (linhas 83-101) já existe para isso.

## 13. Arquitetura recomendada do backend

Três endpoints, seguindo exatamente o padrão de `/me/portfolio` (lote, sem N+1) e sempre com `resolvePortfolioClientes` como primeiro passo:

### `GET /painel-contas?ano=2026&squadId=&busca=`
```js
const autorizados = await resolvePortfolioClientes(req.user, pool);     // 1 query
const ids = autorizados.map(c => c.id);
const squadsPorCliente = await squadsRepo.squadsAtivosDeClientes(ids);  // 1 query (já existe)
const resumoUltimoMes = /* query em lote sobre cliente_360_resumos_mensais,
                            WHERE cliente_id = ANY($1) AND competencia = $2,
                            mesmo padrão de dashboardService.loadProductionData */
```
Resposta (exemplo):
```json
{
  "clientes": [
    {
      "id": 42, "slug": "acme", "nome": "Acme",
      "squad": { "id": 3, "nome": "Squad 1", "slug": "squad-1" },
      "ultimoMesDisponivel": "2026-08",
      "resumo": { "fat": 118400.5, "lc": 21200.1, "mc": 0.179, "ads": 4100, "acos": 0.041, "tacos": 0.0346 }
    }
  ],
  "squadsDoUsuario": [{ "id": 3, "nome": "Squad 1", "principal": true }]
}
```

### `GET /painel-contas/:clienteId/meses?ano=2026`
```js
const cliente = await assertClienteNaCarteira(req.user, req.params.clienteId, pool); // 404/403 canônicos
// lote de até 12 linhas de cliente_360_resumos_mensais WHERE cliente_id = $1 AND competencia LIKE '2026-%'
// variação mês-a-mês calculada no backend (Seção 12) contra o mês anterior de CADA linha
```

### `GET /painel-contas/:clienteId/meses/:competencia/semanas`
```js
const cliente = await assertClienteNaCarteira(req.user, req.params.clienteId, pool);
// lê o snapshot da competência, extrai payload_json.porDia, agrupa em S1-S4/S5 (Opção A, Seção 11)
// FAT por semana = soma de vendasBrutas no intervalo; demais métricas = null
```

## 14. Estratégia de lazy loading

Exatamente os três níveis já desenhados no prompt (lista → meses → semanas) mapeiam 1:1 nos três endpoints da Seção 13. Nenhum dado de mês ou semana é buscado na carga inicial. O ponto crítico de performance não é "quantos cliques", é: **a lista inicial não pode chamar `cliente360ResultadoService.getResultado()` por cliente** (motor caro, ver Seção 18) — precisa ler o snapshot já persistido em lote. Isso é o que torna a Opção A de lazy loading viável em vez de só "menos ruim".

## 15. Segurança / autorização por Squad

Checklist mental do prompt, resolvido:

- **ADMIN** → `resolvePortfolioClientes` já retorna todos os clientes ativos — nada a fazer, herda automaticamente.
- **COORDENADOR** → `funcao='coordenador'` em `squad_members` não muda a carteira (é RBAC de administração do Squad, não visibilidade de dados — `ehCoordenadorDoSquad`/`squadsCoordenadosPor` são usados só nas rotas admin de Squads, não em `resolvePortfolioClientes`). Um coordenador vê a mesma carteira de qualquer membro do(s) mesmo(s) Squad(s).
- **ANALISTA/AUXILIAR/outras roles internas** → mesma regra "interno" — carteira = clientes dos Squads ativos onde tem membership ativa.
- **SELLER** → preservado via `seller_clientes`, sem qualquer interação com Squad (confirmado no código, comentário explícito).
- **USUÁRIO SEM MEMBERSHIP** → com enforcement ON, carteira vazia (nunca 403 nas rotas `/me/*`; nas rotas `/painel-contas/*` que exigem `clienteId`, `assertClienteNaCarteira` devolve 403 `CLIENTE_FORA_DA_CARTEIRA`). Com enforcement OFF (estado atual), vê tudo — comportamento legado documentado, não é bug.
- **SQUAD INATIVO** → não dá carteira operacional, mesmo com vínculo `cliente_squad_history` "ativo" (`fim_em IS NULL`) — o JOIN com `squads.ativo=true` filtra isso estruturalmente.
- **CLIENTE TRANSFERIDO ENTRE SQUADS** → `cliente_squad_history` reflete o vínculo atual (`fim_em IS NULL`) e preserva o histórico anterior (`fim_em` preenchido); `encerrarResponsaveisSemAcessoAoSquad` já limpa responsabilidades órfãs na transferência.

**Nunca confiar em filtro enviado pelo frontend.** Toda rota do painel resolve a carteira no servidor primeiro (`resolvePortfolioClientes`/`assertClienteNaCarteira`) e só depois aplica `squadId`/`busca`/`ano` como filtros sobre esse conjunto já autorizado — nunca o contrário. Filtro de Squad enviado pelo frontend deve ser tratado como preferência de exibição, não como fonte de autorização (mesmo padrão que `clienteContasRoutes.js` já segue combinando `requireAutomacoesAccess` + `requireClienteNaCarteira`).

## 16. Estratégia de frontend

Levantamento do estado real (não suposição):

- **Fundação Global V2** (tokens + componentes): `Portal/css/vf-tokens-v2.css` + `Portal/css/vf-components-v2.css` — em uso real no Portal clássico hoje (presentes em todas as cópias de worktree ativas, sinal de que é o padrão corrente, não um laboratório isolado).
- **Shell V3**: é `Portal/vf-shell.js` — **JS vanilla**, não React. Monta sidebar de coluna única, dropdowns Cliente/Operação, gating por atributos `data-vf-scope`/`data-vf-module`/`data-vf-marketplaces`/`data-vf-capability`. Usado por **22 páginas** do Portal hoje.
- **React + Vite dentro do Portal**: padrão já estabelecido e repetido 4 vezes — `frontend-react/src/pages/{Cliente360Page,Cliente360V3Page,FinanceiroPage,VisaoPage}.jsx`, cada um publicado como bundle estático em `Portal/assets/<nome>/` e servido por uma página HTML fina do Portal (`Portal/cliente-360-react.html` é o exemplo mais claro) que ainda carrega `vf-shell.js` para a moldura (sidebar/contexto). **Não existe uma "Shell V3 em React"** — o shell continua sendo o JS vanilla, e as páginas React são "ilhas" publicadas dentro dele.
- **Componente reaproveitável direto**: `frontend-react/src/components/ui/VFMonthYearSelector/VFMonthYearSelector.jsx` — seletor de competência (mês+ano) da própria Fundação Global V2, já com popover via `createPortal`, contrato `"AAAA-MM"`. Serve como base para o filtro de Ano do painel (adaptar para seleção só de ano, ou reusar como está se o filtro também quiser granularidade de mês).
- **Tabela hierárquica expansível**: não existe nenhum componente pronto no projeto para o padrão exato Cliente→Mês→Semana. Precisa ser construído novo, seguindo a convenção de CSS-vars-only da Fundação V2 (mesmo padrão do `VFMonthYearSelector`).
- **Admin de Squads no frontend**: existe **só como protótipo estático standalone** em `Squads_migration/squads-admin-prototype/` (`index.html`/`app.js`/`css`, tracked em `origin/main`) — **não integrado** ao `vf-shell.js`, não é uma página real do Portal. Tratar como referência visual, não como código reaproveitável. `GET /squads` (backend) já filtra corretamente por membership (admin vê tudo, outros só os próprios Squads) — reaproveitável tal como está para popular um filtro de Squad.

**Recomendação de stack: nova página React + Vite, publicada em `Portal/` sob `vf-shell.js`, seguindo exatamente o precedente de `FinanceiroPage`/`VisaoPage`/`Cliente360V3Page`.** Isso minimiza reinvenção: reusa o shell, os tokens/componentes V2, o `VFMonthYearSelector`, e o pipeline de build/publicação já rodado 4 vezes. Não introduzir framework novo, não recriar sidebar.

## 17. Multi-conta / marketplace

Decisão avaliada com base no modelo existente, não por conveniência técnica:

- **(A) Painel agrega todas as contas do Cliente** — bate com a granularidade do wireframe (`CLIENTE | Squad | FAT | ...`) e com a granularidade do snapshot já persistido (`cliente_360_resumos_mensais` é por `cliente_id`, não por `cliente_conta_id`).
- **(B) Cliente → Conta → Mês → Semana** — exigiria uma fonte financeira **por conta e por mês**, que hoje não existe persistida (o snapshot é agregado por cliente); implicaria recalcular ao vivo por conta, reintroduzindo o problema de performance da Seção 18.
- **(C) Híbrido** — mostrar (A) como padrão e permitir um drill-in opcional "N contas" que reusa `listarContasDoCliente`/`listarContasDeClientesAtivos` (já em lote) para exibir só metadados de conta (nome, marketplace, status de grant), sem tentar quebrar FAT/LC/MC por conta.

**Recomendação: Opção A para a primeira implementação, com a porta aberta para (C) como extensão** — é a única que não exige inventar uma fonte financeira nova por conta. Isso precisa ser confirmado como decisão de produto (Seção 29), porque muda a leitura do painel para squads/clientes com múltiplas contas ativas do mesmo marketplace.

**Squad na experiência da tela** — distinção que o prompt pede explicitamente:
- **ROLE** = `users.role` (admin/seller/user/membro/interno) — controla o quê, no nível mais alto, o usuário pode fazer.
- **SQUAD** = carteira operacional (`squad_members` × `cliente_squad_history`) — controla quais clientes aparecem.
- **SQUAD PRINCIPAL** = `is_primary=true` em `squad_members`, exposto como `squadPrincipalId` em `/me/context` — é só uma preferência de UI (qual squad vem em destaque), nunca autorização adicional.
- **RESPONSABILIDADE DIRETA** = `cliente_responsaveis` (gestor/auxiliar/designer) — organização, não acesso; um usuário pode ser responsável direto por um cliente de um Squad que não é o seu principal, desde que tenha membership no Squad daquele cliente.
- **FILTRO VISUAL** = o `squadId` que o usuário escolhe no dropdown do painel — puramente client-side sobre o conjunto já autorizado pelo servidor (Seção 15). Usuário com 1 Squad só: esconder o filtro (`squads.length <= 1`, mesmo critério que `/me/portfolio` já expõe). Usuário com 2+: mostrar.

## 18. Performance e risco de N+1

Riscos concretos identificados, com evidência:

1. **`cliente360ResultadoService.getResultado(slug, ...)` é por cliente, caro** (roda `ponteEngine` + `produtosEngine` + `confiancaEngine` + `recuperacaoEngine` + `narrativaEngine` + busca Ads em paralelo, tudo síncrono por request). Chamá-lo N vezes para montar a lista inicial do painel é exatamente o antipadrão N×(meses×semanas×fontes) que o prompt pede para evitar. **Não usar este service na lista inicial do painel.**
2. **A branch de referência (`feat/central-executiva-contas`) cometeu exatamente esse erro**: `cliente360CarteiraService.getCarteiraExecutiva` chama `resultados.getResultado(cliente.slug, ...)` para **cada** cliente ativo (via `executarComLimite`, concorrência 4), ao vivo, sem cache, a cada `GET /carteira/resultado`. É um fan-out pesado por request. Não reaproveitar esse padrão de leitura.
3. **`resolveEffectivePortfolio`** (`dashboardService.js:218-221`) é 1 query — delega direto para `resolvePortfolioClientes`. Ponto de partida correto, já provado em produção.
4. **`dashboardService.loadProductionData`** (linhas 223-342) é o padrão de leitura em lote correto e já em produção: `WHERE c.id = ANY($1::int[])` com `LEFT JOIN LATERAL`, uma query para faturamento (via `porDia` desagregado com filtro de data) e uma para prontidão/margem — **zero N+1 para N clientes**. É o modelo a replicar para a lista inicial e para a expansão de meses do painel.
5. **`cliente_360_resumos_mensais` é a peça-chave, mas com uma ressalva séria de atualidade**: só é escrita por `cliente360SyncService.sincronizarResumoMensal`, chamado **exclusivamente** por `POST /sincronizar`, admin, **um cliente/competência por vez** (comentário explícito no arquivo: "ÚNICO fluxo pesado do Cliente 360. Só chamado pelo POST /sincronizar (admin)"). **Não há job automático/agendado que preenche essa tabela para toda a carteira.** Isso significa que o painel pode ter clientes com snapshot ausente ou desatualizado para um mês recente, dependendo de quando (e se) um admin clicou em sincronizar aquele cliente. Isso precisa ser exposto na UI (campo `sincronizado_em` já existe na tabela) e é um bloqueador real de confiabilidade para uma carteira grande — ver Seção 28.
6. Nenhuma tabela `ads_resumos_mensais`/`cliente_360_resumos_mensais` tem granularidade semanal — ver Seção 11.

## 19. O que pode ser reutilizado

- `authorizationService.resolvePortfolioClientes` / `canAccessCliente` / `assertClienteNaCarteira` / `assertClienteContaNaCarteira` (sem alteração).
- `carteiraMiddleware.requireClienteNaCarteira` / `requireClienteContaNaCarteira` (sem alteração).
- `squadsRepo.squadsAtivosDeClientes(ids)` / `responsaveisDeClientes(ids)` (batch, sem alteração).
- `GET /squads` (`squadsController.listar`) para o filtro de Squad do frontend — já filtra por membership corretamente.
- `dashboardService.loadProductionData` como **padrão de query** (não necessariamente o código exato) para leitura em lote de `cliente_360_resumos_mensais`.
- `cliente360ResultadoService.delta` / `deltaPct` / `deltaPp` como contrato de variação.
- `cliente360AdsService.calcularTacos` (fórmula) e a lógica "gmv_ads>0 → deriva ACOS, senão null".
- `listarContasDeClientesAtivos` (lote) se a Opção (C) da Seção 17 for adotada depois.
- Fundação Global V2 (`vf-tokens-v2.css`, `vf-components-v2.css`), `vf-shell.js`, `VFMonthYearSelector.jsx`, e o pipeline de publicação React→`Portal/assets/`.
- Algoritmo puro (não o wiring) de `cliente360CarteiraService.js` da branch de referência: `classificarSaude`, `agregarCausas`, `montarResumo`, `calcularScorePrioridade` — úteis como inspiração de priorização/health, se o painel algum dia precisar de indicadores de saúde além de números crus. Reescrever contra dados batch, não contra `getResultado` por cliente.

## 20. O que NÃO deve ser reutilizado

- `cliente360CarteiraService.getCarteiraExecutiva` **como está** — sem filtro de carteira (Seção 21).
- `server/routes/cliente360ResultadoRoutes.js:24` da branch de referência (`authMiddleware, requireAutomacoesAccess` sem `requireClienteNaCarteira`) como modelo de rota agregada.
- `clickupRoutes.js` como está — sem filtro de carteira; se os dados de ClickUp forem usados no painel, precisam de uma nova rota com `resolvePortfolioClientes`.
- Qualquer chamada direta a `cliente360ResultadoService.getResultado` em loop para montar uma lista de N clientes.
- `Squads_migration/squads-admin-prototype/` como código de produção (é protótipo visual desconectado do shell real).

## 21. Análise da branch `feat/central-executiva-contas`

Só em `remotes/gpt/feat/central-executiva-contas` (repositório auxiliar `venforce-server13`). **Defasagem: 21 commits só nela, 396 commits que `origin/main` já avançou e ela não tem** — está muito desatualizada, provavelmente anterior à fundação de Squads em sua forma atual.

Arquivos relevantes: `frontend-react/CENTRAL_EXECUTIVA.md`, `frontend-react/src/pages/CentralExecutivaPage.jsx`, `frontend-react/src/hooks/useCentralExecutiva.js`, `frontend-react/src/services/centralExecutivaApi.js`, `server/services/cliente360/cliente360CarteiraService.js`, `server/controllers/cliente360ResultadoController.js`, `server/routes/cliente360ResultadoRoutes.js`, `server/tests/cliente360Carteira.test.js`.

**Veredito de segurança (a pergunta crítica do prompt), com citação exata:**
- `cliente360CarteiraService.js`, função `getCarteiraExecutiva`: `const listagem = await clientes.getClientesOperacional();` — chamada **sem nenhuma restrição de cliente_id**. Não existe nenhuma chamada a `resolvePortfolioClientes`, `canAccessCliente` ou qualquer mecanismo de Squad em todo o arquivo.
- `server/routes/cliente360ResultadoRoutes.js:24` (branch antiga): `router.get("/carteira/resultado", authMiddleware, requireAutomacoesAccess, controller.obterCarteiraExecutiva);` — protegido **só** por papel (`requireAutomacoesAccess`), nunca por carteira.
- **Conclusão: confirmado, com certeza — esta branch tem um bypass de carteira real.** Qualquer usuário autenticado com acesso a automações (não precisa ser admin) vê o resultado financeiro agregado de **todos** os clientes ativos do sistema, independente de Squad. Isto é exatamente o padrão que o prompt original pediu para não aceitar ("não aceite `requireAutomacoesAccess` como substituto de autorização por carteira") — e o achado se confirma.

**Reaproveitável como referência**: sim, mas só a camada pura de agregação/priorização/narrativa (`classificarSaude`, `principalCausa`, `agregarCausas`, `montarResumo`, `calcularScorePrioridade`, `gerarNarrativaCarteira`) — são funções puras, sem I/O, sem autorização, e podem inspirar um recurso futuro de "saúde da carteira" no painel, desde que realimentadas com dados já filtrados por `resolvePortfolioClientes` e, de preferência, vindos do snapshot batch (Seção 18), não de `getResultado` por cliente ao vivo.

**Reaproveitável como estrutura de endpoint**: a forma da resposta (`resumo`, `causas`, `contas[]`) é um bom ponto de partida conceitual para o payload de `GET /painel-contas`, mas precisa ser reconstruída do zero em cima da autorização e da fonte de dados corretas — não é um "troca a autorização e usa".

## 22. Arquivos que precisarão ser criados

| Arquivo | Por quê | Risco | Dependências |
|---|---|---|---|
| `server/services/painelContas/painelContasService.js` | Orquestrador novo: lista, meses, semanas. Não existe hoje. | Médio — decisão de fonte de MC/LC batch (Seção 8) precisa estar fechada antes | `authorizationService`, `squadsRepository`, leitura em lote de `cliente_360_resumos_mensais` |
| `server/services/painelContas/painelContasRepository.js` | SQL isolado (padrão do projeto: repository separado de service) | Baixo | schema de `cliente_360_resumos_mensais`, `ads_resumos_mensais` |
| `server/controllers/painelContasController.js` | Handlers finos (padrão `cliente360ResultadoController`) | Baixo | service acima |
| `server/routes/painelContasRoutes.js` | 3 rotas da Seção 13, com `authMiddleware` + `requireClienteNaCarteira` onde aplicável | Baixo | `carteiraMiddleware` |
| `frontend-react/src/pages/PainelContasPage.jsx` | Página React nova, padrão `FinanceiroPage`/`VisaoPage` | Médio — componente de tabela hierárquica é novo | `vf-shell.js`, tokens V2, `VFMonthYearSelector` |
| `frontend-react/src/hooks/usePainelContas.js` | Estado de expansão/lazy loading | Baixo | endpoints acima |
| `frontend-react/src/services/painelContasApi.js` | Client HTTP | Baixo | — |
| `frontend-react/src/components/painelContas/TabelaHierarquica.jsx` (ou nome equivalente) | Componente novo — não existe nada igual no projeto | Médio-alto — maior peça de UI nova | tokens V2 |
| `Portal/painel-contas-react.html` | Página fina de publicação, igual `cliente-360-react.html` | Baixo | `vf-shell.js` |
| `server/tests/painelContas*.test.js` | Cobertura nova (Seção 26) | — | — |

## 23. Arquivos que precisarão ser modificados

| Arquivo | Por quê | Mudança prevista | Risco |
|---|---|---|---|
| `server/index.js` | Montar `app.use("/painel-contas", painelContasRoutes)` | Uma linha de wiring | Baixo |
| `Portal/vf-shell.js` (ou o mapa de navegação que ele lê) | Adicionar item de menu para a nova página, se aplicável | Config/dados, não lógica | Baixo |
| `server/services/cliente360/cliente360Repository.js` | Se a Seção 8 decidir filtrar `relatorios` por competência exata (não "mais recente") para consistência de `mc_media` | Nova função de leitura com filtro de competência | Médio — não alterar comportamento existente de quem já usa `findResumoMensal`/`findAdsResumoByCliente` |
| `server/sql/migrations/` (novo arquivo, se necessário) | Só se a decisão da Seção 24 for "criar índice novo" para consultas do painel por `(cliente_id, competencia)` em lote — o índice `idx_c360_resumo_slug_comp` já existe e pode bastar | Índice adicional opcional | Baixo |

## 24. Banco / migrations

**MIGRATION NECESSÁRIA: NÃO (para a primeira implementação, seguindo a Opção A da Seção 17 e a Seção 10).**

Justificativa: todas as tabelas necessárias já existem — `squads`, `squad_members`, `cliente_squad_history`, `cliente_contas`, `cliente_360_resumos_mensais` (já tem índice `idx_c360_resumo_slug_comp` em `(cliente_slug, competencia)`), `ads_resumos_mensais`. Nenhuma coluna nova é estritamente necessária para FAT/LC/MC/ADS/ACOS/TACOS mensal + FAT semanal.

**MIGRATION PARCIALMENTE NECESSÁRIA no futuro**, se e somente se: (a) a Seção 10 avançar para uma implementação real de COM/ATV (precisaria de uma tabela nova de atividade persistida por cliente/competência, populada por sync do ClickUp — fora do escopo desta primeira fase); (b) NPS ganhar uma fonte real de produto (pesquisa recorrente); (c) a Seção 8 decidir que `mc_media`/LC precisam ser persistidos explicitamente por competência no snapshot em vez de derivados do "último relatório" (mudança de schema em `cliente_360_resumos_mensais` ou nova coluna).

## 25. Contratos propostos

```json
// GET /painel-contas?ano=2026&squadId=3&busca=acme
{
  "ok": true,
  "squadsDoUsuario": [{ "id": 3, "nome": "Squad 1", "slug": "squad-1", "principal": true }],
  "clientes": [
    {
      "id": 42, "slug": "acme", "nome": "Acme",
      "squad": { "id": 3, "nome": "Squad 1", "slug": "squad-1" },
      "ultimoMesDisponivel": "2026-08",
      "sincronizadoEm": "2026-09-02T14:00:00.000Z",
      "resumo": {
        "fat": 118400.50, "lc": 21200.10, "mc": 0.1790,
        "ads": 4100.00, "acos": 0.0410, "tacos": 0.0346,
        "com": null, "atv": null, "nps": null
      }
    }
  ]
}

// GET /painel-contas/42/meses?ano=2026
{
  "ok": true,
  "cliente": { "id": 42, "slug": "acme", "nome": "Acme" },
  "meses": [
    {
      "competencia": "2026-01",
      "sincronizadoEm": "2026-02-01T09:00:00.000Z",
      "resumo": { "fat": 100000, "lc": 18000, "mc": 0.18, "ads": 3500, "acos": 0.038, "tacos": 0.035 },
      "variacaoVsMesAnterior": {
        "fat": { "abs": null, "pct": null },
        "lc":  { "abs": null, "pct": null },
        "mc":  { "pp": null }
      }
    },
    {
      "competencia": "2026-02",
      "sincronizadoEm": "2026-03-01T09:10:00.000Z",
      "resumo": { "fat": 113000, "lc": 20500, "mc": 0.181, "ads": 3900, "acos": 0.0402, "tacos": 0.0345 },
      "variacaoVsMesAnterior": {
        "fat": { "abs": 13000, "pct": 0.13 },
        "lc":  { "abs": 2500, "pct": 0.1389 },
        "mc":  { "pp": 0.1 }
      }
    }
  ]
}

// GET /painel-contas/42/meses/2026-02/semanas
{
  "ok": true,
  "competencia": "2026-02",
  "definicaoSemana": "dias_fixos_01_07_08_14_15_21_22_fim",
  "semanas": [
    { "semana": "S1", "de": "2026-02-01", "ate": "2026-02-07", "resumo": { "fat": 26000, "lc": null, "mc": null, "ads": null, "acos": null, "tacos": null } },
    { "semana": "S2", "de": "2026-02-08", "ate": "2026-02-14", "resumo": { "fat": 28500, "lc": null, "mc": null, "ads": null, "acos": null, "tacos": null } }
  ]
}
```

Contrato de erro (mesmo padrão de `carteiraMiddleware`): `404 CLIENTE_NAO_ENCONTRADO`, `403 CLIENTE_FORA_DA_CARTEIRA` — nunca vazamento de `access_token`/`refresh_token`/`api_key`/secrets (seguir `maskSensitiveData` de `cliente360ResultadoController.js` como referência de guard final).

## 26. Plano de testes

**Autorização**
- admin vê clientes de vários Squads na lista inicial.
- coordenador (e membro comum) não vê cliente de Squad ao qual não pertence.
- usuário multi-Squad vê a união correta (via `resolvePortfolioClientes`, já testado na fundação — reusar os mesmos fixtures).
- usuário sem carteira (enforcement ON, sem membership) → lista vazia, nunca 403 na rota de lista.
- Squad inativo não concede carteira, mesmo com `cliente_squad_history.fim_em IS NULL`.
- cliente transferido de Squad → aparece só no Squad atual; histórico correto em endpoint de detalhe se exposto.
- `GET /painel-contas/:clienteId/meses` com um `clienteId` fora da carteira via URL direta → 403 `CLIENTE_FORA_DA_CARTEIRA`.

**Dados**
- cliente sem nenhum `cliente_360_resumos_mensais` (nunca sincronizado) → linha com `resumo: null`/indisponível, nunca erro 500.
- mês sem Ads (`ads_investido` null) → `tacos`/`acos` null, nunca 0.
- `gmv_ads` ausente ou 0 → `acos` null.
- mês anterior ausente (primeiro mês do cliente) → `variacaoVsMesAnterior` com todos os campos `null`.
- mês anterior com valor 0 → `deltaPct` retorna `null` (guard `x !== 0`), nunca `Infinity`.
- cliente com 2+ contas do mesmo marketplace → resumo agregado (Opção A) não deve duplicar nem cair em ambiguidade (contraste com `resolveMarketplaceAccountContext`, que erroaria — o painel não deve chamar esse caminho).
- mês parcial (mês corrente, ainda não fechado) → sinalizar isso no payload (reaproveitar a noção de `parcial` já usada em `cliente360AdsService`), não tratar como mês fechado.
- semana sem granularidade suficiente (LC/MC/ADS) → `null` explícito, nunca valor mensal ratado.

**Variação**
- valor sobe → `abs` e `pct` positivos.
- valor cai → negativos.
- taxa (MC/ACOS/TACOS) → `pp`, nunca `pct`.
- `null` em qualquer ponta → resultado `null`.

**Performance**
- lista inicial com N=50 clientes → número fixo de queries (não escalar linearmente com N além do `ANY($1::int[])`).
- expandir 1 cliente não deve disparar nenhuma query sobre os outros N-1 clientes.
- payload da lista inicial não deve crescer com o número de meses/semanas (isso só entra na expansão).

**Contrato**
- nenhuma resposta de `/painel-contas/*` expõe `access_token`, `refresh_token`, `api_key`, `client_secret` (teste de guard, espelhando `cliente360ResultadoController.maskSensitiveData`).

## 27. Ordem cirúrgica de implementação

- **ETAPA 1** — contrato/backend mínimo: `painelContasRepository` lendo `cliente_360_resumos_mensais` em lote (sem endpoint ainda), com teste unitário isolado.
- **ETAPA 2** — autorização: `painelContasService.listar(user, {ano, squadId, busca})` chamando `resolvePortfolioClientes` primeiro, filtros depois; testes de carteira da Seção 26 passando antes de qualquer UI.
- **ETAPA 3** — resumo inicial: `GET /painel-contas` completo, com `ultimoMesDisponivel`/`sincronizadoEm` expostos (transparência sobre dado potencialmente desatualizado — Seção 28).
- **ETAPA 4** — meses: `GET /painel-contas/:clienteId/meses` com `assertClienteNaCarteira` + variação (reusar `delta`/`deltaPct`/`deltaPp`).
- **ETAPA 5** — semanas: `GET /painel-contas/:clienteId/meses/:competencia/semanas`, só FAT, resto `null`, com a definição de semana da Seção 11 (decisão humana confirmada antes desta etapa — Seção 29).
- **ETAPA 6** — variações: revisão cruzada das regras null/Infinity/0 contra a Seção 12, antes de tocar frontend.
- **ETAPA 7** — frontend: `PainelContasPage.jsx` + `TabelaHierarquica` + `usePainelContas`, publicado em `Portal/` sob `vf-shell.js`.
- **ETAPA 8** — estados: loading (3 níveis), erro localizado, sem clientes, cliente/mês sem dado, métrica indisponível (`null`→"—"), dado parcial, retry.
- **ETAPA 9** — testes: bateria completa da Seção 26, incluindo os testes de N+1 (contagem de queries).
- **ETAPA 10** — integração: item de navegação em `vf-shell.js`, revisão final de segurança (rodar o checklist da Seção 15 manualmente contra o ambiente real).

## 28. Riscos e bloqueadores

1. **Cobertura/atualidade de `cliente_360_resumos_mensais` não é garantida** — só populada por sync manual admin, cliente a cliente. Numa carteira grande, é esperado que vários clientes não tenham snapshot recente. Isso precisa ser comunicado na UI (não é bug do painel, é limitação de dado upstream) e pode motivar, em uma fase futura, um job agendado de sincronização em lote — fora do escopo desta auditoria decidir isso sozinho.
2. **Inconsistência de fonte dentro do próprio snapshot** (Seção 8, ressalva 2): `faturamento` (Orders API) e `mc_media` (último `relatorios`, não necessariamente da mesma competência) vêm de caminhos diferentes — decisão humana pendente.
3. **`SQUADS_ENFORCEMENT` está OFF neste ambiente** — qualquer teste manual do painel hoje mostrará carteira ampla (todos os clientes) para papéis internos, não a carteira restrita por Squad. Isso é esperado e não deve ser confundido com um bug de autorização do painel novo.
4. **ACOS não é dado oficial do contrato financeiro** — incluir no painel exige uma decisão de produto explícita sobre se ele "sai" do escopo do motor Cliente 360 (Seção 9).
5. **COM/ATV/NPS sem fonte confiável** — risco de pressão para "inventar" algo rápido; a auditoria recomenda explicitamente não fazer isso.
6. **Nenhum componente de tabela hierárquica existente** — é a maior peça de esforço de frontend não coberta por reuso.

## 29. Decisões humanas ainda necessárias

| ID | Decisão | Opções | Impacto | Recomendação técnica |
|---|---|---|---|---|
| D2 | Fonte de MC/LC do snapshot: recalcular filtrando `relatorios` pela competência exata vs. aceitar "último relatório" como aproximação | (a) mais correto, mais caro; (b) mais barato, pode divergir do mês exibido | Médio — afeta confiabilidade da coluna MC no painel | (a) para o painel novo, já que ele existe justamente para comparação mês-a-mês confiável |
| D3 | Granularidade do painel: Cliente agregando todas as contas (A) vs. Cliente→Conta (B) vs. híbrido (C) | Seção 17 | Alto — muda o modelo de dado e a UI | (A) para a primeira versão, (C) como evolução |
| D4 | Definição de "semana" | dias fixos do mês (A) vs. ISO (B) | Médio — muda o cálculo de todo o nível 3 da hierarquia | (A) |
| D5 | Incluir ACOS no painel mesmo fora do contrato financeiro oficial? | sim, derivado de `gmv_ads` / não, só quando entrar oficialmente no motor | Médio | Sim, com rótulo explícito de fonte diferente, já que o dado existe e é confiável quando `gmv_ads` está presente |
| D6 | COM/ATV/NPS: implementar na v1 com fonte "melhor esforço" (ClickUp) ou deixar 100% fora até haver fonte de produto real? | v1 melhor-esforço vs. adiar | Alto — decide se abre uma frente de produto nova (persistência + reautorização do ClickUp) | Adiar — nenhuma fonte atual atende ao padrão de confiabilidade/autorização do resto do painel |
| D7 | Cobertura de sincronização: manter sync 100% manual ou propor job agendado para popular `cliente_360_resumos_mensais` de toda a carteira? | manual vs. agendado | Alto — sem isso, o painel pode parecer "quebrado" para clientes nunca sincronizados | Fora do escopo desta auditoria decidir sozinha; recomenda-se ao menos expor `sincronizadoEm` de forma proeminente na v1 |

## 30. Checklist para Claude Code

- [ ] Criar `server/services/painelContas/painelContasRepository.js` — leitura em lote de `cliente_360_resumos_mensais` (+ `ads_resumos_mensais` se ACOS entrar), seguindo o padrão LATERAL de `dashboardService.js:223-342`.
- [ ] Criar `server/services/painelContas/painelContasService.js` — `resolvePortfolioClientes` sempre primeiro; filtros de `squadId`/`busca`/`ano` só depois, em memória ou SQL sobre o conjunto já autorizado.
- [ ] Implementar as três rotas da Seção 13 com `authMiddleware` + (`requireClienteNaCarteira` nas rotas com `:clienteId`).
- [ ] Implementar variação mês-a-mês reusando a lógica de `delta`/`deltaPct`/`deltaPp` de `cliente360ResultadoService.js`.
- [ ] Implementar ACOS derivado (`investimento_ads/gmv_ads`, null se `gmv_ads` ausente/0) — só depois de D5 confirmada.
- [ ] Implementar semanas com a Opção A (Seção 11) — só depois de D4 confirmada — FAT via `porDia`, resto `null`.
- [ ] Deixar COM/ATV/NPS como colunas presentes mas sempre `null`/indisponível na v1, salvo D6 decidir o contrário.
- [ ] Escrever os testes da Seção 26 antes/junto do backend (autorização primeiro).
- [ ] Construir `PainelContasPage.jsx` + hook + serviço HTTP + `TabelaHierarquica` novo, publicados via Vite em `Portal/assets/painel-contas/`, com uma `Portal/painel-contas-react.html` fina carregando `vf-shell.js`.
- [ ] Reusar `VFMonthYearSelector` para o filtro de ano e `GET /squads` para o filtro de Squad.
- [ ] Rodar manualmente o checklist de segurança da Seção 15 contra dados reais antes de considerar pronto.
- [ ] Não tocar em `server/routes/clickupRoutes.js`, `cliente360CarteiraService.js` (branch antiga) ou qualquer código de `Squads_migration/squads-admin-prototype/` como parte desta implementação.
- [ ] Não criar nenhuma migration nesta fase (Seção 24), salvo decisão humana explícita em contrário.
