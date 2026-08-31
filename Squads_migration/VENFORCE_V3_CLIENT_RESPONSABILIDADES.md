# VenForce V3 — P2.4 · Responsabilidades de Cliente

**Data:** 2026-08-28
**Branch:** `backend/v3-squads-auth` (não mergeada)
**Escopo:** SOMENTE P2.4. Não abre P2.5 (Visão) nem P2.6 (Financeiro).
**Estado operacional:** `SQUADS_ENFORCEMENT` OFF, sem migração real, sem produção.

---

## 0. Princípio (não negociável)

> **RESPONSABILIDADE NÃO É AUTORIZAÇÃO.**

`cliente_responsaveis` diz **quem cuida** de um Cliente (gestor / auxiliar /
designer). **Quem pode ver** um Cliente continua vindo *exclusivamente* do
Squad, via `server/services/squads/authorizationService.js` — que **não lê**
`cliente_responsaveis` e **não foi alterado** nesta fase.

Consequências garantidas em código:

- `authorizationService.canAccessCliente` / `resolvePortfolioClientes` /
  `assertClienteNaCarteira*` **não** consultam `cliente_responsaveis`.
- Remover o gestor de um Cliente **não** remove o acesso de ninguém.
- Adicionar alguém como responsável **não** concede acesso — se a pessoa
  não estiver no Squad do Cliente, ela continua sem ver o Cliente.
- A limpeza de responsáveis na transferência de Squad é disparada **pela**
  transferência (autorização → responsabilidade), nunca o contrário.

---

## 1. Papéis

| Papel | Obrigatório? | Regra |
|---|---|---|
| `gestor` | **Sim** na operação normal | Todo Cliente deve ter 1 gestor vigente. Protegido contra remoção manual do último (ver §4). |
| `auxiliar` | Não | Opcional; 0..N. |
| `designer` | Não | Opcional; 0..N. |

- **Coordenador de Squad pode ser gestor**, excepcionalmente. Não há
  tratamento especial no código: o coordenador é membro do Squad, então
  passa naturalmente na checagem de acesso do responsável.
- **Coordenador de Squad NÃO é admin global.** Ele administra responsáveis
  **somente** dos Clientes do **próprio** Squad (gate no controller). Fora
  do seu Squad, não lista, não atribui, não remove.

---

## 2. Modelo de dados

Tabela `cliente_responsaveis` **já existia** (`20260827_squads_foundation.sql`
§4). P2.4 só **adiciona colunas** (`20260828_cliente_responsaveis_p24.sql`,
aditiva e idempotente — `ADD COLUMN IF NOT EXISTS`):

| Coluna nova | Uso |
|---|---|
| `criado_por` | quem atribuiu (auditoria) |
| `encerrado_em` | quando o vínculo deixou de vigorar |
| `encerrado_por` | quem encerrou |
| `motivo` | `remocao_manual` · `troca_de_responsavel` · `transferencia_squad` · texto de migração |

**Índice único `uq_cliente_responsaveis_cliente_user_papel` intocado.**
Mudá-lo quebraria o `ON CONFLICT (cliente_id, user_id, papel)` da ferramenta
de migração P2.3.

### Modelo de histórico (decisão)

- 1 linha por `(cliente, user, papel)`, para sempre.
- **Vigente** = `ativo = true` (`encerrado_em IS NULL`).
- **Encerrado** = `ativo = false` + `encerrado_em/por/motivo` preenchidos.
- **Reativar** = `UPDATE ativo = true, encerrado_em = NULL` — reusa a linha.

**Fora de escopo (dívida aceitável, documentada):** histórico temporal
multi-passagem — a mesma pessoa entrando/saindo/entrando no mesmo papel N
vezes, cada passagem com data própria. Hoje a linha guarda **o último
estado** + quando/por que foi encerrada. Se isso for exigido no futuro, a
solução aditiva é uma tabela `cliente_responsaveis_history` (append-only),
sem tocar na tabela principal. **Não foi feita agora** para não fazer
migration grande sem necessidade.

Carregamento no boot: `squadsRepository.ensureSquadsTables()` agora reaplica
os **dois** arquivos de migração (S + P2.4).

---

## 3. Contrato HTTP

Montado em `server/index.js`: `app.use("/clientes", clienteResponsaveisRoutes)`.

Todas as rotas: `authMiddleware` → `requireAutomacoesAccess` (roles internas)
→ `requireClienteNaCarteira("cliente")` (o solicitante enxerga o Cliente?).
As de **escrita** somam `requireResponsabilidadeAdmin` (admin **ou**
coordenador do Squad ativo do Cliente).

| Método | Rota | Ação | Quem |
|---|---|---|---|
| `GET` | `/clientes/:cliente/responsaveis` | Lista os vigentes. `?historico=true` inclui encerrados. | Qualquer role interna com o Cliente na carteira |
| `POST` | `/clientes/:cliente/responsaveis` | Atribui `{ userId, papel }`. | admin \| coordenador do Squad |
| `PATCH` | `/clientes/:cliente/responsaveis/:papel` | **Troca**: encerra o(s) titular(es) do papel e ativa `{ userId }`, numa transação. | admin \| coordenador do Squad |
| `DELETE` | `/clientes/:cliente/responsaveis/:userId/:papel` | Encerra (soft-delete) o vínculo. | admin \| coordenador do Squad |

### Corpo — campos opcionais de escrita

| Campo | Efeito |
|---|---|
| `permitirSemAcesso: true` | **Só tem efeito junto com `motivoMigracao`.** Permite atribuir/trocar para um usuário que **não** é membro do Squad ativo do Cliente. Escape de migração controlado. |
| `motivoMigracao: "<texto>"` | (a) destrava `permitirSemAcesso`; (b) destrava a remoção do **último** gestor (§4). Grava em `cliente_responsaveis.motivo`. |

### Códigos de erro

| HTTP | `code` | Quando |
|---|---|---|
| 400 | `PAPEL_INVALIDO` | papel ∉ {gestor, auxiliar, designer} |
| 404 | `CLIENTE_NAO_ENCONTRADO` / `USUARIO_NAO_ENCONTRADO` | referência inexistente |
| 404 | `RESPONSAVEL_NAO_ENCONTRADO` | remover um vínculo que não está vigente |
| 422 | `RESPONSAVEL_INVALIDO` | tentar responsabilizar um `seller` / `shopee_reviewer` |
| 409 | `RESPONSAVEL_SEM_ACESSO` | usuário-alvo não é membro do Squad ativo do Cliente e não houve escape de migração válido |
| 409 | `GESTOR_OBRIGATORIO` | remover o último gestor vigente sem `motivoMigracao` |
| 403 | `RESPONSABILIDADE_ADMIN_REQUERIDA` | escrita sem ser admin nem coordenador do Squad do Cliente |

---

## 4. "Último gestor obrigatório" — escopo exato

| Fluxo | O gestor obrigatório é exigido? |
|---|---|
| `DELETE .../responsaveis/:userId/gestor` (remoção **manual**) | **Sim.** Bloqueia com `GESTOR_OBRIGATORIO` se for o último gestor vigente. Destrava com `motivoMigracao`. |
| `PATCH .../responsaveis/gestor` (**troca**) | Não bloqueia — a troca nunca passa por um estado sem gestor (encerra o antigo e ativa o novo na mesma transação). É o caminho recomendado para trocar gestor. |
| **Transferência de Squad** (`squadService.transferirCliente`) | **Não.** É um estado de migração tratado: encerra responsáveis que perderam acesso e **sinaliza** a pendência (não impede a transferência). |
| **Migração P2.3** (`squadsMigracaoImportService`) | **Não.** Mesmo racional; o plano de migração é responsável por reatribuir o gestor. |

---

## 5. Transferência de Squad — comportamento

Quando um Cliente muda de Squad (via `squadService.transferirCliente` **ou**
pelo ramo de transferência da migração P2.3):

1. As responsabilidades **vigentes** cujo titular **não** é membro ativo do
   Squad de destino são **encerradas** (`ativo=false`, `motivo='transferencia_squad'`).
   Quem também está no Squad novo **permanece**.
2. A transferência **não é bloqueada** por ficar sem gestor.
3. O resultado de `transferirCliente` passa a incluir:

```js
{
  // ...campos existentes (squad_id, squadOrigemId, ...)
  responsabilidade: {
    responsaveisEncerrados: [ { userId, papel }, ... ],
    pendencias: [ { tipo: "gestor_ausente" } ]   // LISTA ABERTA
  }
}
```

`pendencias` é uma **lista de objetos `{ tipo }`**, deliberadamente aberta:
hoje só emite `gestor_ausente`, mas novos tipos (ex.: `auxiliar_ausente`,
`designer_ausente`, `sem_responsavel`) podem ser adicionados **sem quebrar**
quem consome. Consumidores devem iterar e ignorar tipos desconhecidos.

Ordem na migração P2.3: a limpeza roda no passo 3 (clientes→squad), **antes**
do passo 4 (responsáveis do plano) — então o plano pode reatribuir o novo
gestor logo em seguida, na mesma transação.

---

## 6. `/me/portfolio` — impacto

- `responsavelDireto: boolean` — **inalterado**, continua real
  (`cliente_responsaveis` filtrado por `user.id`).
- **Novo:** `papeisDiretos: string[]` por cliente — os papéis **deste**
  usuário naquele Cliente (`[]`, `["gestor"]`, `["auxiliar","designer"]`…).
  0..3 strings curtas; não infla o payload de forma relevante.
- `/me/context` **não muda** (segue leve — só `responsavelDireto`).

Nada disso altera a carteira nem qualquer decisão de acesso.

---

## 7. Arquivos

**Criados**
- `server/sql/migrations/20260828_cliente_responsaveis_p24.sql`
- `server/services/squads/clienteResponsaveisService.js`
- `server/controllers/clienteResponsaveisController.js`
- `server/routes/clienteResponsaveisRoutes.js`
- `server/tests/clienteResponsaveisService.test.js`
- `Squads_migration/VENFORCE_V3_CLIENT_RESPONSABILIDADES.md` (este)

**Editados**
- `server/services/squads/squadsRepository.js` — 2ª migração no boot + métodos de leitura/escrita de responsáveis
- `server/services/squads/squadService.js` — hook de limpeza na transferência + `responsabilidade` no resultado
- `server/services/squads/squadsMigracaoImportService.js` — mesma limpeza no ramo de transferência + reset de `encerrado_em` no upsert
- `server/services/meService.js` — `papeisDiretos` em `/me/portfolio`
- `server/index.js` — monta `/clientes` (responsáveis)
- `server/tests/squadServiceMutacoes.test.js` — mocks + asserção de transferência
- `server/tests/squadsMigracaoImport.test.js` — mock do UPDATE + cenário de transferência

**NÃO tocados:** `authorizationService.js`, frontend, contratos de Visão/Financeiro,
índice único de `cliente_responsaveis`.

---

## 8. Testes

`node tests/run-all.js` com o `TEST_SKIP` padrão (4 suítes preexistentes
vermelhas na `main`, não relacionadas) → **145 arquivos verdes**
(144 baseline + `clienteResponsaveisService.test.js`).

`clienteResponsaveisService.test.js` (24 verificações): gestor / auxiliar /
designer; coordenador como gestor; `PAPEL_INVALIDO`; `RESPONSAVEL_INVALIDO`
(seller); `RESPONSAVEL_SEM_ACESSO`; escape só com `permitirSemAcesso` +
`motivoMigracao`; cliente sem Squad (pré-migração) pula a checagem;
`GESTOR_OBRIGATORIO` na remoção manual; `motivoMigracao` destrava; troca de
gestor sem gap; troca para alguém de fora exige escape; listagem
vigente/histórico.

`squadServiceMutacoes.test.js` (+2): transferência encerra responsável sem
acesso ao destino; resultado traz `pendencias`.

`squadsMigracaoImport.test.js` (+4): transferência via migração encerra a
responsabilidade órfã e reatribui o novo gestor.

---

## 9. Riscos

| Risco | Severidade | Mitigação |
|---|---|---|
| Migração adicional tocando arquivo canônico da fase S no boot | Baixo | Arquivo **novo** e separado; só `ADD COLUMN IF NOT EXISTS`; `ensureSquadsTables` roda os dois em sequência; tabela vazia em produção |
| Edição de `squadsMigracaoImportService.js` (P2.3 "concluído") | Baixo–Médio | Uma UPDATE extra na transação existente, atrás do mesmo `ON CONFLICT`; suíte P2.3 verde + cenário novo de transferência |
| `papeisDiretos` em `/me/portfolio` quebrar consumidor | Muito baixo | Campo **aditivo**; `responsavelDireto` inalterado; nenhuma ilha React consome `/me/portfolio` ainda |
| Coordenador administrar Cliente recém-transferido | Baixo | `requireResponsabilidadeAdmin` resolve o Squad **ativo** do Cliente a cada request — sem cache |
| Sem histórico temporal multi-passagem | Aceito | Documentado (§2); solução aditiva conhecida se exigido |
| `RESPONSAVEL_SEM_ACESSO` usa checagem estrutural de `squad_members` (não o flag de enforcement) | Intencional | Responsabilidade não deve depender do rollout do enforcement; com Cliente sem Squad a checagem é pulada |

---

## 10. Respostas finais

- **CRUD PRONTO?** Sim — `GET` (com histórico), `POST` (atribuir),
  `PATCH :papel` (trocar), `DELETE :userId/:papel` (encerrar), com RBAC
  admin / coordenador-do-Squad e testes cobrindo os papéis, a troca, a
  transferência e o usuário de fora do Squad.
- **GESTOR OBRIGATÓRIO PROTEGIDO?** Sim, **na remoção manual** (`GESTOR_OBRIGATORIO`),
  com destravamento explícito por `motivoMigracao`. Transferência e migração
  não são bloqueadas — sinalizam a pendência.
- **TRANSFERÊNCIA CONSISTENTE?** Sim — encerra responsáveis que perderam
  acesso ao Squad de destino, preserva quem tem acesso, não faz delete
  destrutivo (soft-delete com `motivo`), e devolve `responsabilidade.pendencias`
  como lista aberta para pendências futuras além de gestor.
- **RESPONSABILIDADE CONTINUA SEM DEFINIR ACESSO?** Sim.
  `authorizationService` não foi tocado e não lê `cliente_responsaveis`;
  nenhuma rota de responsabilidade concede acesso; a única interação
  autorização↔responsabilidade é a limpeza disparada **pela** transferência.

**Parado em P2.4. P2.5 não iniciado.**
