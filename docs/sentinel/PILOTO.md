# Sentinel — Piloto (uma conta)

Pacote pronto para execução **com aprovação humana**. Nada aqui foi executado em produção.
Branch local: `feat/sentinel-v0b-integrado` (worktree `~/venforce-dev/wt-sentinel-v0b-int`).

## 1. Configuração (tudo OFF por padrão)

**Worker** — processo próprio `node server/workers/sentinelWorker.js` (Render Background Worker). O Express não o inicia.

| Variável | Piloto | Padrão sem a variável |
|---|---|---|
| `SENTINEL_WORKER_ENABLED` | `true` | OFF (loga e sai com código 0) |
| `SENTINEL_CONTAS_ALLOWLIST` | `<id da conta piloto>` | vazio ⇒ não processa nada |
| `DATABASE_URL` | o mesmo do Portal | obrigatório (o `.env` não é lido) |
| `SENTINEL_DB_POOL_MAX` | `2` | 2 |
| `SENTINEL_POLL_INTERVAL_MS` | `180000` (3 min) | 180000 |
| `SENTINEL_MAX_CHAMADAS_POR_CONTA` | `500` | 500 |
| `SENTINEL_CICLO_MAX_MS` | `300000` | 300000 |
| `SENTINEL_INCIDENTES_ENABLED` | ausente (= ligado se as tabelas existirem) | `0` desliga a avaliação |
| `SENTINEL_LEITURA_LIMITE_MIN` | `120` | 120 |

**Portal** (serviço web existente)

| Variável | Piloto | Efeito |
|---|---|---|
| `SENTINEL_VIGIA_LEITURA_ENABLED` | `1` | reavalia a leitura das contas monitoradas a cada 15 min, detectando o worker parado. Ausente = nada roda |
| `SQUADS_ENFORCEMENT` | não muda | o Sentinel usa o escopo do Painel de Contas em qualquer valor |

O token continua sendo renovado **só** pelo Portal; o Sentinel usa `noRefresh` em toda chamada.

## 2. Checklist de deploy (ordem)
1. Revisão humana do diff `97254a65..feat/sentinel-v0b-integrado` + PR + merge (fora desta missão).
2. Backup/PITR do Postgres confirmado no painel do Render.
3. Aplicar a migration `20261028_sentinel_incidentes.sql` (seção 3) com `lock_timeout` de 5 s e `statement_timeout` de 60 s, numa transação. Conferir: 2 tabelas, 3 índices, coluna `pedidos_ids`, 0 linhas.
4. Deploy do Portal com `SENTINEL_VIGIA_LEITURA_ENABLED` **ausente**. Validar `GET /sentinel/resumo` com admin e com um interno do Squad do cliente piloto.
5. Criar o worker com `SENTINEL_WORKER_ENABLED=false`, fazer o deploy e conferir no log a mensagem `OFF`.
6. Conferir o token da conta piloto: `token_status=valid` e `expires_at` mais de 1 h à frente.
7. Ligar `SENTINEL_WORKER_ENABLED=true` e `SENTINEL_CONTAS_ALLOWLIST=<id>`. Acompanhar o primeiro ciclo no log: `[sentinel] conta <id>: processados=… erro=-`.
8. Ligar `SENTINEL_VIGIA_LEITURA_ENABLED=1` no Portal.
9. Rodar a paridade com o último import publicado (`scripts/sentinel-e0-paridade.js`, somente leitura).

## 3. Migration de incidentes — revisão
- `20261028_sentinel_incidentes.sql` cria **somente** `sentinel_incidentes` e `sentinel_incidente_eventos`, com 3 índices e `ADD COLUMN IF NOT EXISTS pedidos_ids`. Não altera nenhuma tabela existente.
- É idempotente: `IF NOT EXISTS` em tudo e foi testada 2× seguidas. Não faz backfill.
- Locks: a FK `REFERENCES cliente_contas(id)` pega `SHARE ROW EXCLUSIVE` em `cliente_contas` por instantes; o `lock_timeout` de 5 s evita esperar atrás de transação longa.
- O worker não exige estas tabelas: sem elas, a coleta segue e só a avaliação de incidentes é pulada.
- O runner versionado é `ensureSentinelIncidentesSchema` (advisory lock `vf:schema:sentinel_incidentes`); a alternativa é `psql -f` dentro de `BEGIN … COMMIT`.

## 4. Observabilidade
- **Na tela:** `/sentinel.html`, aba "Saúde do monitoramento" (`GET /sentinel/saude`). Mostra:
  - estado do worker (ativo/atrasado/parado) e idade do checkpoint;
  - última coleta OK e erros de token e de API;
  - incidentes por severidade, cobertura e alertas internos.
- **No log do worker:** uma linha por conta e ciclo (`processados`, `quarentena`, `atraso_s`, `chamadas_ml`, `erro`). Alertas a observar:
  - `SENTINEL_SEM_PROGRESSO`;
  - `SENTINEL_TOKEN_INDISPONIVEL`;
  - `avaliação de incidentes falhou`.
- **SQL somente leitura** (sessão `BEGIN READ ONLY`):
  - `SELECT * FROM sentinel_checkpoints WHERE cliente_conta_id=<id>;`
  - `SELECT status, severidade, COUNT(*) FROM sentinel_incidentes GROUP BY 1,2;`
  - `SELECT COUNT(*) FROM sentinel_pedido_excecoes WHERE status <> 'resolvido';`
  - `SELECT pg_size_pretty(SUM(pg_total_relation_size(oid))) FROM pg_class WHERE relname LIKE 'sentinel_%' AND relkind='r';`
  - `SELECT COUNT(*) FROM pg_stat_activity WHERE application_name ILIKE '%sentinel%' OR query ILIKE '%sentinel_%';`

## 5. Critérios de interrupção (qualquer um ⇒ desligar o worker)
- Escrita fora das tabelas `sentinel_*`.
- Paridade com a Central ≠ R$ 0,00 nos pedidos congelados de um import publicado.
- Incidente duplicado (`GROUP BY cliente_conta_id, tipo, chave HAVING COUNT(*)>1`), ou evento `atualizado` a cada ciclo sem mudança real.
- `SENTINEL_TOKEN_INDISPONIVEL` por mais de 2 ciclos com o token válido no Portal.
- Erros 429 do ML em mais de 3 ciclos seguidos, ou `SENTINEL_SEM_PROGRESSO`.
- Conexões do Postgres acima da linha de base + 5, ou RSS do worker acima de 400 MB.
- Qualquer impacto perceptível no Portal ou na sincronização noturna.

## 6. Rollback
1. `SENTINEL_WORKER_ENABLED=false` (ou suspender o worker no Render): a conta corrente termina e nada mais roda.
2. Remover `SENTINEL_VIGIA_LEITURA_ENABLED` do Portal.
3. As rotas `/sentinel` são só leitura e ações sobre as próprias tabelas; podem ficar. Para escondê-las, basta reverter o commit de menu e tela.
4. **Os dados ficam** (`sentinel_*`). Remover tabelas exige aprovação própria; o único DDL reversível desta fase é `DROP TABLE sentinel_incidente_eventos, sentinel_incidentes` (a ordem importa por causa da FK).
5. Nada a desfazer na Central, nos tokens ou na sincronização noturna: o Sentinel não escreve neles.

## 7. Acompanhamento inicial
| Quando | O quê |
|---|---|
| Primeira hora | Cada ciclo sem erro; checkpoint avançando; atraso abaixo de 10 min; conexões estáveis. |
| 24 h | Fila coerente com a Central de Margem: os incidentes de margem negativa batem com os MLBs negativos da Central. Nenhum duplicado. A Saúde está `ativo`. |
| 72 h | Atravessar pelo menos uma renovação de token pelo Portal (ciclo de ~6 h) sem `SENTINEL_TOKEN_INDISPONIVEL` persistente. Rodar a paridade de novo. Decidir a 2ª conta. |
| 7 dias | Crescimento do armazenamento, eventos por incidente e incidentes reconhecidos ou resolvidos pela operação. |

## 8. Estimativa de infraestrutura
Medições locais (PG 18 local, ML falso, ver `scripts/sentinel-carga-local.cjs`):

| Cenário | Tempo | RSS pico | Conexões PG | Disco |
|---|---|---|---|---|
| 1 conta × 1.000 pedidos (1ª ingestão) | 1,8 s | 112 MB | 2 | — |
| 10 × 1.000 (10 mil pedidos) | 14,8 s + 3,6 s reprocessando | 173 MB | 2 | 576 B/pedido |
| 20 × 2.500 (50 mil pedidos) | 67 s + 19 s reprocessando | 285 MB | 3 | 552 B/pedido |

Medição real em produção (validação E0): cerca de **0,7 s por chamada** ao ML, incluindo o frete. **O ML domina o tempo; o banco não é gargalo.**

Regime contínuo por conta: cerca de 480 consultas de busca por dia (1 a cada 3 min), mais 1 chamada de frete por pedido novo ou alterado. Para o worker serial (0,7 s/chamada ≈ 120 mil chamadas/dia):
- Conta pequena (~10–20 pedidos/dia): menos de 600 chamadas/dia, uso desprezível.
- Ordem de grandeza: **~100–150 contas médias (≤ 300 pedidos/dia)** por worker, antes de paralelizar ou espaçar o intervalo.
- É estimativa, não garantia: rate limit do ML por app não medido, latência real variável.

| Recurso | Piloto | Escala |
|---|---|---|
| Worker (Render) | 512 MB, 0,5 CPU | — |
| Postgres | +2 a 3 conexões; ~0,5 GB por milhão de pedidos | — |
| Retenção de pedidos e eventos | não necessária no piloto | definir antes de escalar |
