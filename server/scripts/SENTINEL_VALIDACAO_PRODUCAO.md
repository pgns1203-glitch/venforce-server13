# Sentinel — validação em produção (critérios 2 e 3)

Roteiro manual. Nada aqui roda sozinho. Todos os comandos partem da raiz do
repositório (`venforce_scanner_x1/`), nunca de dentro de `server/` (há um
repositório git aninhado lá).

## O que isto toca em produção

- Cria 3 tabelas novas (`sentinel_pedidos`, `sentinel_checkpoints`,
  `sentinel_pedido_excecoes`) e, na V0-a (`20261027_sentinel_v0a.sql`), adiciona
  colunas às duas primeiras (`payload_hash`, `atraso_*`). Aditiva e idempotente;
  nenhuma tabela existente do Portal é alterada.
- Escreve **somente** em `sentinel_*`. A Central de Vendas (`central_vendas_*`)
  é só lida, na comparação do passo 4.
- Chama a API do ML (`/orders/search`, `/shipments/:id/costs`, `/orders/:id`)
  com o grant da conta, SEMPRE com `noRefresh` (o Sentinel nunca renova token,
  nem tenta outro grant): token expirado/401 ⇒ erro `SENTINEL_TOKEN_INDISPONIVEL`
  na conta, sem retry.
- O worker continua **desligado** e agora é um processo separado
  (`node server/workers/sentinelWorker.js`), fora do Express. Sem
  `SENTINEL_WORKER_ENABLED=true` **e** `SENTINEL_CONTAS_ALLOWLIST` preenchida
  (ex.: `41`), nada roda. (`SENTINEL_POLLING_ENABLED` não existe mais.)

## 0. Conexão

O script **não** lê `server/.env`. Defina a URL só neste shell:

```bash
export DATABASE_URL='<External Database URL do Render>'
node -e 'console.log(new URL(process.env.DATABASE_URL).hostname)'   # confira o host
export PGHOST_CONFIRM=$(node -e 'console.log(new URL(process.env.DATABASE_URL).hostname)')
```

## 1. Migration 2x (critério 1 em produção)

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f server/sql/migrations/20261023_sentinel_pedidos.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f server/sql/migrations/20261027_sentinel_v0a.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f server/sql/migrations/20261023_sentinel_pedidos.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f server/sql/migrations/20261027_sentinel_v0a.sql
psql "$DATABASE_URL" -c '\dt sentinel_*'
```

Esperado: a 2ª execução só emite "já existe, ignorando".

**Esta é a etapa "migration" e exige aprovação explícita, separada da execução.**
O worker e o `run-once` NÃO aplicam migration: só verificam o schema
(`verificarSentinelSchema`, somente leitura) e falham com
`SENTINEL_SCHEMA_AUSENTE` (lista do que falta) se ele não existir. Para aplicar
pelo próprio script, e só com essa aprovação: `--aplicar-schema`
(também aplica `20261027_sentinel_v0a.sql`, depois da 20261023).

### Conexões do processo worker (B6)

O processo `node server/workers/sentinelWorker.js` abre, no máximo:
**`SENTINEL_DB_POOL_MAX` (padrão 2)** do pool próprio (leituras) **+ 1** conexão
dedicada do advisory lock (que também executa TODAS as escritas do ciclo)
**+ até 10** do pool global do `pg` (`config/database.js`), usado só pelas leituras
de grant/token do `mlClient`/`mlTokenService` (arquivos protegidos; abertura
preguiçosa). Total: **até 13**, tipicamente 3–4. Considere isso no limite de
conexões do PostgreSQL do Render junto com o web service.

## 2. Escolher a conta

A conta precisa ter base de custo vinculada e pedidos de ontem já
sincronizados e publicados na Central:

```bash
psql "$DATABASE_URL" -c "
SELECT cc.id AS cliente_conta_id, c.slug, cc.nome, COUNT(p.*) AS pedidos_ontem
  FROM cliente_contas cc
  JOIN clientes c ON c.id = cc.cliente_id
  JOIN central_vendas_imports i ON i.cliente_conta_id = cc.id AND i.publication_status = 'published'
  JOIN central_vendas_pedidos p ON p.import_id = i.id
 WHERE cc.ativo AND cc.marketplace = 'meli'
   AND p.data_pedido = CURRENT_DATE - 1
 GROUP BY 1,2,3
 ORDER BY pedidos_ontem ASC
 LIMIT 10;"
export CONTA=<cliente_conta_id escolhido>
```

Para começar, prefira uma conta de baixo volume.

## 3. Critério 2: run-once 2x, mesma contagem, sem duplicatas, `updated_at` intacto

```bash
SINCE=$(date -u -d '36 hours ago' +%Y-%m-%dT%H:%M:%SZ)

# 1ª execução
node server/scripts/sentinel-run-once.js --conta=$CONTA --since=$SINCE --confirm-host=$PGHOST_CONFIRM

psql "$DATABASE_URL" -At -c "SELECT pedido_id, updated_at FROM sentinel_pedidos WHERE cliente_conta_id = $CONTA ORDER BY pedido_id" > ~/venforce-backups/sentinel_antes.txt
wc -l ~/venforce-backups/sentinel_antes.txt

# 2ª execução, mesmo SINCE
node server/scripts/sentinel-run-once.js --conta=$CONTA --since=$SINCE --confirm-host=$PGHOST_CONFIRM

psql "$DATABASE_URL" -At -c "SELECT pedido_id, updated_at FROM sentinel_pedidos WHERE cliente_conta_id = $CONTA ORDER BY pedido_id" > ~/venforce-backups/sentinel_depois.txt
wc -l ~/venforce-backups/sentinel_depois.txt

# duplicatas (esperado: 0)
psql "$DATABASE_URL" -c "SELECT COUNT(*) AS duplicatas FROM (SELECT pedido_id FROM sentinel_pedidos WHERE cliente_conta_id = $CONTA GROUP BY pedido_id HAVING COUNT(*) > 1) d;"

# updated_at: as linhas que mudaram precisam ser só provisórias reprocessadas ou pedidos que o ML atualizou entre as execuções
diff ~/venforce-backups/sentinel_antes.txt ~/venforce-backups/sentinel_depois.txt && echo "updated_at inalterado em todos"
```

Se o `diff` mostrar linhas, confira se cada uma era `provisoria` antes, ou se
o `ml_date_last_updated` mudou. Nos dois casos a atualização é esperada.

```bash
psql "$DATABASE_URL" -c "SELECT pedido_id, estado_margem, ml_date_last_updated, updated_at, pendencias FROM sentinel_pedidos WHERE cliente_conta_id = $CONTA AND pedido_id IN (<ids do diff>);"
```

## 4. Critério 3: margem do Sentinel × Central, lado a lado

São 5 pedidos `confirmada` (custo não ambíguo, frete real) que existem num
import publicado da Central para a mesma conta:

```bash
psql "$DATABASE_URL" -c "
WITH central AS (
  SELECT DISTINCT ON (p.pedido_id)
         p.pedido_id, p.id AS pedido_row_id, p.import_id, p.faturamento, p.lucro_contribuicao
    FROM central_vendas_pedidos p
    JOIN central_vendas_imports i ON i.id = p.import_id
   WHERE i.cliente_conta_id = $CONTA AND i.publication_status = 'published'
   ORDER BY p.pedido_id, i.published_at DESC NULLS LAST, i.id DESC
)
SELECT s.pedido_id,
       s.margem_valor          AS sentinel_margem,
       c.lucro_contribuicao    AS central_margem,
       s.margem_valor - c.lucro_contribuicao AS diferenca,
       s.faturamento AS s_fat, c.faturamento AS c_fat
  FROM sentinel_pedidos s
  JOIN central c ON c.pedido_id = s.pedido_id
 WHERE s.cliente_conta_id = $CONTA AND s.estado_margem = 'confirmada'
 ORDER BY s.data_pedido DESC
 LIMIT 5;"
```

Esperado: `diferenca = 0.00` nas 5 linhas.

### Se divergir: componente por componente

```bash
export PEDIDO=<pedido_id divergente>
psql "$DATABASE_URL" -c "
WITH central AS (
  SELECT p.id, p.import_id FROM central_vendas_pedidos p
    JOIN central_vendas_imports i ON i.id = p.import_id
   WHERE i.cliente_conta_id = $CONTA AND i.publication_status = 'published' AND p.pedido_id = '$PEDIDO'
   ORDER BY i.published_at DESC NULLS LAST, i.id DESC LIMIT 1
), comp AS (
  SELECT tipo, SUM(ABS(valor)) AS valor
    FROM central_vendas_componentes
   WHERE pedido_row_id = (SELECT id FROM central) AND item_id IS NOT NULL
   GROUP BY tipo
)
SELECT 'faturamento' AS componente, s.faturamento AS sentinel, (SELECT valor FROM comp WHERE tipo='receita_produto') AS central FROM sentinel_pedidos s WHERE s.cliente_conta_id=$CONTA AND s.pedido_id='$PEDIDO'
UNION ALL SELECT 'comissao', s.comissao, (SELECT valor FROM comp WHERE tipo='tarifa_venda')    FROM sentinel_pedidos s WHERE s.cliente_conta_id=$CONTA AND s.pedido_id='$PEDIDO'
UNION ALL SELECT 'frete',    s.frete,    (SELECT valor FROM comp WHERE tipo='frete_seller')    FROM sentinel_pedidos s WHERE s.cliente_conta_id=$CONTA AND s.pedido_id='$PEDIDO'
UNION ALL SELECT 'custo',    s.custo,    (SELECT valor FROM comp WHERE tipo='custo_produto')   FROM sentinel_pedidos s WHERE s.cliente_conta_id=$CONTA AND s.pedido_id='$PEDIDO'
UNION ALL SELECT 'imposto',  s.imposto,  (SELECT valor FROM comp WHERE tipo='imposto_interno') FROM sentinel_pedidos s WHERE s.cliente_conta_id=$CONTA AND s.pedido_id='$PEDIDO';"
psql "$DATABASE_URL" -c "SELECT itens FROM sentinel_pedidos WHERE cliente_conta_id=$CONTA AND pedido_id='$PEDIDO';"
```

Causas esperadas de divergência legítima:
- **Frete re-consultado.** O Sentinel consulta agora, a Central no momento do
  sync. `/shipments/:id/costs` pode ter mudado entre os dois.
- **Base alterada.** A base de custo foi alterada depois do sync da Central.
- **Variação.** O MLB tem variações com custos diferentes. A Central usa a
  primeira linha da base, o Sentinel usa a da variação, ou fica
  `custo_ambiguo`. Nesse caso o pedido nem deveria estar como `confirmada`
  com MLB repetido na base.

## 5. Resumo por estado

```bash
psql "$DATABASE_URL" -c "SELECT estado_margem, COUNT(*) FROM sentinel_pedidos WHERE cliente_conta_id = $CONTA GROUP BY 1 ORDER BY 1;"
psql "$DATABASE_URL" -c "SELECT * FROM sentinel_checkpoints WHERE cliente_conta_id = $CONTA;"
```

## Desfazer (se necessário)

As tabelas são isoladas, e nada fora delas depende do Sentinel:

```bash
psql "$DATABASE_URL" -c "DELETE FROM sentinel_pedidos WHERE cliente_conta_id = $CONTA; DELETE FROM sentinel_checkpoints WHERE cliente_conta_id = $CONTA;"
```
