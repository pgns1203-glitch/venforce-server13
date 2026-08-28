# VENFORCE V3 — BACKEND RELEASE CANDIDATE (P2.8)

> Documento canônico de prontidão de release do backend V3 (Squads + Autorização
> + Financeiro account/period-aware).
>
> **Estado do rollout: NÃO EXECUTADO.** `SQUADS_ENFORCEMENT` permanece **OFF**.
> Nenhuma migração foi aplicada em base real nesta fase. Nenhum dado de Squad
> foi populado. P2.9 continua **bloqueado por aprovação humana e dados reais** —
> por definição, não por falta de preparo.

---

## 1. IDENTIFICAÇÃO

| Item | Valor |
|---|---|
| Branch | `backend/v3-squads-auth` |
| HEAD | `2a41674` |
| Base integrada | `origin/main` = `1949c76` (Convergência #1) |
| Merge de integração | `3d15f68` — 0 conflitos |
| Tag de segurança | `safety/pessoa2-p24-3aca729` (P2.4 antes de qualquer operação) |
| Fases cobertas | P2.4 (preservada) · P2.5 · P2.6 · P2.7 · P2.8 |
| Enforcement em ambiente real | **OFF** |
| Migração de dados de Squad | **NÃO EXECUTADA** |

---

## 2. O QUE ESTE RELEASE MUDA

### 2.1 Correções de segurança (as mais importantes)

| # | Problema | Impacto real antes | Onde |
|---|---|---|---|
| S1 | **IDOR na base de custos** — `baseId` explícito resolvia por `SELECT ... FROM bases WHERE id=$1` sem nenhuma checagem de posse | Fechar o Cliente A com a base de custos do Cliente B, só trocando `costsBaseId` no request. Custo de outro cliente entrava no cálculo e no relatório | `services/bases/baseCustosService.js` |
| S2 | **Lista global de clientes** — `GET /fechamentos/financeiro/clientes` sem filtro de carteira | Qualquer papel de automações (`membro` incluso) via todos os clientes ativos da base, de todos os Squads e sellers | `services/fechamentoFinanceiro/clientesFinanceiroService.js` |
| S3 | **Entrega órfã sem autorização** — `if (clienteId != null)` pulava o check inteiro | Entrega com `cliente_id` NULL liberada para GET/PATCH/publicar/despublicar/DELETE. A FK é `ON DELETE SET NULL`, então **apagar um cliente produzia órfãs** | `controllers/entregasClienteController.js` |
| S4 | **Vazamento de contagem** — filtro de carteira rodava depois do `LIMIT/OFFSET`, e `total` era global | Contagem de entregas de outros Squads exposta; páginas curtas/vazias sem explicação | `services/entregasClienteService.js` |
| S5 | **`JWT_SECRET` com fallback embutido** em 5 arquivos | Quem lê o repositório forja um JWT `role:"admin"` e passa por toda a autorização, inclusive o bypass de admin. Subir em produção sem a env não dava erro nem aviso | `config/jwtSecret.js` (agora fonte única) |
| S6 | **Conciliação MP sem cinto de conta** — 4 tabelas têm `cliente_conta_id` indexado e nenhuma usava no WHERE | Isolamento entre duas contas MELI era 100% transitivo via `sync_run_id`; erro upstream = mistura de contas sem detecção | `centralVendasMp*Repository.js` |

### 2.2 Correções de correção (competência / conta)

| # | Problema | Impacto real antes |
|---|---|---|
| C1 | `String(e.periodo).includes(competencia)` | Entrega `"2026-07 a 2026-08"` respondia por Julho **e** por Agosto — "Julho lido como Agosto" |
| C2 | `parseCompetencia(x) \|\| competenciaAtual()` na Visão | `?periodo=lixo` respondia o **mês atual** em silêncio |
| C3 | Escrita e leitura em formatos diferentes | **Nenhum** caminho de código gravava `YYYY-MM`; o Portal grava `"Maio 2026"`. Resultado: praticamente todo relatório real aparecia **sem período** |
| C4 | Fechamento duplicado escolhido em silêncio | Sem `UNIQUE` e sem `ON CONFLICT`, duplicatas existem e a resposta podia mudar entre dois requests idênticos |
| C5 | `listarEntregas` chamado 2× com argumentos idênticos | Fan-out desnecessário no mesmo `Promise.all` |

### 2.3 Capacidades novas (destravam F4.2 da Pessoa 1)

Todos os bloqueios de `VENFORCE_V3_F4_2_DEPENDENCIAS_P2_6.md` foram endereçados:

| Bloqueio | Situação |
|---|---|
| **D1** — entrega não guarda a operação | **RESOLVIDO** — `entregas_cliente.cliente_conta_id` (aditivo, NULLABLE, sem backfill), POST/PATCH validando posse (409 `CONTA_NAO_PERTENCE_AO_CLIENTE`), `GET ?cliente_conta_id=`, campo no payload |
| **D2** — `POST /fechamentos/financeiro` ignora período | **RESOLVIDO pela via (b)** — resposta declara `competencia { periodoDetectado, dataMin, dataMax, competencias[], multiplasCompetencias, divergente, motivo }`. Nada é rejeitado: zero breaking change no legado |
| **D3** — `/me/portfolio` sem `ultimaSincronizacao` | **RESOLVIDO** — `clientes[].ultimaSincronizacao` (zero query nova) e `contas[].ultimaSync` real (1 query batelada) |
| **D4** — entregas sem chave de unicidade | **RESOLVIDO na aplicação** — 409 `ENTREGA_JA_EXISTE` com o `id` existente; `substituir: true` atualiza preservando `token_publico`. Índice único **shipado mas não auto-aplicado** (exige saneamento humano) |
| **D5** — expor exclusão de entrega | **NÃO FEITO, corretamente** — é decisão de produto, não dívida técnica |

---

## 3. CONTRATOS ALTERADOS (para a Convergência #2)

Todas as mudanças abaixo são **aditivas**. Nenhum campo foi removido ou renomeado.

### `GET /financeiro/:cliente?conta=&periodo=YYYY-MM`
```diff
  contexto: {
    clienteId, clienteSlug, clienteContaId, marketplace, periodo,
+   periodoInferido: false          // sempre false aqui (período é obrigatório)
  }
  resultado: {
    disponivel, dados, motivo,
-   escopoConta: false              // era fixo
+   escopoConta: <bool>             // true quando a entrega registra ESTA operação
+   origemClientLevel: { motivo, clienteContaId } | ausente
+   ambiguidade: { total, escolhidoId, ids[], motivo } | ausente
  }
  relatorios.dados[]: {
-   periodo                         // cru: null / ISO / "Maio 2026" / texto livre
+   periodo                         // sempre YYYY-MM ou null (honesto)
+   periodoBruto                    // valor original, para diagnóstico
+   clienteContaId                  // null = sem operação registrada, nunca "conta 0"
+   id
  }
```
**Novos erros:** `400 PERIODO_OBRIGATORIO`, `400 PERIODO_INVALIDO`.

### `GET /operacao/visao/:cliente?conta=&periodo=`
```diff
  contexto: { ..., competencia,
+   periodoInferido: <bool>         // true quando o período foi omitido
  }
```
**Novo erro:** `400 PERIODO_INVALIDO` (antes caía no mês atual em silêncio).
**Compatibilidade:** período **ausente** continua caindo no mês corrente — o
frontend já mergeado sempre envia período válido (`utils/periodoUrl.js`).

### `POST/PATCH /entregas-cliente`
```diff
+ cliente_conta_id            // opcional; validado contra o cliente resolvido
+ substituir: true            // opcional; atualiza em vez de duplicar
```
**Novos erros:** `409 CONTA_NAO_PERTENCE_AO_CLIENTE`, `409 ENTREGA_JA_EXISTE`
(com `entregaId` e `publicado` no corpo), `403 ENTREGA_SEM_CLIENTE`.

### `GET /entregas-cliente`
```diff
+ ?cliente_conta_id=          // filtro por operação
+ ?incluir_sem_conta=false    // default true (entregas legadas continuam visíveis)
+ entregas[].cliente_conta_id
  total                       // agora respeita a carteira (era o total global)
```

### `POST /fechamentos/financeiro`
```diff
+ periodo=YYYY-MM (opcional, no body)
+ resposta.competencia = { periodoSolicitado, periodoDetectado, dataMin, dataMax,
+                          competencias[], multiplasCompetencias, linhasComData,
+                          linhasTotal, divergente, motivo }
```
Nada é rejeitado por divergência — o endpoint **declara**, o frontend decide.

### `GET /me/portfolio`
```diff
  clientes[]: {
+   ultimaSincronizacao         // null = sem dado, nunca "nunca sincronizou"
    pendencias[]: {
      tipo,
+     rotulo, destino           // mapa estático do tipo; null se desconhecido
    }
    contas[]: {
-     ultimaSync: null          // era literal
+     ultimaSync                // data real do último sync `completed`
    }
  }
```

### `GET /fechamentos/financeiro/clientes`
Shape idêntico (`id, nome, slug, ativo`). **Semântica mudou**: agora é a
carteira do usuário, não a base inteira. Com `SQUADS_ENFORCEMENT=OFF` o
resultado para papel interno é **idêntico ao de hoje**.

---

## 4. MIGRAÇÕES

| Arquivo | Aplicada no boot? | Natureza | Risco |
|---|---|---|---|
| `20260827_squads_foundation.sql` | **Sim** (`ensureSquadsTables`) | Aditiva, idempotente | Baixo |
| `20260828_cliente_responsaveis_p24.sql` | **Sim** | `ADD COLUMN IF NOT EXISTS` | Baixo |
| `20260828_entregas_cliente_conta_p26.sql` | **Não** (coluna garantida no bootstrap) | Aditiva: coluna NULLABLE + FK guardada + índices | Baixo |
| `20260828_entregas_cliente_unicidade_p26.sql` | **NÃO — e não deve ser** | Índice único parcial | **Falha se houver duplicatas.** Exige auditoria + saneamento humano primeiro |

**Nenhuma migração apaga dado, altera tipo de coluna existente, ou faz backfill.**
Entregas antigas ficam com `cliente_conta_id = NULL`, que é a verdade sobre
elas — atribuir uma conta a posteriori seria inventar mapeamento.

### Auditoria obrigatória antes do índice único (D4)

```sql
SELECT cliente_id, cliente_conta_id, periodo, COUNT(*) AS total,
       ARRAY_AGG(id ORDER BY created_at DESC) AS ids,
       COUNT(*) FILTER (WHERE publicado) AS publicadas
  FROM entregas_cliente
 WHERE tipo = 'fechamento_mensal' AND periodo IS NOT NULL
 GROUP BY cliente_id, cliente_conta_id, periodo
HAVING COUNT(*) > 1
 ORDER BY total DESC;
```
Vazio → seguro aplicar. Com linhas → **não aplique**: uma duplicata com 2+
`publicadas` significa dois links públicos do mesmo mês circulando, e escolher
qual sobrevive é escolher qual número o cliente já viu.

---

## 5. VARIÁVEIS DE AMBIENTE

| Var | Obrigatória | Padrão | Observação |
|---|---|---|---|
| `SQUADS_ENFORCEMENT` | Não | **OFF** | Fail-safe. Só um token explícito (`on/true/1/yes/enabled/enforce`) liga. Valor inválido → OFF + warn |
| `JWT_SECRET` | **SIM em produção** | — | **Novo comportamento:** com `NODE_ENV=production` o servidor **recusa** subir sem ela, com o valor de dev, ou com menos de 32 caracteres |
| `NODE_ENV` | Recomendada | vazio = dev | É o que ativa a regra acima |
| `DATABASE_URL` | Sim | — | Inalterada |

> **Atenção de deploy:** se produção hoje roda sem `JWT_SECRET` definida, ela
> está usando o segredo público do código. Definir a variável **invalida todas
> as sessões existentes** (todo mundo refaz login) — o que é o resultado
> desejado, mas precisa ser combinado com o time, não descoberto em produção.

---

## 6. TESTES

```text
Baseline no início da sessão : 149 arquivos · 145 verdes · 4 vermelhas
Estado atual                 : 161 arquivos · 157 verdes · 4 vermelhas
Regressões novas             : 0
```

As 4 vermelhas são **as mesmas de antes**, todas fora do escopo Squads/Financeiro:
`basesTiktok`, `designStudioWorkspace`, `designTemplateEngine`, `mlTokenService`.

> `npm test` (`tests/run-all.js`) **para no primeiro erro**. Para o relatório
> completo use um runner que não aborta, ou `TEST_SKIP` com as 4 conhecidas.

### Arquivos de teste novos nesta fase

| Arquivo | Verificações | Cobre |
|---|---|---|
| `competenciaCanonica.test.js` | 50 | BLOCO C/G — normalização, formatos legados, estrito vs. tolerante |
| `competenciaDetectada.test.js` | 41 | D2 — detecção de competência nos dados enviados |
| `financeiroPeriodoContrato.test.js` | 35 | C/E/G/S — Julho≠Agosto, duplicata, histórico normalizado |
| `entregasClienteContaOperacao.test.js` | 35 | D1/D4 — operação na entrega, isolamento, 409s |
| `visaoPeriodoContrato.test.js` | 20 | P2.5 — período inválido, substring, escopo honesto |
| `squadsMigracaoAuditoriaY.test.js` | 19 | BLOCO Y — vínculo duplicado, responsável fora do Squad |
| `mePortfolioReadiness.test.js` | 18 | BLOCO P/D3 — sync real, pendência enriquecida, sem N+1 |
| `jwtSecretSeguranca.test.js` | 15 | BLOCO Q — fail-fast em produção |
| `responsabilidadeNaoAutoriza.test.js` | 14 | BLOCO M — responsabilidade ≠ acesso |
| `conciliacaoMpIsolamentoConta.test.js` | 13 | BLOCO H — isolamento MP por conta |
| `baseCustosPosseIdor.test.js` | 9 | BLOCO L — IDOR da base de custos (RED→GREEN) |
| `fechamentoClientesCarteira.test.js` | 8 | BLOCO L — lista de clientes por carteira (RED→GREEN) |

---

## 7. RUNBOOK DE DEPLOY SEGURO (BLOCO W)

**Nunca ligue o enforcement no mesmo passo do deploy de código.**

```text
1. MERGE
   └─ Convergência #2: backend/v3-squads-auth + frontend/v3-marathon-pessoa1

2. PRÉ-DEPLOY (antes de subir)
   ├─ definir JWT_SECRET em produção (>= 32 chars aleatórios)   ← BLOQUEANTE
   │    node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ├─ confirmar SQUADS_ENFORCEMENT ausente ou = off
   └─ avisar o time: definir JWT_SECRET derruba as sessões atuais

3. DEPLOY DO CÓDIGO
   └─ o boot aplica só migrations ADITIVAS e idempotentes

4. HEALTH CHECK
   ├─ o servidor subiu? (se JWT_SECRET faltar em produção, ele NÃO sobe — é o esperado)
   └─ GET /me/context responde 200 para um usuário interno

5. SMOKE (com enforcement OFF — comportamento tem que ser o de hoje)
   ├─ GET /me/portfolio           → carteira idêntica à de antes
   ├─ GET /fechamentos/financeiro/clientes → mesma lista de antes
   ├─ GET /financeiro/:cli?conta=&periodo=YYYY-MM → 200
   ├─ GET /financeiro/:cli?conta=&periodo=lixo    → 400 PERIODO_INVALIDO
   ├─ GET /operacao/visao/:cli?conta=&periodo=YYYY-MM → 200
   └─ POST /fechamentos/financeiro → resposta traz `competencia`

6. AUDITORIA (somente leitura, não altera nada)
   └─ auditoria() de squadsMigracaoService → `pronto`, `integridade`, `atencao`

7. ─────────── FRONTEIRA: tudo acima é reversível sem tocar em dado ───────────

8. MIGRAÇÃO DE DADOS DE SQUAD  ← HUMANA. Fora do escopo desta fase.
   ├─ dry-run do tooling P2.3
   ├─ conferência humana do mapeamento
   └─ import transacional

9. VALIDAÇÃO PÓS-MIGRAÇÃO (ainda com enforcement OFF)
   └─ auditoria() precisa voltar `pronto: true`

10. ATIVAÇÃO CONTROLADA (P2.9) ← exige aprovação humana explícita
```

**O enforcement nunca é ligado automaticamente, por nenhum script deste repo.**

---

## 8. RUNBOOK DE ROLLBACK (BLOCO X)

| Cenário | Ação | Perde dado? |
|---|---|---|
| Enforcement ligado cedo demais | `SQUADS_ENFORCEMENT=off` + restart | Não |
| Código com problema | Redeploy do commit anterior | Não — as migrations são aditivas e o código velho ignora as colunas novas |
| Migração de Squad parcial | Não reverter schema. Encerrar vínculos errados (`fim_em`) e reimportar | Não — o histórico é append |
| Cliente ficou sem Squad | Com enforcement OFF ele continua visível. Corrigir o vínculo antes de ligar | Não |
| Usuário sem membership | Enforcement OFF → vê tudo. **Nunca** dar membership "de emergência" sem decisão humana | Não |
| Squad inativo por engano | Reativar o Squad; a carteira volta sozinha | Não |
| Carteira vazia após ligar | `SQUADS_ENFORCEMENT=off` imediatamente; auditar; só religar com `pronto: true` | Não |
| `JWT_SECRET` novo derrubou sessões | Comportamento esperado. **Não** volte para o segredo antigo — ele é público | Não |

**Rollback de schema não é necessário em nenhum cenário.** Todas as colunas
novas são NULLABLE e ignoradas pelo código anterior. Se ainda assim for exigido:
`DROP INDEX` dos índices novos e `ALTER TABLE ... DROP COLUMN cliente_conta_id`
— mas isso **destrói** a operação registrada nas entregas criadas depois do
deploy, então só com aprovação explícita.

---

## 9. OBSERVABILIDADE (BLOCO T)

Pontos com log estruturado hoje:

- **enforcement** — `squadsEnforcement.js` avisa 1× quando o valor é inválido (e cai em OFF);
- **JWT** — aviso único quando roda com o segredo de desenvolvimento;
- **resolução de carteira** — queries marcadas `/* authz:NOME */`, rastreáveis no log de banco;
- **migração** — queries marcadas `/* squads:NOME */`;
- **portfolio** — aviso quando a fonte de sync por conta não existe;
- **entregas** — `console.error("[entregas-cliente]", msg)` só em 5xx.

**Nunca logado:** token, `access_token`/`refresh_token`, segredo, payload
financeiro completo. Há teste específico garantindo que `/me/context` e
`/me/portfolio` não devolvem token algum.

**Dívida honesta:** ainda não há contador/métrica de "quantos 403 de carteira
por dia", que seria o sinal mais útil durante o canário de P2.9. Registrado
como pré-requisito desejável, não bloqueante.

---

## 10. RISCOS CONHECIDOS

| Risco | Severidade | Contenção |
|---|---|---|
| Definir `JWT_SECRET` derruba todas as sessões | Média | Comunicar antes; é passo explícito do runbook |
| Índice único (D4) falha se houver duplicatas | Média | Não é auto-aplicado; consulta de auditoria no próprio arquivo |
| `GET /financeiro` lê só as 24 entregas mais recentes | Baixa | Competência antiga além da janela fica invisível. `entregas_cliente.periodo` é texto livre, então um filtro em SQL não é confiável hoje. Some sozinho conforme as escritas passam a gravar `YYYY-MM` |
| Vazamento cruzado MP com **0 contas ativas** | Média | **NÃO corrigido nesta fase** — ver §11 |
| Timezone no *sync* da Central de Vendas | Média | **NÃO corrigido** — ver §11 |
| `resultado.escopoConta` só vira `true` para entregas novas | Baixa | Correto por construção; declarado em `origemClientLevel` |

---

## 11. O QUE **NÃO** FOI FEITO (e por quê)

Itens reais encontrados na auditoria, deliberadamente fora do escopo desta fase:

1. **Vazamento cruzado MP quando o cliente tem 0 contas ativas.**
   `resolveMarketplaceAccountContext` não lança com 0 contas ativas; o
   `clienteContaId` fica nulo, `condicaoContaSql` devolve `null` e **nenhuma
   condição de conta entra na query** — imports/runs/payments de todas as contas
   voltam juntos. Alcançável quando as contas foram desativadas mas os imports
   continuam com `cliente_conta_id` preenchido.
   **Por que não corrigi:** fechar isso muda o comportamento de leitura da
   Central de Vendas (território compartilhado com a Pessoa 1) e a direção
   fail-closed pode esconder dado legítimo de clientes legados. Precisa de
   decisão de produto sobre o que um cliente sem conta ativa deve ver.
   *Mitigação parcial já entregue:* o cinto de conta na camada MP (S6) impede a
   mistura sempre que a conta É conhecida.

2. **Timezone no sync da Central de Vendas.** `dataPedido` grava
   `String(order.date_created).slice(0,10)` — o dia é literalmente os 10
   primeiros caracteres do que o ML devolveu, com o offset que vier; a janela
   pedida ao ML usa `-03:00` fixo; e `.toISOString()` sobre coluna `DATE` pode
   deslocar um dia. Um pedido de 01/08 00:30 `-03:00` pode virar 31/07.
   **Por que não corrigi:** é o caminho de escrita do sync, não de leitura.
   Mexer sem dado real para validar arrisca reclassificar competência de pedidos
   já importados. Precisa de janela de validação própria.

3. **`summary` da conciliação MP ignora o range.** `paymentsUnique`,
   `totalPaymentGross/Net`, `postMovementsCount` e afins contam o **sync run
   inteiro**, não o intervalo pedido. As linhas respeitam o range; os totais não.
   **Por que não corrigi:** mudar os números do resumo sem dado real de
   validação é exatamente o tipo de alteração que a missão manda não fazer às
   cegas num domínio financeiro.

4. **`resolverBaseTikTokPorId` sem checagem de posse.** Documentado no próprio
   código como decisão de produto ("seleção manual, sem cliente/vínculo").
   Diferente de S1, aqui a ausência é **deliberada e declarada** — mudá-la
   quebraria o fluxo TikTok e seus testes. Registrado para decisão de produto.

5. **`despublicarEntrega` não rotaciona `token_publico`.** Republicar reativa o
   **mesmo link antigo**: quem tinha a URL recupera acesso. É decisão de produto
   (link estável vs. revogação real), não bug óbvio.

6. **D5 — expor exclusão de entrega.** Decisão de produto, como a própria
   Pessoa 1 registrou.

---

## 12. DEPENDÊNCIAS DA PESSOA 1

**Resolvidas nesta fase:** D1, D2, D3, D4 (ver §2.3).

**Ainda abertas (nenhuma é backend):**
- **D5** — decisão de produto sobre exclusão de entrega.
- Consumir os campos novos: `resultado.escopoConta`, `origemClientLevel`,
  `ambiguidade`, `relatorios[].clienteContaId`, `contexto.periodoInferido`,
  `competencia.divergente` no fechamento, `ultimaSincronizacao`.
- Enviar `cliente_conta_id` ao salvar fechamento (D1 só tem valor quando o
  frontend manda a operação).
- Tratar `409 ENTREGA_JA_EXISTE` oferecendo "substituir".

---

## 13. GATE DE GO / NO-GO PARA P2.9

**NO-GO se qualquer item abaixo for falso.** Nenhum deles é verificável hoje —
todos dependem de dado real e decisão humana.

- [ ] Convergência #2 mergeada e validada
- [ ] `JWT_SECRET` definida em produção (≥ 32 chars)
- [ ] Código deployado com `SQUADS_ENFORCEMENT=OFF` e smoke §7.5 verde
- [ ] Mapeamento Cliente→Squad revisado **por pessoa**, não gerado
- [ ] Mapeamento Usuário→Squad revisado **por pessoa**
- [ ] Import executado via tooling P2.3 (dry-run → conferência → apply)
- [ ] `auditoria().pronto === true`
- [ ] `auditoria().integridade.clientesComVinculoDuplicado === 0`
- [ ] `auditoria().atencao` revisado (não precisa ser zero; precisa ser **conhecido**)
- [ ] Plano de canário definido (quais Squads primeiro)
- [ ] Alguém de plantão com autoridade para `SQUADS_ENFORCEMENT=off`

**Critério de abortar durante o canário:** qualquer usuário interno com carteira
vazia que deveria ter clientes → `off` imediato, auditar, não insistir.

---

## 14. PRONTO PARA CONVERGÊNCIA #2?

**Sim, do lado backend.**

- 0 regressões (mesmas 4 falhas pré-existentes de sempre)
- 0 arquivo de `Portal/**` ou `frontend-react/**` tocado
- Todas as mudanças de contrato são aditivas
- Enforcement OFF, migração não executada, rollout não iniciado

Bloqueadores reais restantes: **nenhum do lado backend.** O que resta é
integração com o frontend da Pessoa 1 e, depois, decisão humana sobre dados
reais de Squad — que é P2.9, e continua bloqueado por definição.
