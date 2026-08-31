# RELATÓRIO TÉCNICO DE PROGRESSO — VENFORCE V3 / SQUADS
## Atualização consolidada — 26/08/2026

**Projeto:** VenForce V3 — Redesenho operacional, Carteira, Contexto Cliente/Conta e preparação para Squads  
**Data:** 26/08/2026  
**Objetivo:** registrar o estado técnico atual após os avanços de frontend e backend realizados em paralelo, deixando claro o que já foi consolidado, o que está concluído mas ainda precisa ser integrado e quais etapas faltam.

---

# 1. RESUMO EXECUTIVO

O VenForce V3 avançou hoje em duas frentes paralelas:

```text
FRENTE FRONTEND
Shell V3
Context Store
Carteira
Sidebar
primeiras adoções reais

                +

FRENTE BACKEND
ClienteConta
Grant
Base
erros canônicos
readiness multi-conta
/me/context
/me/portfolio
Visão
Financeiro
```

As duas frentes chegaram ao primeiro ponto real de convergência.

No backend, a fundação V3 foi concluída, testada, enviada ao GitHub e mergeada na `main`.

No frontend, a fundação F0 foi concluída e F1.1/F1.2 também foram concluídos e testados localmente. Esses commits precisam agora ser integrados sobre a `main` atualizada, pois a `main` remota recebeu o backend em paralelo antes do push do frontend.

Situação resumida:

```text
BACKEND V3
✓ mergeado na main

FRONTEND V3
✓ F0 completo
✓ F1.1
✓ F1.2
△ commits locais precisam ser integrados sobre a main atual

SQUADS / ISOLAMENTO REAL
✗ ainda não persistido/autoritativo para usuários internos

PRÓXIMO BLOCO FUNCIONAL
F1.3 + F2
```

---

# 2. ARQUITETURA ALVO MANTIDA

A arquitetura conceitual permanece:

```text
LOGIN
  ↓
CARTEIRA AUTORIZADA
  ↓
CLIENTE
  ↓
CLIENTE_CONTA / OPERAÇÃO
  ↓
CONTEXTO OPERACIONAL
  ↓
MÓDULOS
```

Identidade operacional canônica:

```js
{
  clienteId,
  clienteSlug,
  clienteContaId
}
```

Regras:

- Cliente é o contexto organizacional.
- `cliente_conta` é a operação.
- Marketplace é derivado da conta.
- Grant e Base são derivados da conta.
- Squad define acesso/carteira.
- Squad não deve ser propagado desnecessariamente para dados operacionais.
- Período é filtro, não contexto.
- `is_primary` não é identidade operacional.

---

# 3. FRONTEND V3 — ESTADO ATUAL

## F0 — Fundação do Shell

**Status: CONCLUÍDO**

Unidades:

```text
F0.1 — Configuração e formatação
F0.2 — Camada HTTP
F0.3 — Context Store
F0.4 — Fundação visual do Shell
F0.5 — Shell / Sidebar real
F0.6 — Primeira página real
F0.7 — Central de Vendas experimental
```

### F0.1 — `vf-config` + `vf-format`

Concluído.

Arquivos:

```text
Portal/vf-config.js
Portal/vf-format.js
server/tests/vfFormat.test.js
```

Entregas:

- `API_BASE` central;
- suporte a `<meta name="vf-api-base">`;
- fallback de produção preservado;
- `escapeHTML`;
- moeda;
- número;
- percentual;
- data;
- tratamento previsível de ausência;
- ponte `window.VF.format`.

Commit remoto:

```text
fc4cc50
feat(shell-v3): adiciona configuracao e formatacao compartilhadas
```

### F0.2 — `vf-api`

Concluído.

Entregas:

- HTTP compartilhado;
- autenticação;
- timeout;
- abort;
- `401`;
- normalização `code` / `codigo`;
- erros canônicos;
- suporte a stale responses;
- `scoped(...)`;
- ponte `window.VF.api`.

Commit remoto:

```text
6ab69a6
feat(shell-v3): adiciona camada HTTP e normalizacao de erros
```

### F0.3 — `vf-context`

Concluído.

Estados implementados:

```text
BOOT
PORTFOLIO_ERROR
NO_PORTFOLIO
NO_CLIENT
RESOLVING_CLIENT
INVALID_CLIENT
FORBIDDEN
RESOLVING_ACCOUNTS
NO_ACTIVE_ACCOUNT
ACCOUNT_CHOICE_REQUIRED
INVALID_ACCOUNT
ACCOUNT_INACTIVE
READY
```

Principais regras:

- primeiro Cliente nunca é escolhido automaticamente;
- 0 contas → sem operação;
- 1 conta → auto seleção;
- 2+ contas → escolha explícita;
- conta inativa rejeitada;
- conta de outro Cliente rejeitada;
- dedupe antes da cardinalidade;
- URL/sessionStorage validados;
- `userId` protege troca de usuário;
- race conditions protegidas;
- autorização e integração diferenciadas.

Commit remoto:

```text
a2fda9a
feat(shell-v3): adiciona maquina de estados do contexto operacional
```

### F0.4 — Fundação visual do Shell

Concluído.

Arquivo:

```text
Portal/css/vf-shell.css
```

Entregas:

- estrutura do Shell;
- Sidebar;
- layout contextual;
- responsividade;
- collapse;
- Fundação V2 preservada;
- tratamento de precedência `@layer`;
- proteção de `[hidden]`;
- tokens existentes reutilizados.

Commit remoto:

```text
367a339
feat(shell-v3): adiciona fundacao visual do shell
```

### F0.5 — `vf-shell.js`

Concluído localmente e testado.

Entregas:

- Sidebar V3;
- seletores de Cliente e Operação;
- consumo do `vf-context`;
- suporte aos 13 estados;
- `data-vf-scope`;
- gating por página;
- dropdowns;
- teclado;
- responsividade;
- collapse;
- disponibilidade por marketplace;
- `window.VF.shell`.

Validações reportadas:

```text
18/18 verificações headless do Shell
70 testes do vf-format após ampliação
49 casos do Context Store
```

Commit local reportado:

```text
6e0070c
```

Este commit ainda estava somente local na última conferência.

### F0.6 — Primeira página real no Shell

Concluído localmente.

Página piloto:

```text
Portal/ferramentas.html
```

Resultado:

- Shell V3 carregado;
- página continua global;
- conteúdo preservado;
- `layout.js` intacto;
- console limpo.

Commit local reportado:

```text
b1fb079
```

### F0.7 — Central de Vendas experimental

Concluído localmente.

Página:

```text
Portal/fechamentos-api.html
```

Comportamento:

```text
sem ?shell=v3
→ legado

com ?shell=v3
→ Shell V3
```

A lógica funcional de `fechamentos-api.js` não foi refatorada ainda.

Commit local reportado:

```text
38c2a8c
```

---

# 4. F1 — CARTEIRA

## F1.1 — Carteira visual/funcional

**Status: CONCLUÍDO LOCALMENTE**

Arquivos:

```text
Portal/carteira.html
Portal/carteira.js
Portal/css/pages/carteira-v2.css
Portal/carteira-ui.test.js
```

Entregas:

- lista densa;
- chips de operação;
- busca;
- filtros;
- ordenação;
- Squad quando necessário;
- cardinalidade 0/1/2+;
- teclado;
- cenários mock;
- cenário com 120 Clientes.

Medição reportada:

```text
120 clientes
render ~85 ms
```

## F1.2 — Carteira com dados reais

**Status: CONCLUÍDO LOCALMENTE**

Fonte principal:

```http
GET /operacao/cliente-360/clientes
```

Contas:

```http
GET /clientes/:cliente/contas
```

Estratégia:

- contas sob demanda;
- cache;
- dedupe;
- carregamento por visibilidade;
- sem 120 requests iniciais.

Resultado reportado:

```text
~12–24 chamadas no primeiro paint de 120 Clientes
```

Também foi corrigido bug real de entrada em Cliente multi-conta encontrado durante os testes.

Commit local reportado:

```text
857e056
```

## F1.3 — Login → Carteira

**Status: PENDENTE**

Objetivo:

```text
usuário interno
Login
→ Carteira
```

Preservando redirects especiais como Seller e Shopee Reviewer.

---

# 5. BACKEND V3 — STATUS

A frente backend foi concluída em:

```text
backend/v3-foundation
```

PR:

```text
#81
```

Já mergeado na `main`.

Commit de merge confirmado:

```text
69beea4
Merge pull request #81 from backend/v3-foundation
```

---

# 6. B1 — CLIENTECONTA / HARDENING

Commit:

```text
cf20d05
```

Correções:

### Fan-out em `/clientes/:cliente/contas`

Antes:

```text
LEFT JOIN
→ histórico de Grant/Base
→ mesma conta podia duplicar
```

Agora:

```text
LATERAL + LIMIT 1
→ uma linha lógica por ClienteConta
```

### Conta inativa

`resolveMarketplaceAccountContext` passou a rejeitar explicitamente Conta inativa:

```text
CONTA_INATIVA
```

### `externalAccountLabel`

Novo campo alimentado por:

```text
metadata_json.nickname
```

capturado no OAuth Mercado Livre.

Fallback:

```text
external_account_id
```

---

# 7. B2 — ERROS CANÔNICOS

Commit:

```text
2231278
```

Criado:

```text
server/utils/erroContextoCanonico.js
```

Vocabulário:

```text
CLIENTE_NAO_ENCONTRADO
CONTA_AMBIGUA
CONTA_NAO_PERTENCE_AO_CLIENTE
MARKETPLACE_INCOMPATIVEL
CONTA_INATIVA
GRANT_DESCONECTADO
BASE_AUSENTE
BASE_AMBIGUA
```

Compatibilidade antiga foi preservada.

Falhas de integração passaram a ser tratadas semanticamente como integração, inclusive com uso de HTTP 424 em casos apropriados.

---

# 8. B6 — READINESS MULTI-CONTA

Commit:

```text
d8475c2
```

Foi adicionado resumo:

```js
contas: {
  total,
  operacionais,
  pendentes
}
```

Isso evita que um Cliente com ML1 saudável e ML2 quebrado apareça como 100% saudável.

A lógica é marketplace-aware.

---

# 9. `/me/context` E `/me/portfolio`

Commit:

```text
b46b236
```

Novos contratos:

```http
GET /me/context
GET /me/portfolio
```

## `/me/context`

Contrato leve de boot.

## `/me/portfolio`

Contrato voltado à Carteira.

Foi implementada composição sem N+1 agressivo.

Contas retornam dados isolados por operação.

Nenhum token é retornado.

---

# 10. LIMITAÇÃO ATUAL DE SQUADS

O backend corretamente não fabricou isolamento que ainda não existe.

Hoje:

```text
Squads persistidos/autoritativos para usuários internos
→ ainda não existem
```

Portanto, para papéis internos:

```text
/me/context
/me/portfolio
```

já possuem contrato e composição, mas ainda não representam segurança definitiva por Squad.

O isolamento real ainda depende da fundação de Squads.

---

# 11. VISÃO V3 — BACKEND

Commit:

```text
af59189
```

Endpoint:

```http
GET /operacao/visao/:cliente
```

Composição por blocos:

- saúde/prontidão;
- resultado;
- margem;
- Ads;
- fechamento;
- atividade.

Cada bloco é resolvido independentemente.

Falha parcial não derruba toda a Visão.

Fontes que ainda são client-level são declaradas como tal.

---

# 12. FINANCEIRO V3 — BACKEND

Endpoint:

```http
GET /financeiro/:cliente
```

Composição inicial:

- resultado;
- conciliação;
- fechamento;
- relatórios;
- histórico.

Regra:

```text
indisponível
≠
zero
```

Blocos possuem sinalização de disponibilidade e escopo.

---

# 13. OUTRAS CORREÇÕES ACCOUNT-AWARE JÁ NA MAIN

## Ads e Métricas

Commit:

```text
edfe3f1
```

Agora resolvem Conta explicitamente em cenários multi-conta.

## Anúncios Mercado Livre

Commit:

```text
9b2126e
```

Listagem, sync, criação e otimização passaram a carregar identidade de Conta corretamente.

## Financeiro / Base

Commit:

```text
c0a0010
```

O fechamento não escolhe mais silenciosamente a Base de outra Conta do mesmo Cliente.

---

# 14. BACKEND READINESS

Resultado declarado pela frente backend:

```text
F1 Carteira
PARCIAL
contrato pronto; isolamento real depende de Squads

F2 Contexto
SIM

F3 Visão
PARCIAL

F4 Financeiro
PARCIAL

Isolamento real por Squad
NÃO
```

Documento consolidado já presente:

```text
Squads_migration/VENFORCE_V3_BACKEND_READINESS.md
```

---

# 15. PONTO ATUAL DE CONVERGÊNCIA

As duas frentes se encontraram.

```text
                  F0.4
                    │
           ┌────────┴─────────┐
           │                  │
      FRONTEND LOCAL      BACKEND REMOTO
           │                  │
         F0.5              ClienteConta
         F0.6              /me/context
         F0.7              /me/portfolio
         F1.1              Visão
         F1.2              Financeiro
           │                  │
           └────── INTEGRAR ──┘
```

O push do frontend foi rejeitado porque a `origin/main` recebeu os commits backend antes.

Não houve perda de código.

---

# 16. SITUAÇÃO GIT

## `origin/main`

Já possui:

- F0.1;
- F0.2;
- F0.3;
- F0.4;
- correções ClienteConta;
- Ads/Métricas account-aware;
- Anúncios account-aware;
- Financeiro/Base;
- backend V3 B1–B8;
- `VENFORCE_V3_BACKEND_READINESS.md`.

## Frontend local

Possui adicionalmente:

```text
F0.5
F0.6
F0.7
F1.1
F1.2
```

Próxima ação imediata:

```text
git fetch origin
↓
integrar/reaplicar commits frontend
sobre origin/main
↓
resolver conflitos reais
↓
rodar regressão
↓
push normal
```

Sem force push.

---

# 17. F2 — PRÓXIMO BLOCO

Após a integração Git:

```text
F1.3
+
F2.1
+
F2.2
+
F2.3
+
F2.4
```

## F1.3 — Login → Carteira

- tornar Carteira a home de usuários internos;
- preservar redirects especiais;
- limpar contexto após login.

## F2.1 — URL canônica

Forma:

```text
?cliente=<slug>&conta=<clienteContaId>
```

Aliases antigos continuam temporariamente aceitos.

## F2.2 — Central de Vendas

Deixa de resolver Cliente/Conta localmente.

Passa a consumir:

```text
VF.context
```

Mantendo:

- leitura;
- sync;
- polling;
- drawer;
- filtros;
- reconciliação;
- paginação.

## F2.3 — Central de Margem

- remover seletor local;
- remover storage contextual próprio;
- usar `VF.context`;
- preservar Motor de Margem.

## F2.4 — Diagnóstico

- remover `restoreLastCliente`;
- remover seleção local usada só para contexto;
- usar contexto global;
- preservar formulário/drafts.

---

# 18. SQUADS — PRINCIPAL FUNDAÇÃO AINDA AUSENTE

Ainda falta a fundação autoritativa:

```text
Squads
Memberships
Cliente → Squad
autorização de carteira
```

Modelo:

```text
USUÁRIO
→ SQUAD MEMBERSHIP
→ CLIENTES DO SQUAD
→ /me/portfolio
```

Essa etapa transforma a Carteira de uma experiência funcional em uma carteira realmente segura por usuário/Squad.

---

# 19. PASSOS DE SQUADS QUE AINDA FALTAM

Estrutura prevista:

```text
S0 — schema/tabelas de Squads
S1 — memberships
S2 — Cliente pertence a Squad
S3 — histórico/transferência
S4 — autorização da carteira
S5 — integrar resolveEffectivePortfolio
S6 — /me/context e /me/portfolio autoritativos
S7 — testes de isolamento
```

Regras já definidas:

- Cliente possui um Squad ativo;
- usuário pode participar de múltiplos Squads;
- todos os membros veem a carteira do Squad;
- responsabilidade específica não define todo o acesso;
- Admin possui bypass;
- Seller permanece separado.

---

# 20. F3 — VISÃO

Após F2:

```text
F3 — Visão operacional
```

Absorve:

```text
Dashboard
Cliente 360
Cliente Operação
```

Backend inicial já existe:

```http
GET /operacao/visao/:cliente
```

Ainda falta:

- frontend V3;
- integração com Context Store;
- tratamento de cobertura parcial;
- definição final dos blocos;
- substituição gradual das telas antigas.

---

# 21. F4 — FINANCEIRO

Backend inicial:

```http
GET /financeiro/:cliente
```

Ainda falta frontend V3 com:

```text
Resultado
Fechamento
Relatórios
Histórico
```

e validação final das fontes que ainda são client-level.

---

# 22. F5 — MIGRAÇÃO DOS DEMAIS MÓDULOS

Depois de F0–F4:

- Ads;
- Anúncios;
- Automações;
- Promoções;
- Bases;
- Clientes;
- Full;
- Design;
- demais ferramentas.

A frente ClienteConta já reduziu bastante o risco dessa fase.

---

# 23. F6 — LIMPEZA

Após estabilização:

- remover `layout.js`;
- remover seletores duplicados;
- remover telas absorvidas;
- reduzir CSS legado;
- limpar aliases;
- unificar helpers;
- concluir estratégia de `@layer`;
- remover código órfão.

---

# 24. ESTADO DO PROJETO

```text
ARQUITETURA / PLANEJAMENTO
████████████████████  concluído

PROTÓTIPO V3
████████████████████  concluído

F0 — FUNDAÇÃO
████████████████████  concluído

F1 — CARTEIRA
████████████████░░░░  F1.1/F1.2 concluídos
                      F1.3 pendente

BACKEND CLIENTECONTA
████████████████████  concluído

BACKEND V3 B1–B8
████████████████████  mergeado

SQUADS / AUTORIZAÇÃO
░░░░░░░░░░░░░░░░░░░░  pendente

F2 — MIGRAÇÃO CONTEXTO
░░░░░░░░░░░░░░░░░░░░  próximo

F3 — VISÃO
░░░░░░░░░░░░░░░░░░░░  backend inicial pronto

F4 — FINANCEIRO
░░░░░░░░░░░░░░░░░░░░  backend inicial pronto

F5 — MÓDULOS
░░░░░░░░░░░░░░░░░░░░

F6 — LIMPEZA
░░░░░░░░░░░░░░░░░░░░
```

---

# 25. PRÓXIMOS PASSOS

Ordem recomendada:

```text
1. Integrar frontend F0.5–F1.2 sobre a main atual
2. Rodar regressões frontend + backend
3. Push da integração
4. Executar F1.3
5. Executar F2.1–F2.4
6. Implementar Squads/autorização real
7. Tornar /me/context e /me/portfolio autoritativos por Squad
8. Executar F3
9. Executar F4
10. Migrar módulos restantes em F5
11. Executar limpeza em F6
```

F2 e Squads podem avançar em paralelo desde que não alterem os mesmos arquivos.

---

# 26. CONCLUSÃO

O avanço de 26/08 marca a passagem do VenForce V3 da fase de fundação para a fase de integração real.

Antes:

```text
cada página
→ descobre Cliente
→ descobre Conta
→ resolve Grant/Base
→ mantém estado próprio
```

Arquitetura em construção:

```text
Carteira
↓
Cliente / ClienteConta
↓
VF Context
↓
Shell V3
↓
Módulo
↓
Backend account-aware
```

O backend já possui grande parte dos contratos necessários.

O frontend já possui Shell, Context Store e Carteira funcional.

O principal trabalho estrutural restante é:

```text
1. integrar definitivamente as duas frentes;
2. migrar páginas para o contexto único;
3. implementar isolamento real por Squads;
4. construir Visão e Financeiro sobre essa fundação;
5. remover o legado ao final.
```
