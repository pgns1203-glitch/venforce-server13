# Release final — Unificação de Clientes

## Resultado e limites

Branch final `release/clientes-unificacao-final`, criada a partir de `origin/main` **3dc3732432aa8782882f1d573dc43dedb650aa94**. A stack foi incorporada em um merge local com histórico preservado, usando o topo **cac51f205d8b091b4f844756fba158ab17039118** de `origin/feat/clientes-unificacao-executor-stacked`. Esse topo já contém o commit da UI #263 e seu merge; não foi necessário incorporar a UI uma segunda vez.

O merge de integração `82903028da68e003e09641d75642e603bd5c061c` tem os dois SHAs acima como pais, nessa ordem. Não houve conflito textual. `server/index.js` foi mesclado automaticamente e o diff contra main contém apenas o import e o registro das rotas administrativas.

**Sem falhas novas pendentes. A bateria global NÃO está 100% verde:** três testes backend, cinco testes Portal e três suítes React ainda falham e foram reproduzidos na main atual. O resultado não equivale a uma liberação irrestrita de produção. A funcionalidade nova passou nos testes dedicados, inclusive com PostgreSQL local, mas as falhas herdadas continuam explícitas neste relatório e no PR.

Não houve conexão de produção nesta execução, escrita em produção, aplicação manual de migration em produção, mudança de variável no Render, deploy, merge no GitHub, alteração de bases ou push nas branches antigas. O merge local é apenas a integração solicitada na branch final, não o merge do PR final em main.

## Origem e cobertura

| PR | Ref e SHA incorporados | Conteúdo |
| --- | --- | --- |
| #246 | `fix/account-context-foundation` · `d220e2713fe6537a2900bfa3472b54ead3d053d2` | Invariante ClienteConta → seller → Grant → Base; Base explícita e prevenção de cruzamento. |
| #251 | `feat/unificacao-clientes-resolvers-stacked` · `15bc33d2c93e0d001ab7f69858d7ad11b44c5e6d` | Resolução estrita opt-in, múltiplas Contas bloqueadas sem seleção e compatibilidade single-account comprovada. |
| #252 | `feat/unificacao-clientes-oauth-stacked` · `bb3950601c8874243839d5aaaf2499589fdbe23f` | Callback OAuth, preflight de seller e gravação atômica de Conta/Grant. |
| #253 | `feat/unificacao-clientes-consumidores-stacked` · `da3061d85b71c7bf44ed7a7d0728e8dad7feadd0` | Propagação de Conta em Ads, resumo de Margem/Visão, métricas e diagnóstico. |
| #254 | `feat/unificacao-clientes-fase2-stacked` · `fe100d97d8b331e4f55bbf633120d679c21dd7a7` | Inventário somente leitura, plan/validate e rollback offline. |
| #260 | `feat/clientes-unificacao-executor-stacked` · `cac51f205d8b091b4f844756fba158ab17039118` | Executor transacional, ledger, mapping e reversão; inclui merge da UI #263. |
| #263 | `feat/clientes-unificacao-ui-stacked` · `0d4c4164fc4ba1a3cc18648b531fcbafbca54706` | Interface administrativa end-to-end. |

Todos esses refs são ancestrais de HEAD da branch final. A presença da UI no topo foi comprovada antes do merge pelo histórico e pela igualdade dos arquivos HTML/JS/CSS; não foi assumida pelo estado nominal dos PRs. Os PRs #246/#251/#252/#253/#254/#260 permanecem abertos como histórico. #263 já estava mergeado na branch do #260; não foi reaberto ou alterado.

## Arquitetura incorporada

A fundação valida a identidade de Cliente, Conta, seller, Grant e Base. A resolução estrita não escolhe principal ou Base legada ambígua por ordem/heurística; o perfil legado compatível só é usado onde sua cardinalidade foi comprovada. O OAuth salva Conta e Grant na mesma transação com preflight de titularidade. Os consumidores da stack conservam a Conta explícita até o resolvedor; fórmulas e totais financeiros não foram substituídos.

O domínio `server/services/clientesUnificacao/` centraliza planner/validator compartilhados, manifesto v1 e SHA-256 determinístico. API, CLI e executor usam esse domínio. O perfil histórico agregado continua exclusivamente offline; não vira um plano executável por inferência. O manifesto de execução exige decisão empresarial humana, canônico, legados e decisões de principais quando o backend as exigir.

O executor revalida o hash sob locks ordenados e aplica o plano numa transação serializável, com checkout único do pool existente, prazo local e retries limitados de serialização. Idempotência é controlada pelo ledger e ator real, não pelo navegador. Uma queda de conexão após commit não autoriza reaplicação cega. Before/after, status concluído e auditoria acompanham o mesmo commit dos dados.

IDs de Conta, seller, Grant e Base são preservados conforme o plano. Legados ficam mapeados ao canônico e inativos; não são apagados. A infraestrutura bloqueia purge que destruiria o mapping e protege ledger/eventos. O rollback usa preimagens, valida o after atual/catálogo e recusa divergência, sem force.

## API e UI

Prefixo administrativo autenticado: `/admin/clientes-unificacao`. O router registra `authMiddleware` + `requireAdmin` antes de todos os handlers, incluindo configuração e leituras.

| Método | Caminho | Função |
| --- | --- | --- |
| GET | `/config` | Flags e ator administrativo verificado. |
| GET | `/candidatos` | Triagem explicável, sem aprovação automática de empresa. |
| GET | `/busca?q=` | Busca manual por Cliente. |
| POST | `/preview` | Manifesto normalizado, plano, validação, decisões, hash e confirmação. |
| POST | `/execute` | Executor com manifesto/hash/chave/confirmação. |
| GET | raiz | Histórico paginado. |
| GET | `/:id` | Detalhe da operação e resumos de auditoria. |
| POST | `/:id/rollback` | Reversão validada pelo backend. |

A página `Portal/clientes-unificacao.html` usa Shell V3, tokens/componentes V2, `vf-api` e assets locais. O fluxo cobre candidatos, busca com debounce/abort, seleção explícita de canônico/múltiplos legados, preview com Contas/Grants/Bases/origem/impacto, blockers/warnings/info, decisões, confirmação, execução, resultado, histórico, detalhe e rollback elegível.

O frontend não calcula regra de unificação ou planHash. Alterar decisões ou solicitar novo preview retira a confirmação anterior. Repetir uma tentativa de resposta incerta mantém sua chave; status pendente não vira sucesso. Flag OFF e hash stale têm mensagens próprias. Rollback só aparece no detalhe se o backend e a flag permitirem. Conteúdo externo é escapado; snapshots brutos e segredos não são a UX principal.

Os contratos e limites já documentados em `UNIFICACAO_CLIENTES_UI.md` e `UNIFICACAO_CLIENTES_EXECUTOR.md` foram preservados. Esses documentos descrevem suas etapas históricas; este arquivo é a evidência da integração sobre a main atual.

## Diff, conflitos e preservação da main

Conflitos textuais: **0**. Não houve resolução por aceitar indiscriminadamente um dos lados. A nova branch mantém main como primeiro pai e conserva os commits originais da stack, sem squash/rebase/force-push das branches anteriores.

O inventário completo por arquivo e área está em `docs/auditorias/unificacao-final/DIFF_FINAL.csv`. As áreas são account-context, OAuth, consumidores, plan/validate, executor, migration, API, UI e docs/tests. O CSV de fallbacks da stack é inventário estático de código; não é uma exportação de credenciais ou dados de clientes.

Os arquivos de produto incorporados são idênticos ao topo da stack, exceto `server/index.js`, cuja mesclagem manteve a main e acrescentou as duas linhas de registro. Nenhum arquivo alheio foi trazido da branch de trabalho original do usuário. Não há planilha, dump, `.env` real, lockfile ou build de frontend no diff.

A integração mantém idênticos à main os diretórios/arquivos de Central de Vendas, jobs, pool/databaseConexao, Painel, Promo snapshot, controller financeiro e frontend React. Também preserva o hardening `dd69fd67506178bd51b743ec5c9b0c69840c639b` do #264 em `marginSnapshotProcessor.js` e seu teste. As mudanças em Ads/Margem/Visão são as de identidade já contidas na stack, sem alterar fórmulas.

Única correção de integração adicional ao merge: a fixture de `Portal/ui-ux-wave1-convergence.test.js` agora responde explicitamente ao **GET** administrativo `/config` com todas as flags OFF. A asserção que recusa rotas desconhecidas não foi removida ou relaxada. O teste passa com suas 32 verificações. Não houve alteração adicional de código de produto.

## Flags e segurança

Defaults versionados e parser validados:

```dotenv
CLIENTES_UNIFICACAO_UI_ENABLED=false
CLIENTES_UNIFICACAO_EXECUTE_ENABLED=false
CLIENTES_UNIFICACAO_ROLLBACK_ENABLED=false
```

Ausente, vazio, `false`, `0`, `on` e valores inválidos permanecem OFF; somente `true` explícito (normalizado por trim/case) habilita. `.env.example` só ganhou configuração segura. Nenhuma variável hospedada foi consultada ou modificada.

As flags governam a exposição da nova UI e os comandos de unificação/reversão. Não são uma chave para desativar os hardenings account-aware/OAuth: esses acompanham o código consolidado e continuam bloqueando identidades incompatíveis.

A busca de segredos no diff não encontrou credenciais reais: sem URL autenticada de banco remoto, JWT literal, chave privada ou credencial Render. Ocorrências de `access_token`/`refresh_token` são nomes necessários do fluxo OAuth, negações de exportação e fixtures explicitamente sintéticas; não contêm tokens de produção. Não foram publicados logs brutos de ambiente ou snapshots reais. Os testes receberam ambiente sanitizado e não leram `.env` de produção; Node foi limitado a loopback e Chrome teve saída externa bloqueada por proxy local inválido, conservando as interceptações de fixture.

## Migration, startup e deploy

A migration `server/sql/migrations/20261014_clientes_unificacao_executor.sql` está versionada, íntegra e sem movimentação de clientes/backfill. Cria `merged_into_cliente_id`, ledger/eventos, índices/constraints e proteções de integridade. Foi exercitada automaticamente pelos harnesses em bancos **locais descartáveis**, inclusive aplicação repetida. Não foi aplicada manualmente em produção.

**O startup versionado NÃO aplica essa migration.** `npm start` executa `node index.js`; a migration de unificação é referenciada como arquivo SQL pelos testes locais, não pelo boot ou pelo router. Importar/registrar o serviço não executa DDL de unificação. A main já possui outros `ensure*` automáticos no boot (Central, Margem, Promo, custos, Squads etc.); eles foram preservados. Portanto, não se deve interpretar esta conclusão como “nenhum DDL de qualquer módulo ocorre no startup”.

O repositório não traz `render.yaml`, Procfile/Dockerfile ou workflow que comprove um comando externo de pré-deploy da unificação. A configuração externa do Render/auto-deploy **não foi consultada**; não pode ser certificada a partir do Git. O relatório responde NÃO para a aplicação automática da **nova migration pelo fluxo versionado**, com essa limitação explícita sobre comandos externos.

Um deploy futuro com defaults OFF não habilita a funcionalidade. Antes de UI/preview, o schema necessário precisa estar homologado e preparado por procedimento separado autorizado. Só mudar uma flag não cria as tabelas/coluna. Nada desse procedimento de produção foi executado aqui.

## Validação realizada

Todos os `server/tests/*.test.js` foram executados sem `TEST_SKIP`, em subprocessos isolados; o runner de validação continuou após falhas, pois o runner padrão para na primeira. O mesmo ambiente foi usado numa cópia limpa do SHA atual da main.

| Bateria | Main atual | Branch final | Resultado |
| --- | --- | --- | --- |
| Backend completo | 327/330 arquivos | 336/339 arquivos | Mesmas três falhas, logs normalizados idênticos; nove arquivos adicionais aprovados. |
| Direcionados backend (subset da rodada completa) | — | 185/186 arquivos | Única falha: `mlTokenService.test.js`, idêntica à main. |
| Portal completo | 27/34 arquivos | 30/35 arquivos | Cinco falhas finais idênticas às da main; duas falhas adicionais ocorreram só na main nessa rodada. |
| React/Vitest | 38/41 suítes; 581 testes passaram | 38/41 suítes; 581 testes passaram | Mesmas três suítes sem import; frontend React não alterado. |
| Unificação UI/Chrome | não existe | 41 cenários | Todos aprovados, incluindo flags/admin/XSS/responsividade. |
| Unificação UI + PostgreSQL | não existe | 7 cenários | Todos aprovados; escrita e reversão reais só em banco sintético descartável. |
| Executor PostgreSQL | não existe | 39 cenários | Todos aprovados: concorrência, locks, idempotência, integridade, falhas intermediárias e rollback. |
| API/auth | não existe | 65 verificações | Todas aprovadas, incluindo roles, inativo e flags. |
| Domínio unificação | não existe | 41 cenários | Todos aprovados. |
| Fundação/strict/OAuth/consumidores | não existe | 29/17/13/5 cenários | Todos aprovados. |
| Planner/CLI offline | não existe | 43 verificações + contrato CLI v1 | Aprovados; coletor read-only também aprovado com driver/rede simulados. |

O total efetivo do Portal considera a rodada completa mais o reteste **apenas** da fixture corrigida (`ui-ux-wave1-convergence`: 32 verificações). Nenhum teste foi marcado skip ou excluído para produzir o resultado. As listas de arquivos e hashes de logs estão em `VALIDACAO.json`.

Falhas backend herdadas, com logs idênticos à main após substituir o caminho da cópia de teste:

- `designStudioWorkspace.test.js`;
- `meliAnunciosOrdenacaoGlobal.test.js`;
- `mlTokenService.test.js`.

Falhas Portal finais, também com logs idênticos à main:

- `anuncios-meli-detalhe-modal-ui.test.js` — ação `descartar` ausente na asserção do teste;
- `central-margem-ui.test.js` — thumbnail esperada versus `undefined`;
- `financeiro-v3-shell-ui.test.js` — navegação `about:blank` não conclui no harness;
- `vf-shell-ui.test.js` — expectativa histórica de contagem de módulos Shopee;
- `visao-shell-ui.test.js` — os seis blocos esperados não renderizam no harness.

Na rodada da main também falharam `anuncios-meli-listagem-unificada-ui.test.js` (asserção de nova leitura/cache) e `diagnostico-inicial-shell-ui.test.js` (target CDP navegou/fechou). Ambos passaram na branch final; não foram usados para esconder uma falha nova.

React: `Cliente360Page.test.jsx`, `VisaoPage.test.jsx` e `components/cliente360/DataTable.test.jsx` falham, na main e na final, ao resolver `./VFButton/index.js` em `components/ui/index.js`. Essa árvore não foi alterada. A checagem estática dos **imports novos da unificação** passou; não se declara que a árvore histórica inteira já não tinha imports quebrados.

Sintaxe de todos os JS/CJS do diff, assets HTML, referência da migration, navegação e registro das rotas passaram. `git diff --check` passou. Não foi iniciado `server/index.js` contra banco real/produção para fazer smoke.

## Homologação e habilitação futura — somente documentado

1. Revisar este PR único e suas ressalvas de testes, mantendo os PRs antigos como histórico. Não considerar a bateria global integralmente verde.
2. Após uma decisão humana de merge, fazer deploy da main conforme o processo operacional existente. Nenhuma ação de deploy foi feita nesta execução.
3. Em cópia/homologação isolada, aplicar/verificar a infraestrutura e executar as baterias locais. Validar schema real, referências críticas, dados de teste e plano de rollback.
4. Somente após homologação e preparação do schema, habilitar a UI em etapa separada: `UI=true`, `EXECUTE=false`, `ROLLBACK=false`. Conferir candidatos, busca, preview, decisões e histórico com admin ativo.
5. Para executar futuramente, exigir aprovação empresarial real, manifesto e piloto revisados, evidência documental, preview atual e verificação dos blockers. Alterar `EXECUTE` somente em procedimento explicitamente autorizado; este PR não faz isso.
6. Habilitar rollback apenas em procedimento autorizado. A elegibilidade do backend não garante reversão se houver novas Contas/Grants/vínculos/alterações materiais; divergência exige investigação, sem force.
7. Depois da integração validada na main, decidir separadamente o encerramento dos PRs antigos. Não fechar/alterar bases/rebasear/force-push automaticamente nesta execução.

Para reproduzir localmente: `node Portal/clientes-unificacao-ui.test.js`, `node server/tests/clientesUnificacaoApi.test.js`, `node server/tests/clientesUnificacaoDomain.test.js`. Os harnesses `server/tests/clientesUnificacao.postgres.cjs` e `Portal/clientes-unificacao.postgres.cjs` exigem `UNIFICACAO_TEST_DATABASE_URL` explícita em loopback e nome `vf_unificacao_test_*`; criam e apagam seu banco de teste. Nunca usar credencial/URL de produção.

## O que permanece bloqueado

Aprovação empresarial não é inferida de nome, score, seller, CNPJ presumido ou Squad. Permanecem os blockers de ambiguidade/ACL/Squad, referências críticas desconhecidas, índices/restrições/triggers não modelados, contexto Base NULL e tabelas Central com dados sem integração segura. A UI não ignora nenhum deles. Piloto em produção e alterações de flags/dados continuam fora desta execução.

As falhas globais herdadas estão documentadas, sem alteração oportunista de fórmulas, UI de outros módulos ou expectativas de testes históricos. **Pronto para revisão técnica da integração: SIM. Pronto sob o critério “tudo verde para apenas clicar Merge”: NÃO.**
