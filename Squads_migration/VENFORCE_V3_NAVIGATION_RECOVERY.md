# Recuperação controlada da navegação do Portal Venforce (Shell V3)

**Branch:** `fix/v3-navigation-recovery` (a partir de `origin/main` @ `cc2add2c991eb3d7f460a746c7f5188069122cce`)
**Data:** 2026-09-02
**Escopo:** navegação apenas. Nenhuma lógica de tela, backend, cálculo ou autorização foi reescrita.

## Motivo

`VENFORCE_AUDITORIA_FORENSE_RECUPERACAO_TELAS.md` (auditoria forense, somente
leitura, comparando `venforce_scanner_x1` ATUAL contra `venforce_push_main` e
`21JULHO/venforce-server-main`) provou que:

- ATUAL é superconjunto estrito das duas origens de backup em toda capacidade
  auditada — nenhuma recuperação exigiu copiar código de backup.
- O problema real não é código apagado, é navegação fragmentada: quando
  `Portal/vf-shell.js` ("Shell V3") substituiu `Portal/layout.js` em 20
  páginas, 9 telas de produto + 2 telas admin ficaram com arquivo, backend e
  lógica ativos, mas **sem nenhuma entrada de menu no Shell V3** — só
  continuavam alcançáveis via páginas que ainda carregam `layout.js`.
- Toda capacidade recuperada nesta missão caiu em **Nível 1** de risco
  (arquivo + backend já existem em ATUAL; faltava só o link).

Esta missão é, portanto, trabalho de navegação dentro de ATUAL — não
restauração cross-origem, não redesign, não migração de lógica.

## O que mudou

Único arquivo de produção alterado: `Portal/vf-shell.js` (71 linhas
adicionadas, 0 removidas — puramente aditivo):

1. 8 entradas novas nos arrays `MODULOS`/`GLOBAIS`/`ADMIN` (a fonte única de
   verdade da sidebar do Shell V3).
2. Um mecanismo mínimo de `linkParams` em `buildHref()` — uma válvula de
   escape para os 2 casos (de 8) em que a página de destino não fala o
   contrato padrão `?cliente=&conta=&periodo=`, mas tem um contrato próprio
   documentado (`slug` para Cliente 360 V2 React, `clienteContaId` para
   Central Full). Nas outras 6 telas, o `?cliente=&conta=&periodo=` que o
   Shell já anexa por padrão é inofensivo — nenhuma delas lê esses nomes da
   URL (cada uma tem seletor de cliente próprio), e esse é o mesmo contrato
   "links normais entre os dois mundos" já usado por Bases/Relatórios.

Teste novo: `Portal/vf-shell-navigation-recovery-ui.test.js` (18
verificações, mesmo padrão de infraestrutura CDP + Chrome headless de
`vf-shell-ui.test.js`).

Documentação nova: este arquivo.

**Nenhum arquivo de backend, de página (`.html`/`.js` das 8 telas) ou de
`layout.js` foi tocado.**

## Matriz de recuperação

| Tela | Rota | Ação | Motivo | Gate | Teste | Status |
|---|---|---|---|---|---|---|
| Cliente Operação | `cliente-operacao.html` | Recuperada (GLOBAIS) | Nível 1 — arquivo/backend ativos, só faltava link. Não lê `cliente`/`conta` da URL (seletor próprio) | Nenhum (igual a antes — layout.js nunca restringiu por role) | `vf-shell-navigation-recovery-ui.test.js` #1 | ✅ |
| Cliente 360 (Vanilla) | `cliente-360.html` | Recuperada (GLOBAIS) | Nível 1. Mesma observação — seletor de cliente próprio, com seleção multi-conta ML que os backups não têm (preservada) | Nenhum | `#2` | ✅ |
| Cliente 360 V2 (React) | `cliente-360-react.html` | Recuperada (MODULOS) | Nível 1. **Não** é `cliente-360-v2.html` (bundle Vue órfão, sem fonte em nenhuma origem, nunca linkado). Contrato de deep-link (`?slug=&marketplace=`) documentado em `frontend-react/src/hooks/useCliente360.js:8-9` | MODULOS = exige cliente+operação escolhidos na Carteira (a tela é sobre 1 cliente) | `#6`, `#16` | ✅ |
| Criação Anúncios ML | `criar-anuncios-meli.html` | Recuperada (ADMIN) | Nível 1 | `adminOnly` em `layout.js` → preservado como item do grupo Administração do Shell V3 | `#10`, `#14` | ✅ |
| Promoções ML | `promocoes-retorno.html` | Recuperada (GLOBAIS) | Nível 1. Busca de cliente própria na página, não lê URL | Nenhum (igual a antes) | `#3` | ✅ |
| Central Full | `full-gestao.html` | Recuperada (GLOBAIS) | Nível 1, exclusiva de ATUAL. Lê `clienteContaId` da URL (confirmado no bundle); sem ele mostra seletor próprio | Nenhum (igual a antes) | `#4`, `#17` | ✅ |
| Curva ABC | `fechamento.html` | Recuperada (GLOBAIS) | Nível 1. Rótulo "Curva ABC" (não confundir com Financeiro/Fechamento API) | Nenhum (igual a antes) | `#5` | ✅ |
| Tokens ML | `ml-tokens.html` | Recuperada (ADMIN) | Nível 1. Achado de segurança da auditoria (§11): ATUAL já corrigiu o vazamento de `access_token`/`refresh_token` em texto puro — **não regredido, não tocado** | `adminOnly` em `layout.js` + `ml-tokens.js:12` já redireciona quem não é admin → preservado no grupo Administração | `#9`, `#13` | ✅ |
| Dashboard | `dashboard.html` | **Não restaurada** | Decisão de produto: Visão assume o papel de tela inicial/dashboard operacional | — | `#8`, `#15` (ausência) | Fora do menu, arquivo preservado |
| Estúdio de Templates | `design-templates.html` | **Não restaurada** | Decisão de produto — fora do escopo desta missão | — | `#8`, `#15` (ausência) | Fora do menu, arquivo preservado |
| ClickUp Executivo | `clickup-executivo.html` | **Não restaurada, preservada** | Decisão de produto — proibido apagar/classificar como código morto | — | `#8`, `#15` (ausência) | Fora do menu, arquivo/JS/backend intactos |
| Cliente 360 V2 (Vue) | `cliente-360-v2.html` | **Não tocada** | Órfã desde que foi criada (BACKUP_PUSH_MAIN) em todas as 3 origens auditadas; sem fonte em nenhuma origem; documentação interna já a marca como desatualizada | — | `#16` (garante que o rótulo "Cliente 360 V2" nunca aponta pra cá) | Órfã, não linkada, não apagada |
| Visão | `visao.html` | Inalterada | Não substitui nenhuma tela recuperada (auditoria §9: Visão não tem paridade com o motor de Resultado da Cliente 360 V2 — ponte PVM, simulador, elasticidade, placar, produtos, oportunidades) | Nenhum | `#7` | ✅ preservada |

## Decisões de produto registradas

- **Dashboard**: fora do menu do Shell V3. A Visão assume o papel de tela
  inicial/operacional. `dashboard.html` continua existindo no repositório —
  só não tem mais link.
- **Cliente Operação**: recuperada como está, sem redesenho e sem adaptação
  para a arquitetura de Squads. Fica marcada para evolução futura — melhor
  visível e "datada" do que invisível e sujeita a ser confundida com código
  morto.
- **Cliente 360 V2 = React** (`cliente-360-react.html`). O bundle Vue
  (`cliente-360-v2.html`) continua no disco, sem fonte versionada em nenhuma
  origem, e permanece órfão de propósito — não foi apagado, não foi
  restaurado, não está no menu.
- **Estúdio de Templates**: fora do menu nesta missão; arquivo preservado.
- **ClickUp Executivo**: classificação canônica a partir desta missão —
  **preservado / oculto da navegação**. Proibido apagar arquivo, JS, backend
  ou classificar como código morto em qualquer limpeza futura.
- **Tokens ML**: recuperado só no grupo Administração. A correção de
  segurança (fim do vazamento de `access_token`/`refresh_token` em texto
  puro na listagem, endpoint dedicado `/admin/ml-tokens/:tokenId/credentials`
  sob demanda) não foi tocada — confirmado por inspeção estática de
  `server/controllers/mlController.js` antes e depois desta missão (nenhuma
  linha de backend mudou).

## Por que GLOBAIS e não MODULOS para 6 das 8 telas

`MODULOS` é o único grupo do Shell V3 com gating de marketplace e com a
exigência "cliente+operação escolhidos na Carteira" — cada item nele fica
desabilitado (`aria-disabled`, `href="#"`) até o contexto chegar a `READY`.

Auditando o JS de cada página (não só o menu antigo), nenhuma das 6 telas —
Cliente Operação, Cliente 360, Promoções ML, Central Full, Curva ABC — lê
`cliente`/`conta`/`slug` da URL: cada uma tem seletor de cliente próprio,
independente do Shell. Colocá-las em `MODULOS` criaria uma trava de UX nova
(exigir seleção prévia na Carteira) que essas páginas nunca tiveram — e que
a missão pede explicitamente para não inventar. `GLOBAIS` preserva o
comportamento de acesso que já existia.

Já Cliente 360 V2 (React) é inerentemente sobre 1 cliente e documenta um
contrato de deep-link real (`?slug=&marketplace=`) — por isso ficou em
`MODULOS`: navegar a partir de um cliente+operação já escolhidos na Carteira
é um ganho real, não uma trava artificial.

## Testes

### Novo — `Portal/vf-shell-navigation-recovery-ui.test.js`

18 verificações (Chrome headless + CDP, backend fake, mesmo padrão de
`vf-shell-ui.test.js`):

```
$ node Portal/vf-shell-navigation-recovery-ui.test.js
ok 1  … cliente-operacao existe e aponta para cliente-operacao.html
ok 2  … cliente-360 existe e aponta para cliente-360.html
ok 3  … promocoes-ml existe e aponta para promocoes-retorno.html
ok 4  … central-full existe e aponta para full-gestao.html
ok 5  … curva-abc existe e aponta para fechamento.html
ok 6  … item Cliente 360 V2 existe (desabilitado sem contexto — MODULOS)
ok 7  … Visão continua presente
ok 8  … Dashboard/Estúdio de Templates/ClickUp Executivo NÃO têm entrada (usuário comum)
ok 9  … ml-tokens NÃO aparece para usuário comum
ok 10 … criar-anuncios-meli NÃO aparece para usuário comum
ok 11 … seção Administração não aparece para usuário comum
ok 12 … seção Administração aparece para admin
ok 13 … ml-tokens aparece dentro de Administração, aponta para ml-tokens.html
ok 14 … criar-anuncios-meli aparece dentro de Administração
ok 15 … Dashboard/Estúdio/ClickUp continuam fora mesmo para admin
ok 16 … Cliente 360 V2 aponta para cliente-360-react.html com ?slug=, nunca o Vue órfão, nunca ?cliente=
ok 17 … Central Full recebe ?clienteContaId=, nunca ?conta=
ok 18 … Cliente Operação/Cliente 360 continuam navegáveis
✓ 18 verificações de recuperação de navegação (fix/v3-navigation-recovery)
```

### Suites existentes do Shell V3 (regressão)

Todas rodadas antes e depois da mudança, sem regressão:

| Suite | Resultado |
|---|---|
| `vf-shell-ui.test.js` | ✅ 25/25 |
| `vf-shell-adoption-ui.test.js` | ✅ 5/5 |
| `vf-shell-f5-lote-ui.test.js` | ✅ 52/52 (1ª execução teve 1 falha de timing em `design-system-lab.html`, não relacionada aos itens alterados; 2ª execução, 100% verde) |
| `vf-shell-hardening.test.js` | ✅ 101/101 |

Backend não foi alterado — suíte de testes do `server/` não foi executada
(nenhuma justificativa para rodar uma maratona backend sem mudança de
backend).

## QA de navegação

Executado via `Portal/vf-shell-navigation-recovery-ui.test.js` (login
simulado, Chrome headless real, DOM real, cliques reais nos itens de menu):

- Login (harness simula token+usuário) → OK.
- Carteira/contexto: seleção de cliente com 1 conta ativa → `READY` → OK.
- Visão continua acessível e não foi substituída → OK.
- Cada uma das 8 telas abre um `<a>` real na sidebar apontando para o
  arquivo correto (nenhum 404 possível — todos os 8 arquivos de destino
  foram confirmados presentes em `Portal/` antes da mudança).
- Troca de cliente/conta: testada via o próprio dropdown do Shell
  (`vf-cliente-trigger` → seleção → `READY`), refletida no `href` calculado
  de Cliente 360 V2 e Central Full.
- Console/rede: o harness roda o boot de produção real do Shell
  (`bootProduction()`) contra um backend fake; qualquer exceção não tratada
  faria o `waitFor`/`evaluate` falhar (mesmo padrão usado em
  `vf-shell-f5-lote-ui.test.js`, que checa exceções explicitamente).
- Ausência de 404: confirmada por checagem direta de arquivo
  (`ls Portal/*.html`) para as 8 rotas, antes de qualquer teste rodar.

**Não foi feito QA com login real contra o backend real.** `server/.env`
aponta para o PostgreSQL de **produção** (achado de sessão anterior,
`[[server_env_aponta_producao]]` na memória do projeto) — subir
`node server/index.js` nesta máquina aplicaria migrations em produção. Por
isso o QA usou o mesmo padrão que os testes do repositório já usam:
Chrome headless + servidor estático do `Portal/` + backend fake via
`http.createServer` no próprio teste, sem tocar produção. As páginas de
destino em si (`cliente-360.html`, `full-gestao.html` etc.) não tiveram
lógica interna executada ponta-a-ponta contra dados reais nesta missão —
isso exigiria endpoints reais/QA autenticado, fora do escopo de uma missão
de navegação.

## Segurança — Tokens ML

Nenhuma linha de `server/controllers/mlController.js` ou
`server/services/mlTokenService.js` foi alterada. Confirmado por inspeção
estática: a query de listagem administrativa (linhas ~393-402 de
`mlController.js`) segue selecionando apenas `has_access_token`/
`has_refresh_token` (booleanos) — os campos brutos (`access_token`,
`refresh_token`) só aparecem na função separada que atende o endpoint
dedicado `/admin/ml-tokens/:tokenId/credentials`, sob demanda. Nenhum
segredo real foi impresso neste relatório ou no teste.

## O que esta missão explicitamente não fez

- Não reescreveu cálculo, endpoint, autorização ou CSS de nenhuma das 8
  telas.
- Não copiou nenhum código de `venforce_push_main` ou `21JULHO/`.
- Não apagou nem restaurou o bundle Vue órfão.
- Não colocou Dashboard, Estúdio de Templates ou ClickUp Executivo no menu.
- Não alterou `layout.js`.
- Não alterou backend.
- Não fez merge na `main`, não fez deploy, não iniciou P2.9.
