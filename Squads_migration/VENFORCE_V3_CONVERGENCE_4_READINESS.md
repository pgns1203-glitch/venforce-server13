# VENFORCE V3 — CONVERGÊNCIA #4

## 1. Identificação

| | |
|---|---|
| Data | 2026-09-01 |
| Main base | `origin/main` @ `e6549f741302ec1010ae3e04749d0da4417ca1e5` (reconfirmado por `git fetch` no início — batia exatamente com o SHA canônico esperado, sem drift) |
| Pessoa 1 (frontend) | `frontend/v3-final-qa-cutover-prep` @ `4a043cd50edc18b4ce4d129961c6d4f104919b99` |
| Pessoa 2 (backend) | `backend/v3-rollout-preflight-account-audit` @ `17d32362ec95dbcdbde6b12a21477c54b79b7190` |
| Integration branch | `integration/v3-convergence-4` |
| HEAD final | `401b75ef080dfbb93105effd664f8cbfed4e5a99` |

## 2. Objetivo

Unir as duas maratonas independentes (backend account-audit/P2.9 preflight, frontend final-QA/cutover-prep) numa única branch, fechar os gaps cross-layer que cada uma deixou explicitamente para esta convergência (D-8, evidência Shopee, decisão do menu Financeiro), provar conta→token→base ponta-a-ponta, e produzir um veredito de cutover com evidência — sem atravessar a fronteira humana do P2.9 (sem enforcement, sem migração real, sem dado humano inventado).

## 3. Ordem de merge

Backend primeiro (`622e555`), frontend depois (`3adc218`) — exatamente a ordem recomendada por ambos os handoffs: o backend estabelece os contratos account-aware (`resolveMarketplaceAccountContext`, códigos canônicos, `accountContextInvariant.js`) que o frontend consome, e o frontend não toca `server/**` (confirmado por `git diff --name-only`).

## 4. Resultado da integração

**Conflitos: nenhum, em nenhum dos dois merges.** Ambos com `git merge --no-ff`, sem squash. `git log --oneline e6549f7..HEAD` confirma todos os 15 commits das duas branches presentes e íntegros (7 da Pessoa 2 incluindo o checkpoint documental `17d3236`, 5 da Pessoa 1 incluindo seu checkpoint `4a043cd`), mais os 4 commits novos desta convergência. `git diff --name-only <main> <sha-P1>` confirma zero arquivo em `server/**` do lado da Pessoa 1.

## 5. Entrega Pessoa 1

ErrorBoundary nas 4 ilhas React, fix de corrida em Ads/Anúncios (+ o achado extra de `carregarAnuncios()` ignorando troca de conta silenciosamente), estabilização da suíte headless (bomba-relógio de data, `Invalid InterceptionId`), teste ponta-a-ponta do gate de custos obrigatório do Shopee no Fechamento. Ver `Squads_migration/VENFORCE_V3_PESSOA1_FINAL_QA_CUTOVER_PREP.md` para o detalhe completo.

## 6. Entrega Pessoa 2

Correções account-scope (BUG-1: `mlUserId` propagado a GETs seller-scoped de Margem/Diagnóstico/Precificação que ainda caíam no grant principal), `accountContextInvariant.js` (novo, `checkAccountContext`/`assertAccountContext`), pacote P2.9 Pre-Flight portado e revalidado contra `e6549f7`, `accountScopeInvariantesV3.test.js` (17 verificações, fixture WBS). Ver `Squads_migration/VENFORCE_V3_PESSOA2_ACCOUNT_AUDIT_P2_9_PREFLIGHT.md`.

## 7. Account-awareness final

| Módulo | ClienteConta | Seller | Token | Base | Frontend stale guard | Status |
|---|---|---|---|---|---|---|
| Automações | `clienteContaId` explícito, nunca `is_primary` | `mlUserId` da conta | grant exato | client-level (D-8 corrigido, ver §12) | N/A (recarrega ao trocar conta) | ✅ |
| Central de Vendas | `clienteContaId` via repositório, fail-closed | `mlUserId`/`sellerId` | grant exato | por conta | AbortController pré-existente | ✅ |
| Ads | `mlFetchOptions(mlUserId)` em todo `mlFetch` | `mlUserId` | grant exato | n/a | token de sequência (nesta convergência era P1, verificado) | ✅ |
| Anúncios ML | idem | `mlUserId` no path e nas options | grant exato | n/a | token de sequência | ✅ |
| Margem | `mlUserId` propagado (BUG-1 corrigido) | `mlUserId` | grant exato | client-level, intencional (§14 do master spec) | — | ✅ |
| Diagnóstico | `mlUserId` propagado (BUG-1 corrigido) | `mlUserId` | grant exato | client-level → D-8 corrige quando conta resolvida | — | ✅ |
| Financeiro V3 | `clienteContaId` provado (`validarContaDoCliente`) | n/a | n/a | `resolverBaseVinculada`, account-aware, 409 se ambíguo | `useFinanceiro.js` (seqRef+AbortController) | ✅ |
| Precificação (preview) | `clienteContaId` → `resolveMarketplaceAccountContext` | `mlUserId` | grant exato | **D-8 corrigido nesta convergência** | — | ✅ |
| Sidebar Financeiro | `meta.marketplace` resolvido pelo Shell | n/a | n/a | n/a | `resolverRota()` novo, aditivo | ✅ (nesta convergência) |

## 8. Bugs resolvidos

1. **D-8** (`contextoPrecificacaoService` client-level) — ver §12.
2. **Sidebar Financeiro sem roteamento por marketplace** — ver §11/§15.

Nenhum bug NOVO encontrado além destes; BUG-1 (P2) já estava resolvido na branch integrada.

## 9. Financeiro

**MELI**: nativo V3 completo, testado ponta-a-ponta (upload → processar → competência → preview → salvar → duplicidade/substituir → publicar → abrir link → despublicar). Sem alteração nesta convergência.

**Shopee**: era PARCIAL (upload/processamento provado, abas de leitura só por inferência). Fechado nesta convergência — ver §10.

**TikTok**: continua legado. `POST /fechamentos/financeiro` já exige `costsBaseId`; falta o contrato de bases elegíveis por (cliente+tiktok) — não implementado (decisão consciente, ver §13). Nenhuma mudança de comportamento.

## 10. Shopee evidence gap — FECHADA

Antes: Resultado, Conciliação, Relatórios gerados, Histórico, Publicar/Despublicar usavam o mesmo código de MELI (confirmado lendo `FinanceiroPage.jsx`: zero `if (marketplace)` nessas abas), mas nenhuma fixture Shopee tinha exercitado esse caminho.

Depois: `Portal/financeiro-v3-shell-ui.test.js` ganhou 4 checks novos navegando com um payload `marketplace: "shopee"` marcado através de todas as abas de leitura + o ciclo publicar/despublicar real (escreve no backend fake, relê do servidor). `NovoFechamento.test.jsx` ganhou 1 teste novo cobrindo 409 `ENTREGA_JA_EXISTE` → substituir com fixture Shopee (Salvar/Duplicidade/Substituir, capacidades que só tinham fixture MELI). 24/24 no headless (era 20), 9/9 no componente (era 8).

**Capacidades agora com evidência Shopee direta**: Resultado, Conciliação, Salvar, Duplicidade, Substituir, Publicar, Despublicar, Relatórios, Histórico. Upload/Processamento já tinham evidência (Pessoa 1).

## 11. Cutover

| | Veredito |
|---|---|
| **MELI** | **GO** |
| **Shopee** | **GO** — lacuna de evidência fechada (§10); nenhum bug encontrado ao fechá-la |
| **TikTok** | **NO-GO** (estrutural — `cliente_contas` não suporta TikTok, D-9 pendente) |

**Menu Financeiro**: implementado nesta convergência (não ficou como bloqueio de produto). Ver §15.

## 12. Multi-base / contextoPrecificacao (D-8)

**RESOLVIDA.** `contextoPrecificacaoService.resolverContextoPrecificacao` agora: quando a conta já foi resolvida (explícita via `clienteContaId`, ou auto-resolvida por ser a única ativa — legado single-account), narrows para a base daquela conta (via `cliente_conta_id` no vínculo), nunca reabre ambiguidade client-level. Conta explícita sem base própria → `BASE_AUSENTE`, nunca `BASE_AMBIGUA` por causa da base de outra conta. Sem conta explícita (cliente sem `cliente_contas` cadastradas) → ambiguidade client-level preservada, comportamento legado intacto.

**Achado durante a implementação, corrigido antes de commitar**: a primeira versão da correção (usar `resolveMarketplaceAccountContext(...).base` diretamente via `obterBaseDaConta`) quebrou dois testes pré-existentes e verdes (`precificacaoServiceContaScoped.test.js`, `promocoesRetornoContaScoped.test.js`) que modelam um estado real: cliente com 2 contas ML mas a base ainda vinculada só a nível de cliente (`cliente_conta_id` NULL — não migrada por conta ainda). `obterBaseDaConta` é deliberadamente conservador nesse caso (2+ contas + vínculo não migrado = recusa resolver). A correção final não depende de `obterBaseDaConta`: filtra `basesMeli` (que já traz todas as bases do cliente, agora com `cliente_conta_id` de cada vínculo) por "pertence a ESTA conta ou ainda não foi migrado por conta" — nunca "pertence a OUTRA conta". Isso resolve D-8 **e** preserva o caso híbrido real, sem exigir migração de dado. Os dois testes pré-existentes voltaram a passar sem alteração neles.

Testes: `server/tests/contextoPrecificacaoContaScoped.test.js` (13 checks, nível de service, inclui o caso híbrido) + `server/tests/precificacaoServiceD8ContaBase.test.js` (5 checks, nível cross-layer — prova que a query de custos real usa o `base_id` correto por conta, capturando os parâmetros da query, não montando a stack HTTP/Express inteira porque o controller é um passthrough sem lógica própria).

## 13. TikTok

**Estado**: legado, inalterado. `cliente_contas` continua sem suporte a TikTok (confirmado por leitura de código, não presumido).

**Contrato pendente (D-9)**: `GET /clientes/:cliente/bases-elegiveis?marketplace=tiktok` — proposto pela Pessoa 2, não implementado.

**Motivo de não implementar ClienteConta TikTok**: mission §12 proíbe explicitamente inventar isso sem especificação arquitetural própria; a Base TikTok hoje não tem vínculo de cliente que a auditoria tenha encontrado, e resolver isso exige decisão humana (a Base TikTok passa a ter vínculo com cliente, ou o endpoint lista todas as bases TikTok ativas — D-9 no handoff da Pessoa 2). Nenhuma mudança de schema/CHECK foi feita.

## 14. Grants

Sem alteração nesta convergência. Classe `AMBIGUOUS` (grant sem `cliente_conta_id`, cliente com 2+ contas) continua exigindo decisão humana por grant (D-4). Nenhum backfill automático executado ou proposto como automático.

## 15. Bases

`resolverBaseVinculada` (Financeiro) e a nova regra de `contextoPrecificacaoService` (§12) são consistentes entre si: as duas narrow por `cliente_conta_id` quando a conta é conhecida, e tratam vínculo não migrado (`cliente_conta_id` NULL) como "ainda não migrado", não como "pertence a ninguém em particular" nem "pertence a todo mundo".

**Sidebar Financeiro (mission §15) — IMPLEMENTADO**: `Portal/vf-shell.js` — o módulo `financeiro` ganhou um campo opcional `rotaPorMarketplace: { meli: "financeiro-v3.html", shopee: "financeiro-v3.html" }`. `buildHref`/`itemNav` resolvem a rota pelo `meta.marketplace` já disponível no render (confirmado lendo o código antes de implementar: os 4 call sites de `itemNav` para módulos contextuais já recebiam `meta`). Sem marketplace resolvido, ou marketplace fora do mapa (TikTok, sem contexto) → cai em `rota` (o legado) — o item **nunca** fica sem destino, nunca escondido. Nenhum outro módulo foi tocado; só `financeiro` ganhou o campo (aditivo, verificado por teste — nenhum outro item ganhou `rotaPorMarketplace` sem querer).

Isto seguiu exatamente a orientação da mission §15: implementado porque coube como mudança pequena, clara e testável dentro do mecanismo já existente (nenhuma rota especial hardcoded, nenhuma duplicação de menu). O caso "sem conta resolvida" (TikTok) não tem fixture possível hoje porque `cliente_contas` não modela TikTok (D-9) — o fallback foi verificado por leitura direta do código (`resolverRota` sempre retorna `mod.rota` quando `meta`/`meta.marketplace` estão ausentes ou fora do mapa), não por teste de integração, e isso está registrado como tal, não inflado para "testado".

## 16. Squads P2.9 Preflight

Sem execução, sem alteração além do que a Pessoa 2 já trouxe (pacote portado + revalidado contra `e6549f7`). Nada tocado nesta convergência.

## 17. Migrations

Nenhuma migration aplicada. `20260817_cliente_contas_foundation.sql` (manual) e `20260828_entregas_cliente_unicidade_p26.sql` (D4, `auto:false`) permanecem NÃO aplicadas, exatamente como determinado. Squads DDL continua auto/idempotente no boot; dados de Squads continuam não migrados.

## 18. Enforcement

`SQUADS_ENFORCEMENT` não tocado. Continua OFF por padrão (fail-safe confirmado pela suíte `squadsRolloutSafety.test.js`, já existente, revalidada no run completo).

## 19. Observabilidade

**Investigado, NÃO fechado — decisão consciente, não descuido.** A mission (§24) autorizava fechar a lacuna (códigos `MULTIPLE_MARKETPLACE_ACCOUNTS`/`CONTA_INATIVA`/`BASE_AMBIGUA`/`BASE_AUSENTE`/`GRANT_DESCONECTADO` não entram no log estruturado dedicado, só no registro genérico de erro do request) **somente se fosse pequeno e uniforme**, com a instrução explícita de parar se exigisse tocar múltiplos controllers individualmente.

Investigação: `carteiraMiddleware.responderErro` (o boundary que já faz isso para 403 de carteira) é específico dos 3 guards de carteira (`requireClienteNaCarteira`/`requireClienteContaNaCarteira`/`requireBaseNaCarteira`) — os códigos de conta/base vêm de `resolveMarketplaceAccountContext`/`contextoPrecificacaoService`, lançados dentro de services e capturados individualmente por `catch (err) { responderErroService(res, err) }` em pelo menos 2 controllers com implementações LOCAIS e duplicadas de `responderErroService` (não um helper compartilhado), e os códigos aparecem em pelo menos 16 arquivos entre controllers e services. Não existe hoje um seam único para esses códigos — fechar isso "de forma pequena e uniforme" exigiria criar um novo módulo compartilhado E migrar múltiplos controllers para usá-lo, o que a mission pediu explicitamente para NÃO fazer nesta convergência.

**Resultado**: nenhuma mudança de código. Registrado como dívida não bloqueante, idêntico ao que a Pessoa 2 já havia encontrado e documentado (`VENFORCE_V3_PESSOA2_ACCOUNT_AUDIT_P2_9_PREFLIGHT.md` §14/§20).

## 20. QA visual

**Não foi possível nesta sessão** — a extensão `claude-in-chrome` não conectou neste ambiente (`Browser extension is not connected`), a mesma limitação que a Pessoa 1 já havia registrado na sessão dela. Evidência estrutural/visual disponível: os 17 arquivos headless (Chrome real via CDP puro, computed style real, não jsdom) cobrindo as 19 páginas Shell V3, incluindo as novas checagens desta convergência (Shopee nas abas de leitura, roteamento do Financeiro por marketplace). Nenhum screenshot novo capturado nesta sessão (os 2 já existentes de `financeiro-v3-shell-ui.test.js` continuam sendo gerados por aquele teste). **Pendência real, registrada como tal — não "QA completo".**

## 21. Frontend tests

| Suíte | Baseline (P1) | Final desta convergência |
|---|---|---|
| Vitest | 11 arquivos · 137/137 | 11 arquivos · **138/138** (+1: Shopee duplicidade/substituir) |
| Headless Portal | 17 arquivos · 17/17 | 17 arquivos · **17/17** (financeiro-v3: 24 checks, era 20; vf-shell-ui: 25 checks, era 23) |
| Builds React (4 modos) | limpo | limpo, sem diff contra `Portal/*.html`/`assets/*` commitados |

## 22. Backend tests

| | Baseline documentado (P2) | Medido nesta convergência |
|---|---|---|
| Suíte completa (`run-all.js`, 4 falhas puladas) | 170 arquivos verdes | **174 arquivos verdes** (+4: os 3 testes novos desta convergência + 1 do merge que não estava no count anterior) |
| Falhas pré-existentes | 4 (`basesTiktok`, `designStudioWorkspace`, `designTemplateEngine`, `mlTokenService`) | **Medido e corrigido nesta convergência: só 2 realmente falham** (`designStudioWorkspace.test.js`, `mlTokenService.test.js`) — `basesTiktok.test.js` e `designTemplateEngine.test.js` passam de forma limpa e reprodutível quando rodados isoladamente neste ambiente. Não investiguei a causa da divergência com o baseline documentado (pode ser diferença de ambiente/dependências entre sessões) — reporto o que medi agora, não o que o documento antigo dizia. |
| `accountScopeInvariantesV3.test.js` | 17 verificações | **17/17**, sem alteração |
| Novos testes desta convergência | — | `contextoPrecificacaoContaScoped.test.js` (13/13), `precificacaoServiceD8ContaBase.test.js` (5/5) |

## 23. Cross-layer tests

- **A. Automações multi-conta**: já coberto (`automacoes-shell-ui.test.js`, `automacoesContaScoped.test.js`) — revalidado nesta convergência, verde, não duplicado.
- **B. Ads/Anúncios troca rápida de conta**: já coberto (`ads-anuncios-shell-ui.test.js`, `planilhaPrecificacaoSemBaseContaScoped.test.js`) — revalidado, verde.
- **C. Precificação multi-conta + Base**: **novo nesta convergência** — `contextoPrecificacaoContaScoped.test.js` (service) + `precificacaoServiceD8ContaBase.test.js` (cross-layer, prova que a query de custos real usa o `base_id` certo por conta).
- **D. Financeiro MELI**: já coberto (`financeiro-v3-shell-ui.test.js`) — revalidado, verde.
- **E. Financeiro Shopee**: **fechado nesta convergência** (§10).

## 24. Builds

4/4 limpos (`cliente-360-react`, `full-gestao`, `visao`, `financeiro`). `git status --short Portal/*.html Portal/assets/` vazio após o build final — nenhum bundle divergente do commitado. Nenhuma ilha React nova compartilhando chunk indevido (só os 4 pontos de entrada de sempre).

## 25. Regressões

**Nenhuma regressão de produto.** Uma falha de AMBIENTE reapareceu durante os runs em lote: `e2e-jornada-completa.test.js` falhou 2 vezes na etapa de navegação para `ads.html` durante execuções seriais completas dos 17 arquivos headless (memória livre medida em ~355MB no momento da falha, com ~6.4GB em swap). Isolei a causa com rigor antes de aceitar como ambiental: revertido `Portal/vf-shell.js`/`vf-shell-ui.test.js` via `git stash` para o estado ANTES da mudança do roteamento do Financeiro (Tarefa 7) e reproduzi a MESMA falha, no MESMO passo — prova de que não é causada por nenhuma mudança desta convergência. Depois de um cooldown, o mesmo arquivo passou 13/13 isoladamente, dessa vez e numa segunda confirmação. Esta é exatamente a característica de ambiente que a Pessoa 1 já havia documentado (§21/§38 do handoff dela: "1 falha aleatória ocasional por rodada... sempre verde quando rodado isolado") — a mission já instruía explicitamente para não alterar código de produção para "corrigir" isso, e não alterei.

## 26. Dívidas

- Observabilidade estruturada para códigos de conta/base (§19) — não fechada, motivo documentado.
- Contrato de bases elegíveis TikTok (D-9) — não implementado, motivo documentado (§13).
- Divergência do baseline de testes backend pré-existentes (4 documentadas vs. 2 medidas, §22) — reportada, não investigada a fundo (fora do escopo desta convergência).
- QA visual interativa real (§20) — pendência de ambiente, não de código.

Nenhuma dívida nova de arquitetura foi criada por esta convergência.

## 27. Decisões humanas

Continuam humanas, não resolvidas por código nesta convergência (mission §30): Cliente→Squad real, Usuário→Squad, `is_primary` real, responsáveis por cliente, Grants `AMBIGUOUS` (D-4), duplicatas financeiras D4, Squad piloto do canário + janela, `JWT_SECRET` no Render, arquitetura de ClienteConta TikTok (D-9).

**Novas desde a Convergência #3/handoffs**: nenhuma — D-8 foi resolvida tecnicamente (não era uma decisão humana, era um gap de implementação, como o próprio handoff da Pessoa 2 já classificava: "Pessoa 1 (produto) + Pessoa 2 (impl)" — a parte de produto já estava implícita na regra que a mission §11 define explicitamente, não exigiu uma nova decisão de produto além do que a mission já decidiu).

## 28. Riscos de deploy

Nenhum identificado além dos já conhecidos (migrations manuais pendentes, D-4 grants ambíguos). A mudança de roteamento do Financeiro (§15) é aditiva e reversível (reverter o commit `e64e626` restaura o comportamento anterior sem tocar dado nenhum).

## 29. Smoke pós-deploy recomendado

1. `GET /health/schema` continua respondendo como antes.
2. Cliente MELI com 2+ contas: abrir Financeiro pela sidebar deve ir para `financeiro-v3.html`, não `financeiro.html`.
3. Cliente Shopee: idem.
4. Cliente TikTok (legado): abrir Financeiro pela sidebar deve continuar indo para `financeiro.html` (verificar manualmente — sem fixture automatizada, ver §15/§20).
5. Precificação/Automações: cliente com 2 contas ML e 2 bases distintas, selecionar a conta não-principal — preview não pode devolver `BASE_AMBIGUA`.

## 30. Rollback

Reverter os 4 commits desta convergência (`3ab04d1`, `294e916`, `e64e626`, `401b75e`) não afeta os merges de P1/P2 nem exige rollback de dado — são todos aditivos/comportamentais em código, sem migration nova. `SQUADS_ENFORCEMENT=off` continua a primeira alavanca para qualquer problema relacionado a Squads (inalterado nesta convergência).

## 31. Readiness

| | |
|---|---|
| PRONTO PARA MAIN | SIM |
| PRONTO PARA DEPLOY | SIM |
| PRONTO PARA CUTOVER MELI | SIM |
| PRONTO PARA CUTOVER SHOPEE | SIM |
| PRONTO PARA CUTOVER TIKTOK | NÃO (estrutural, D-9) |
| PRONTO PARA P2.9 REAL | NÃO (decisões/dados humanos pendentes, nenhum bloqueio de código) |
| PRONTO PARA CANÁRIO | NÃO (depende de P2.9 real) |
| PRONTO PARA ENFORCEMENT ON | NÃO (depende de P2.9 real + canário verde) |
