# VENFORCE_V3_SQUADS_DATA_MIGRATION_RUNBOOK — P2.3

**Frente:** Backend VenForce V3 — P2.3 (Migration Tooling / dry-run dos dados de Squad)
**Branch:** `backend/v3-squads-auth` (não mergeada)
**Base:** P2.2 (`VENFORCE_V3_SQUADS_ROLLOUT_SAFETY.md`)
**Data:** 2026-08-27

> **Escopo de P2.3:** construir a **ferramenta** de migração — template, validação,
> dry-run, execução transacional idempotente e relatório. **NENHUM dado real foi
> preenchido.** As atribuições reais (quais Squads existem, quem pertence a
> qual, quais Clientes) vêm da operação e entram no plano na P2.9.

---

## 1. O que foi entregue

| Artefato | Papel |
|---|---|
| `Squads_migration/SQUADS_MIGRATION_TEMPLATE.json` | esqueleto do plano (listas vazias + doc inline) |
| `Squads_migration/SQUADS_MIGRATION_TEMPLATE.example.json` | exemplo **fictício** só do formato (não usar) |
| `server/services/squads/squadsMigracaoImportService.js` | `validarPlano` · `importar({ dryRun })` · `snapshot` |
| `server/sql/squads-migrate.js` | CLI (dry-run por padrão; `--apply` para escrever) |
| `server/services/squads/squadsMigracaoService.js` | auditoria **melhorada** (distingue Squad inativo) |
| `server/tests/squadsMigracaoImport.test.js` | 39 verificações |

Nenhum schema alterado (a fundação `20260827_squads_foundation.sql` já cobre
todas as tabelas). Nenhum dado migrado. Sem merge.

---

## 2. Auditoria melhorada (lacuna do readiness corrigida)

`GET /squads/migracao/auditoria` (admin) e `squads-migrate.js --audit` agora
distinguem **Squad inativo** como categoria própria:

**Clientes ativos:**

| Categoria | Chave |
|---|---|
| com Squad **ativo** | `clientesAtivos.comSquadAtivo` |
| **em Squad inativo** (novo) | `clientesAtivos.emSquadInativo` + `listaEmSquadInativo` |
| sem Squad | `clientesAtivos.semSquad` + `listaSemSquad` |

**Usuários internos:**

| Categoria | Chave |
|---|---|
| com membership ativa | `usuariosInternos.comMembership` |
| sem membership | `usuariosInternos.semMembership` |
| **apenas em Squad inativo** (novo) | `usuariosInternos.apenasEmSquadInativo` |
| sem principal | `usuariosInternos.semPrincipal` |
| principal duplicado | `usuariosInternos.comPrincipalDuplicado` |
| multi-Squad **válido** (>1, 1 principal, ≥1 ativo) | `usuariosInternos.multiSquadValido` |

`pronto` (usado pelo log de boot de P2.2 e como gate manual da ativação) agora
exige **também** `emSquadInativo === 0` e `apenasEmSquadInativo === 0`:

```
pronto = semSquad==0 && emSquadInativo==0
      && semMembership==0 && apenasEmSquadInativo==0
      && semPrincipal==0 && principalDuplicado==0
```

Chaves legadas (`semSquad`, `comSquad`, `semMembership`,
`comMultiplasMemberships`, `comPrincipalDuplicado`, `pronto`, `listaSemSquad`)
foram preservadas.

---

## 3. Formato do plano (`SQUADS_MIGRATION_TEMPLATE.json`)

JSON (convenção do projeto). Chaves naturais — nunca ids internos frágeis:

```jsonc
{
  "versao": 1,
  "descricao": "texto livre",

  "squads": [
    { "slug": "alpha", "nome": "Squad Alpha", "ativo": true }
  ],

  "membros": [
    { "squad": "alpha", "usuario": "fulano@vf.com", "funcao": "coordenador", "principal": true }
  ],

  "clientes": [
    { "cliente": "cliente-acme", "squad": "alpha", "motivo": "migração inicial" }
  ],

  "responsaveis": [
    { "cliente": "cliente-acme", "usuario": "fulano@vf.com", "papel": "gestor" }
  ]
}
```

| Campo | Regras |
|---|---|
| `squads[].slug` | minúsculo, sem espaço (normalizado). `nome` obrigatório. `ativo` opcional (default `true`). |
| `membros[].squad` | slug (do plano **ou** já existente no banco) |
| `membros[].usuario` | email **ou** id numérico |
| `membros[].funcao` | `membro` (default) \| `coordenador` |
| `membros[].principal` | `true` = Squad principal (no máx. 1/usuário; nenhum marcado → a 1ª membership é auto-promovida) |
| `clientes[].cliente` | slug **ou** id numérico |
| `clientes[].squad` | slug |
| `clientes[].motivo` | opcional — vai para `cliente_squad_history` |
| `responsaveis[]` | **opcional**. `papel`: `gestor`\|`auxiliar`\|`designer`. **Não é autorização.** |

Chaves começadas por `_` (ex.: `_doc_squads`) são ignoradas — usadas só para
documentar o template.

---

## 4. Uso da ferramenta

```bash
# 1. auditoria atual (antes de montar o plano)
DATABASE_URL=... node server/sql/squads-migrate.js --audit

# 2. DRY-RUN — valida contra o banco, NÃO escreve (padrão, sem --apply)
DATABASE_URL=... node server/sql/squads-migrate.js --plan plano-real.json

# 3. aplicar — transacional, idempotente. Só com --apply.
DATABASE_URL=... node server/sql/squads-migrate.js --plan plano-real.json --apply --actor <userIdAdmin>

# saída JSON crua (para pipeline / anexar ao runbook da P2.9)
DATABASE_URL=... node server/sql/squads-migrate.js --plan plano-real.json --json
```

**Exit codes:** `0` dry-run válido ou aplicado com sucesso · `2` plano inválido
(nada escrito) · `3` erro de execução (ROLLBACK total) · `1` erro de ambiente.

Também disponível como serviço (`squadsMigracaoImportService.importar`) caso se
queira um endpoint admin no futuro — **não** foi criado endpoint nesta fase.

---

## 5. Validação (dry-run) — o que é checado sem escrever

| Verificação | Resultado |
|---|---|
| `squads`/`membros`/`clientes`/`responsaveis` não é lista | **erro** |
| squad slug vazio / nome vazio / slug inválido após normalização | **erro** |
| slug de squad **duplicado no plano** | **erro** |
| `ativo` não-boolean | **erro** |
| membro/cliente referencia squad **inexistente** (nem plano nem banco) | **erro** |
| `usuario` **não encontrado** em `users` | **erro** |
| `funcao` fora de `membro`\|`coordenador` | **erro** |
| `principal` não-boolean | **erro** |
| membership para **squad inativo** | **erro** (não concede carteira) |
| **membership duplicada no plano** (mesmo squad+usuário) | **erro** |
| usuário marcado **principal em >1 squad** no plano | **erro** |
| `cliente` **não encontrado** em `clientes` | **erro** |
| mesmo cliente em **2 squads diferentes no plano** | **erro** |
| atribuir cliente a **squad inativo** | **erro** |
| `papel` de responsável fora de `gestor`\|`auxiliar`\|`designer` | **erro** |
| slug normalizado ≠ informado | aviso |
| usuário com role não-interna (seller/…) recebendo membership | aviso |
| usuário/cliente inativo | aviso |
| usuário ficará **sem principal** (auto-promoção da 1ª membership) | aviso |
| cliente já em outro squad → **transferência** (histórico preservado) | aviso |
| linha redundante (mesmo cliente+squad, ou responsável repetido) | aviso |

Com **qualquer erro**, `--apply` recusa e nada é escrito.

---

## 6. Execução — transacional e idempotente

- **Uma única transação** (`BEGIN … COMMIT`). Falha em qualquer passo →
  `ROLLBACK` total. Nunca metade da carteira migrada silenciosamente.
- **Idempotente** — rodar o mesmo plano de novo:

| Entidade | Mecanismo |
|---|---|
| squad | `INSERT … ON CONFLICT (slug) DO UPDATE nome/ativo` |
| membership | `INSERT … ON CONFLICT (squad_id,user_id) DO UPDATE ativo=true, funcao, is_primary` |
| cliente→squad (mesmo squad) | **no-op** (não gera nova linha de histórico) |
| cliente→squad (squad diferente) | transferência: fecha a linha aberta (`fim_em=NOW()`) + abre a nova |
| responsável | `INSERT … ON CONFLICT (cliente_id,user_id,papel) DO UPDATE ativo=true` |

- Regra do principal idêntica a `squadService`: 1ª membership ativa de um
  usuário vira principal automaticamente; `principal:true` força a troca.

---

## 7. Relatório (antes / planejado / depois)

`squads-migrate.js` imprime:

```
ANTES:      totais (squads/memberships/vínculos) + auditoria (sem squad, em squad
            inativo, sem membership, sem principal, pronto)
PLANEJADO:  squads criar/atualizar/inalterado · membros criar/reativar/atualizar/inalterado
            · clientes atribuir/transferir/inalterado · responsáveis upsert
AVISOS:     lista
ERROS:      lista (se houver → nada escrito)
APLICADO:   resumo dos writes (só com --apply)
DEPOIS:     auditoria pós-migração + auditoria.pronto
```

`--json` devolve o objeto completo (`{ antes, planejado, avisos, erros, aplicado,
resumo, depois }`) para anexar ao registro da P2.9.

---

## 8. Fluxo recomendado na P2.9 (rollout real)

```text
1. enforcement OFF (P2.2 — SQUADS_ENFORCEMENT ausente)
2. squads-migrate.js --audit                → fotografia inicial
3. operação preenche SQUADS_MIGRATION_TEMPLATE.json com o mapeamento real
4. squads-migrate.js --plan real.json       → DRY-RUN: 0 erros, revisar avisos
5. squads-migrate.js --plan real.json --apply --actor <admin>   → transacional
6. squads-migrate.js --audit                → auditoria.pronto == true?
      └─ se não: ajustar plano / dados, repetir 4–6 (idempotente)
7. só então: SQUADS_ENFORCEMENT=on + restart  (runbook de P2.2)
8. smoke com enforcement (Alpha→Alpha 200, Alpha→Beta 403, admin, seller)
```

Rollback de dados **não é necessário** para desligar: o enforcement volta a OFF
pelo flag (P2.2), sem tocar as tabelas migradas.

---

## 9. Testes P2.3

`server/tests/squadsMigracaoImport.test.js` — **39 verificações**:

| Grupo | Cobre |
|---|---|
| dry-run | `ok=true`, `aplicado=false`, **nada escrito**, `planejado` correto, relatório com `antes.auditoria` |
| matriz de validação | slug duplicado · squad inexistente · usuário inexistente · membership em squad inativo · principal duplicado · membership duplicada · cliente inexistente · cliente em 2 squads · atribuir a squad inativo |
| sem principal | vira **aviso** (não erro) + nota de auto-promoção |
| transferência | cliente já em outro squad → `planejado.clientes.transferir` + aviso, sem erro |
| apply | escreve squad/memberships/vínculos/responsável; 1ª membership auto-promovida a principal; `depois.auditoria` presente |
| idempotência | 2ª execução do mesmo plano: 0 novas linhas de squad/membership/histórico/responsável |
| transacional | erro no 2º vínculo → `ROLLBACK` total: squad, membership e vínculos **não** persistem; `erroExecucao` reportado |

`squadsMiddlewareEAuditoria.test.js` atualizado (+5 verificações) para as novas
categorias da auditoria.

### Regressão

```
cd server
TEST_SKIP="basesTiktok.test.js,designStudioWorkspace.test.js,designTemplateEngine.test.js,mlTokenService.test.js" \
  node tests/run-all.js
→ ✓ 144 arquivos de teste concluídos   (142 baseline + squadsRolloutSafety + squadsMigracaoImport)
```

4 falhas preexistentes inalteradas (baseline).

---

## 10. Respostas finais

**DRY-RUN FUNCIONA?** **SIM.** Padrão da CLI (sem `--apply`). Valida schema +
banco, produz relatório antes/planejado, não abre transação de escrita.

**IMPORT É TRANSACIONAL?** **SIM.** Todo o plano roda em um `BEGIN … COMMIT`
único; qualquer erro → `ROLLBACK` total. Sem meia-migração.

**É IDEMPOTENTE?** **SIM.** `ON CONFLICT DO UPDATE` em squads/memberships/
responsáveis; cliente no mesmo squad = no-op (não cria linha de histórico).

**DETECTA CLIENTE EM SQUAD INATIVO?** **SIM.** Auditoria: `emSquadInativo` +
`listaEmSquadInativo`; validação: recusa atribuir/transferir cliente para squad
inativo.

**DETECTA USUÁRIO SEM PRINCIPAL?** **SIM.** Auditoria: `semPrincipal`;
validação: aviso + auto-promoção da 1ª membership na execução. Também detecta
`apenasEmSquadInativo` e principal duplicado.

**PRONTO PARA RECEBER O MAPEAMENTO REAL?** **SIM.** Template, validação,
dry-run, execução transacional idempotente e relatório prontos. Falta apenas a
operação preencher `SQUADS_MIGRATION_TEMPLATE.json` — o que é decisão humana da
P2.9, não deste agente.
