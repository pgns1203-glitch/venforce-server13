# REPARO PRÉ-SQUADS — Identidade Cliente → Conta → Grant/Base nos consumidores

**Projeto:** VenForce Server  
**Repositório de referência:** `pgns1203-glitch/venforce-server13`  
**Data da triagem:** 25/08/2026  
**Objetivo:** estabilizar a identidade operacional das contas de marketplace antes de ativar escopo/autorização por Squad nas telas operacionais.

---

## 1. Por que este reparo deve ser separado de Squads

O modelo organizacional aprovado é:

```text
ROLE
  ↓
SQUAD
  ↓
CLIENTE
  ↓
CLIENTE_CONTA
  ↓
GRANT / BASE / ADS / VENDAS / MÉTRICAS / FECHAMENTO
```

Regras já fechadas:

- o Squad pertence ao nível de **Cliente**, não de `cliente_conta`;
- se o Squad possui o Cliente na carteira, seus membros autorizados precisam ter acesso a **todas as contas** desse Cliente;
- `cliente_conta` existe para identificar corretamente a operação (ML 1, ML 2, Shopee 1...), não para dividir o Cliente entre Squads;
- uma conta/grant/base nunca deve ser inferida silenciosamente quando o Cliente possui 2+ contas no mesmo marketplace.

Portanto existem dois problemas independentes:

1. **Squads:** quem pode acessar quais Clientes.
2. **Identidade operacional:** dentro de um Cliente autorizado, qual conta/grant/base está sendo usada.

Misturar os dois numa mesma implementação aumenta muito o risco. A recomendação é executar este reparo em paralelo enquanto a modelagem/UX de Squads continua.

### Gate recomendado

Este reparo **não precisa estar concluído** para:
- continuar a descoberta de Squads;
- definir schema de Squads;
- desenhar a tela administrativa;
- definir memberships, responsáveis e histórico;
- implementar CRUD isolado de Squads.

Mas deve estar concluído **antes de**:
- ligar enforcement de carteira nas telas operacionais;
- fazer o contexto global de Squad/Cliente atravessar Ads, Métricas, Cliente Operação etc.;
- considerar “Meu Trabalho”/Dashboard como fonte confiável de pendências de todas as contas.

---

## 2. O que NÃO precisa ser redesenhado

### 2.1 `cliente_contas`

A fundação atual já oferece o contrato correto em:

`server/services/clienteContas/clienteContaService.js`

Função canônica:

```js
resolveMarketplaceAccountContext({
  clienteId,
  clienteSlug,
  marketplace,
  clienteContaId,
  requireUsableGrant
})
```

Comportamento atual desejável:

- `clienteContaId` explícito:
  - valida se a conta pertence ao Cliente;
  - valida marketplace;
  - resolve grant ML exato;
  - resolve base oficial da conta.
- sem `clienteContaId`:
  - 1 conta ativa → fallback compatível;
  - 2+ contas ativas → `409 MULTIPLE_MARKETPLACE_ACCOUNTS`;
  - 0 contas → modo legado temporário.

**Não criar outro resolver paralelo.**

### 2.2 `/clientes`

`Portal/clientes.js` já está account-aware:

- lista `/clientes/:cliente/contas`;
- conecta Mercado Livre via `/ml/conectar-conta/:contaId`;
- exibe grant por conta;
- base é definida/trocada por `cliente_conta`;
- conta principal é conceito de UX/default, não substituto de identidade explícita;
- permite múltiplas contas ML/Shopee.

Evitar refatoração estrutural aqui durante este reparo. A alteração futura da página para `coordenador`/Squads pertence ao projeto Squads.

### 2.3 Bases — núcleo de vínculo

O estado atual já avançou além da auditoria antiga:

- `server/services/baseVinculosService.js` serializa de forma aditiva:
  - `cliente_conta_id`
  - `conta_nome`
  - `conta_slug`
  - `external_account_id`
  - grant sanitizado
- escrita legado/account-aware converge para `vincularBaseNaContaTx`;
- mismatch de marketplace é bloqueado;
- múltiplas contas não são escolhidas implicitamente;
- `Portal/bases.js` já possui picker explícito de conta no vínculo;
- marketplace do vínculo é derivado da base, não escolhido manualmente.

Não reabrir a arquitetura de vínculo. Somente validar os fluxos restantes de importação/assistente contra o contrato atual.

### 2.4 Central de Vendas

É o melhor exemplo atual do padrão alvo.

`server/services/centralVendas/centralVendasSyncService.js` já:

```text
clienteSlug
 + clienteContaId
       ↓
resolveMarketplaceAccountContext()
       ↓
sellerId / grant exato
base oficial da conta
       ↓
run sincronizado
```

O contexto é resolvido antes do processamento e pode ser congelado em `accountContext`.

**Usar Central de Vendas como referência de arquitetura. Não reescrever.**

---

# 3. Problema real encontrado

A fundação account-aware existe, porém consumidores importantes continuam no modelo antigo:

```text
cliente_slug / cliente_id
       +
marketplace
       ↓
resolveMlGrant(clienteId)
       ↓
grant principal / primeiro utilizável
```

Esse contrato deixa de ser seguro quando existe:

```text
Cliente X
├── Mercado Livre 1 → grant A
└── Mercado Livre 2 → grant B
```

A UI pode mostrar apenas “Cliente X”, enquanto o backend seleciona o grant principal.

Isso não é apenas um problema de UX: pode consultar pedidos, anúncios, Ads ou métricas da conta errada.

---

# 4. Prioridades do reparo

## P0 — `mlTokenService` / `mlClient`: não transformar “principal” em identidade

### Arquivos

- `server/services/mlTokenService.js`
- `server/utils/mlClient.js`
- consumidores listados abaixo

### Estado observado

`resolveMlGrant({ clienteId })` mantém compatibilidade histórica:

- procura grant principal;
- se não houver, escolhe um utilizável;
- pode até promover fallback para principal.

`mlFetch(clienteId, path, options)` recebe opcionalmente `mlUserId`, mas não recebe `clienteContaId`.

Isso é aceitável como **compatibilidade**, mas não pode continuar sendo a API mental dos novos consumidores account-sensitive.

### Direção

Não quebrar o legado globalmente.

Em vez disso:

1. consumidor account-sensitive resolve primeiro:
   `resolveMarketplaceAccountContext`;
2. obtém `context.mlUserId` / `context.conta.id`;
3. chama a API ML com identidade explícita;
4. somente consumidores comprovadamente client-level podem usar fallback legado.

### Regra

```text
is_primary = default de UX
is_primary != identidade da operação
```

Nunca usar “principal” para esconder uma ambiguidade de duas contas quando a ação é account-specific.

---

## P0 — Ads

### Evidência atual

Frontend:

`Portal/ads.js`

A seleção é:

```text
clienteSlug
+ mês
```

E performance chama:

```text
GET /ads/performance?clienteSlug=...&mes=...
```

Backend:

`server/controllers/adsController.js`

`getAdsPerformance()` chama:

```js
buscarPerformanceML(clienteSlug, mes)
```

Service:

`server/services/ads/mlAdsService.js`

`resolverClienteToken(clienteSlug)`:

```js
resolveMlGrant({
  clienteId,
  requireUsable: true
})
```

Ou seja: a conta ML específica não faz parte do contrato.

### Problema

Com ML1 + ML2, a tela pode exibir performance somente do grant escolhido como principal, sem dizer isso.

### Reparo recomendado

Adicionar `clienteContaId` ao contexto da tela/API.

Exemplo conceitual:

```text
Cliente
  ↓
Conta ML
  ↓
Mês
  ↓
Performance Ads
```

Backend:

```js
resolveMarketplaceAccountContext({
  clienteSlug,
  marketplace: "meli",
  clienteContaId,
  requireUsableGrant: true
})
```

Persistências de Ads precisam de decisão explícita:
- se acompanhamento/resumo mensal é por **Cliente agregado**, manter client-level;
- se representa uma conta específica, persistir `cliente_conta_id`;
- não misturar performance de uma conta com resumo manual “todas” sem rotular origem.

### Testes

- Cliente com 1 ML → fluxo legado continua.
- Cliente com ML1+ML2 sem conta → 409/estado de seleção, nunca escolha silenciosa.
- ML1 selecionada → advertiser/performance de ML1.
- ML2 selecionada → advertiser/performance de ML2.
- conta não pertencente ao Cliente → 403/422.
- Squad não entra neste serviço ainda.

---

## P0 — Métricas Mercado Livre

### Arquivo

`server/services/metricasService.js`

### Estado observado

`listarClientesComML()` e `buscarClienteComToken()` fazem:

```js
resolveMlGrant({ clienteId, requireUsable: true })
```

`buscarResumo({ clienteSlug, ... })` trabalha com um único `ml_user_id`.

A chamada de Orders é exata depois que tem `sellerId`, mas o seller inicial é escolhido implicitamente.

### Problema

Com duas contas ML, “Métricas do Cliente” representa apenas uma conta sem contrato explícito.

### Decisão de produto necessária

Escolher um dos modelos e deixar explícito:

**Modelo A — account-first**
```text
Cliente → Conta → Métricas
```

**Modelo B — client aggregate**
```text
Cliente → todas as contas ML → agrega métricas
```

Para o futuro Cliente 360/Squads, o modelo B tende a ser útil para KPIs de Cliente, enquanto uma tela operacional de métricas deve permitir drill-down por conta.

### Recomendação

Implementar o núcleo account-aware primeiro:
- função de resumo por `clienteContaId`;
- agregador por Cliente em camada acima, se desejado.

Não fazer agregação “mágica” dentro de `resolveMlGrant`.

### Testes

- métricas ML1 isoladas;
- métricas ML2 isoladas;
- agregado = ML1 + ML2 quando o modo Cliente agregado for solicitado;
- sem double count;
- erro parcial de uma conta deve ser visível no agregado.

---

## P0 — Anúncios Mercado Livre

### Arquivos

- `Portal/anuncios-meli.js`
- `server/services/meliAnuncios/meliAnunciosService.js`
- controllers/routes do módulo

### Estado observado

Frontend trabalha com:

```text
clienteAtual
```

e endpoints usam `clienteSlug`.

Backend:

`resolverMlUserId(clienteId)` usa:

```js
resolveMlGrant({ clienteId, requireUsable: true })
```

Além disso, a tabela `meli_anuncios` hoje usa:

```sql
UNIQUE (cliente_id, item_id)
```

e não possui identidade de `cliente_conta`.

### Problema

A sincronização de catálogo é account-sensitive. Com duas contas ML:
- sincronizar pode usar só o grant principal;
- catálogo pode parecer “do Cliente” mesmo sendo de uma conta;
- não há origem de conta persistida para auditoria.

### Reparo recomendado

Esse módulo precisa de decisão de persistência, não apenas picker visual.

Avaliar adicionar `cliente_conta_id`/seller de origem aos registros de sincronização/anúncio.

Possível chave:

```text
(cliente_conta_id, item_id)
```

ou preservar `cliente_id` para consulta agregada e adicionar constraint account-aware.

**Não alterar schema sem migration + auditoria dos dados atuais.**

### Testes

- sync ML1 não sobrescreve origem da ML2;
- filtro Cliente agregado pode unir as duas;
- detalhe sabe de qual conta veio;
- ações que chamam API ML usam a mesma conta de origem do anúncio.

---

## P0 — Cliente Operação

### Arquivo

`Portal/cliente-operacao.js`

### Estado observado

A tela ainda monta o workspace puxando várias fontes globais:

- `/clientes`
- `/bases`
- `/base-vinculos`
- `/base-vinculos/clientes`
- `/admin/ml-tokens`
- `/automacoes/relatorios`
- `/operacao/base-cobertura`
- entregas e Ads por cliente

Depois filtra e escolhe localmente:

```js
const tokenPrincipal = tokenRows[0] || null;
const basePrincipal = basesDoCliente[0] || ...
```

Há até TODO no próprio arquivo sugerindo um futuro endpoint de workspace do Cliente.

### Problema

Esta tela é exatamente a que deveria representar:

```text
Cliente
├── Conta ML1
├── Conta ML2
├── Shopee
└── estado operacional
```

Mas ainda reconstrói a verdade no frontend e trabalha com “principal/primeiro”.

É especialmente importante porque o Dashboard já manda prioridades para `cliente-operacao.html?cliente=...`.

### Reparo recomendado

Criar/usar um contrato backend de workspace do Cliente, account-aware.

Formato conceitual:

```json
{
  "cliente": {},
  "contas": [
    {
      "id": 1,
      "marketplace": "meli",
      "nome": "Mercado Livre 1",
      "grant": {},
      "base": {}
    }
  ],
  "resumo_cliente": {},
  "pendencias": []
}
```

O frontend não deve consultar `/admin/ml-tokens` para montar o workspace.

Esse endpoint será posteriormente muito fácil de proteger com:

```text
canAccessCliente(user, cliente_id)
```

quando Squads entrar.

### Importante

Não adicionar `squad_id` nesse contrato agora.

Primeiro estabilizar Cliente/Conta. Depois Squads apenas controla se o Cliente pode ser acessado.

---

## P1 — Cliente 360

### Arquivos

- `server/services/cliente360/cliente360Repository.js`
- `server/services/cliente360/cliente360SyncService.js`
- `server/services/cliente360/cliente360Service.js`

### Estado observado

Repository:

`findMlGrantByCliente(clienteId)` retorna um único grant, priorizando `is_primary`.

Sync:

`consolidarMetricasMes()` chama `metricasService.buscarResumo({ clienteSlug, ... })`, que também resolve um único grant.

Snapshot é salvo por:

```text
(cliente_id, competencia)
```

### Problema

Cliente 360 é semânticamente client-level, então não deveria mostrar apenas ML1 se o Cliente possui ML1 + ML2.

### Recomendação

Não transformar Cliente 360 em account-first.

A melhor direção é:

```text
Cliente 360
  = agregado de todas as contas relevantes
  + cobertura/origem por conta
```

Exemplo:

```json
{
  "faturamento": 500000,
  "cobertura": {
    "contas_esperadas": 2,
    "contas_coletadas": 2
  }
}
```

O sync deve chamar o novo agregador de Métricas account-aware.

Se uma das contas falhar:
- não fingir resultado completo;
- retornar/salvar cobertura parcial.

---

## P1 — Dashboard / “Meu Trabalho”

### Arquivo

`server/services/dashboardService.js`

### Estado observado

O resolver de carteira já é o ponto certo para Squads:

```js
resolveEffectivePortfolio(user)
```

Não mexer nele neste reparo.

Mas readiness hoje é client-level simplificado:

```sql
FROM ml_tokens
WHERE t.cliente_id = c.id

BOOL_OR(grant utilizável) AS connected
```

### Problema

Se Cliente tem:
- ML1 conectada
- ML2 desconectada

`BOOL_OR` pode marcar o Cliente como “grant conectado” e esconder a pendência da ML2.

O mesmo vale para bases: “tem alguma base” não significa “todas as contas configuradas”.

### Reparo recomendado

Mudar readiness para cobertura por conta:

```text
Cliente X
Contas esperadas: 3
Configuradas: 2
Pendentes: 1
```

Possível contrato:

```json
{
  "accounts": {
    "total": 3,
    "ready": 2,
    "pending": 1
  }
}
```

O Dashboard continua sendo client-level; apenas passa a conhecer pendências account-level.

Isso é especialmente importante antes de usar o Dashboard como “Meu Trabalho” dos Squads.

---

## P1 — Financeiro / Fechamento

### Arquivo

`Portal/financeiro.js`

### Estado observado

Para Mercado Livre, a tela ainda detecta base por:

```text
clienteSlug + marketplace
```

fazendo `GET /base-vinculos` e escolhendo o primeiro vínculo compatível.

Não existe seleção de `cliente_conta_id` no fluxo exibido.

### Problema

Com ML1 + ML2, a base correta pode ser ambígua.

Mesmo quando vendas vêm de planilha, o vínculo da base precisa representar a conta/loja correspondente ao arquivo processado.

### Recomendação

Adicionar contexto de conta ao fechamento quando o marketplace possuir `cliente_contas`.

Fluxo alvo:

```text
Cliente
→ Conta
→ Marketplace
→ Base oficial da conta
→ arquivos / processamento
```

Persistir `cliente_conta_id` no fechamento/snapshot quando a origem for account-specific, se o schema permitir mediante migration aprovada.

Não misturar com filtro de Squad.

---

# 5. Classificação final das áreas

| Área | Estado | Ação pré-Squads |
|---|---|---|
| `cliente_contas` service | **Pronto como fundação** | Não redesenhar |
| `/clientes` | **Account-aware** | Não refatorar agora; roles ficam para Squads |
| Bases — vínculo | **Account-aware no estado atual** | Validar regressões/importação; não reescrever |
| Central de Vendas | **Referência account-aware** | Não reescrever |
| Ads | **Cliente/grant implícito** | P0 migrar |
| Métricas ML | **Cliente/grant implícito** | P0 migrar |
| Anúncios ML | **Cliente/grant implícito + persistência client-only** | P0 analisar/migrar |
| Cliente Operação | **Agregação montada no frontend / principal** | P0 criar contrato backend |
| Cliente 360 | **Client-level, mas baseado em 1 grant** | P1 agregar contas com cobertura |
| Dashboard readiness | **BOOL_OR por Cliente** | P1 tornar account-aware |
| Financeiro | **Cliente + marketplace para base** | P1 adicionar conta |
| Squads | **Não implementar neste pacote** | continuar em paralelo |

---

# 6. Ordem recomendada para a segunda pessoa

## Etapa R0 — testes/contrato

Antes de mudar comportamento:

1. criar fixture mental/teste para:
   - Cliente A → ML1
   - Cliente A → ML2
   - Cliente A → Shopee1
2. confirmar que:
   - grants ML1/ML2 possuem `cliente_conta_id`;
   - bases possuem `cliente_conta_id`;
3. cobrir `resolveMarketplaceAccountContext`.

## Etapa R1 — Ads + Métricas

São consumidores diretos de API ML e hoje escolhem grant por Cliente.

Objetivo:
- aceitar conta explícita;
- preservar fallback só para Cliente com exatamente uma conta;
- nunca escolher entre duas.

## Etapa R2 — Anúncios ML

Resolver também a persistência da origem da conta.

Não fazer migration de forma improvisada: primeiro medir dados existentes e desenhar backfill.

## Etapa R3 — Cliente Operação

Substituir a montagem client-side baseada em endpoints globais por um workspace backend account-aware.

## Etapa R4 — Cliente 360 + Dashboard

Transformar account-level em agregado client-level com informação de cobertura.

## Etapa R5 — Financeiro

Propagar conta para base/fechamento e persistência, conforme a política definida.

---

# 7. Contrato técnico recomendado

Qualquer consumidor account-sensitive deve pensar assim:

```js
const context = await resolveMarketplaceAccountContext({
  clienteSlug,
  marketplace,
  clienteContaId,
  requireUsableGrant: true,
});
```

E depois consumir:

```text
context.cliente
context.conta
context.mlUserId
context.grant
context.base
```

Não repetir SQL próprio de:

```text
SELECT primeiro grant do cliente
SELECT última base do cliente
```

---

# 8. Regras de compatibilidade

Durante a migração:

### Cliente com uma única conta

Pode continuar funcionando sem `cliente_conta_id` explícito.

### Cliente com duas ou mais contas do mesmo marketplace

Nunca fazer fallback.

Esperado:

```text
409 MULTIPLE_MARKETPLACE_ACCOUNTS
```

A UI deve então pedir seleção de conta ou usar uma conta já presente no contexto da navegação.

### `is_primary`

Pode ser usado para:
- ordenar;
- preencher default visual;
- abrir uma conta inicialmente.

Não pode ser usado para:
- executar silenciosamente uma operação account-sensitive quando existem múltiplas contas.

### Squad

Nenhum service deste reparo deve perguntar por `squad_id`.

A autorização futura será:

```text
User
→ Squad membership
→ pode acessar Cliente?
→ SIM
→ todas as cliente_contas daquele Cliente ficam no universo autorizado
```

Depois disso, a conta específica continua sendo escolhida pelo contexto operacional.

---

# 9. Critérios de aceite globais

## Cenário A — Cliente simples

```text
Cliente X
└── ML1
```

- telas antigas continuam funcionando;
- resolver pode usar fallback de conta única;
- nenhuma regressão.

## Cenário B — Cliente multi-ML

```text
Cliente X
├── ML1
└── ML2
```

- operação sem identidade explícita nunca consulta silenciosamente ML1;
- usuário consegue escolher ML1 ou ML2;
- token/base/dados correspondem à conta selecionada.

## Cenário C — Multi-marketplace

```text
Cliente X
├── ML1
├── ML2
└── Shopee1
```

- entidade Cliente permanece única;
- todas as contas aparecem dentro dele;
- cada conta mantém sua base/identidade;
- futuramente um único Squad que possui Cliente X acessará as três.

## Cenário D — segurança de pertencimento

Enviar:

```text
cliente = A
cliente_conta_id = conta do Cliente B
```

deve falhar no backend.

Nunca confiar apenas no frontend.

## Cenário E — agregado do Cliente

Cliente 360/Dashboard podem somar/avaliar todas as contas, porém precisam informar cobertura parcial quando alguma conta falhar.

---

# 10. Arquivos que este pacote NÃO deve tocar

Para evitar conflito com a implementação paralela de Squads:

- migrations/tabelas de `squads`;
- `squad_members`;
- `cliente_squad_history`;
- `cliente_responsaveis`;
- nova tela de administração de Squads;
- mudança das roles para `coordenador`, `gestor`, `auxiliar`, `designer`;
- `resolveEffectivePortfolio()` para filtrar por Squad;
- sidebar/contexto global de Squad;
- regras de `canAccessCliente()` por Squad.

A única interface compartilhada entre os projetos deve ser:

```text
Squads autoriza CLIENTE.
Cliente/Conta resolve a operação interna.
```

---

# 11. Resultado esperado após o reparo

Antes:

```text
Cliente
  ↓
“pega o grant”
  ↓
provavelmente o principal
```

Depois:

```text
Cliente
  ↓
Contas disponíveis
  ↓
Conta exata / agregado explícito
  ↓
Grant + Base exatos
  ↓
Dados
```

E Squads entra depois sem precisar conhecer detalhes de grant:

```text
Usuário
  ↓
Squad
  ↓
Cliente autorizado
  ↓
Cliente Conta
  ↓
Grant/Base/Dados
```

Essa separação é o objetivo principal deste pacote.
