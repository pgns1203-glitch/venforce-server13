// server/tests/centralVendasSyncRunsUniqueIndexSchema.test.js
//
// Teste de CONTRATO do schema (não de comportamento em runtime — não há
// Postgres real disponível neste ambiente de testes; ver limitações no
// docs/CENTRAL_VENDAS_V3_ARQUITETURA.md, seção Hardening M1/M2).
//
// BUG corrigido: um índice único padrão do Postgres trata NULL como
// distinto de NULL. O índice original
//   UNIQUE (cliente_id, cliente_conta_id, marketplace, date_from, date_to)
// NÃO protegia dois runs 'queued'/'running' com cliente_conta_id = NULL
// (cliente legado, sem cliente_contas cadastrada) para o mesmo
// cliente/marketplace/período — eles podiam coexistir mesmo com o índice
// "único" no ar, porque NULL <> NULL para fins de unicidade.
//
// A correção usa COALESCE(cliente_conta_id, 0) na expressão do índice —
// 0 é impossível como id real (BIGSERIAL começa em 1) — para que dois
// registros NULL colidam como "0 = 0" e o índice barre o segundo INSERT.
//
// Este teste prova, por inspeção do SQL versionado (não por execução):
//   1. o índice antigo (sem COALESCE) é removido (DROP INDEX IF EXISTS);
//   2. o índice novo usa COALESCE(cliente_conta_id, 0) na expressão;
//   3. existe uma limpeza prévia (idempotente) de possíveis duplicatas
//      antes de recriar o índice, para não quebrar ensureCentralVendasTables()
//      caso o bug já tenha deixado duplicatas reais no banco.
//
// A prova de que o índice antigo de fato permitia a colisão (semântica
// real do Postgres) exigiria um Postgres vivo — não reproduzível com os
// fakes em memória usados no resto da suíte, que já simulam NULL=NULL via
// `IS NOT DISTINCT FROM` (ver centralVendasSyncRuns.test.js). Documentado
// aqui como limitação conhecida, não escondida.

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const schemaPath = path.join(__dirname, "..", "sql", "central_vendas_schema.sql");

async function run() {
  const sql = fs.readFileSync(schemaPath, "utf8");

  // 1. Índice antigo (sem COALESCE) é explicitamente removido.
  assert.ok(
    /DROP INDEX IF EXISTS uq_central_vendas_sync_runs_ativo;/.test(sql),
    "schema deve remover o índice único antigo (sem COALESCE) antes de recriar"
  );
  console.log("  ✓ índice único antigo (sem proteção de NULL) é removido via DROP INDEX IF EXISTS");

  // 2. Índice novo usa COALESCE(cliente_conta_id, 0) — expressão exata.
  const marcador = "CREATE UNIQUE INDEX IF NOT EXISTS uq_central_vendas_sync_runs_ativo_v2";
  const inicio = sql.indexOf(marcador);
  assert.ok(inicio >= 0, "deve existir o índice novo uq_central_vendas_sync_runs_ativo_v2");
  const trecho = sql.slice(inicio, inicio + 400);
  assert.ok(trecho.includes("WHERE status IN ('queued', 'running');"), "índice novo deve manter o mesmo filtro parcial (queued/running)");
  const colunas = trecho.slice(trecho.indexOf("ON central_vendas_sync_runs ("), trecho.indexOf("WHERE status IN"));
  assert.ok(
    colunas.includes("COALESCE(cliente_conta_id, 0)"),
    `expressão do índice deve usar COALESCE(cliente_conta_id, 0) para tratar NULL como um grupo único, ` +
    `não "cliente_conta_id" cru (que reproduziria o bug); expressão encontrada: "${colunas}"`
  );
  assert.ok(
    colunas.includes("cliente_id") && colunas.includes("marketplace") && colunas.includes("date_from") && colunas.includes("date_to"),
    "índice deve continuar cobrindo cliente_id, marketplace, date_from, date_to além da conta"
  );
  console.log("  ✓ índice novo usa COALESCE(cliente_conta_id, 0) — NULL passa a colidir como um grupo único");

  // 3. Saneamento prévio idempotente (nunca DELETE — só transiciona status).
  assert.ok(
    /WITH duplicados_legado AS/.test(sql),
    "deve haver uma limpeza prévia de duplicatas antes de recriar o índice único"
  );
  assert.ok(
    /UPDATE central_vendas_sync_runs r[\s\S]*?SET status = 'failed'/.test(sql),
    "a limpeza deve transicionar duplicatas para failed, nunca apagar a linha (DELETE)"
  );
  assert.ok(!/DELETE FROM central_vendas_sync_runs/.test(sql), "schema não pode apagar runs arbitrariamente durante a migração");
  console.log("  ✓ duplicatas legadas (se existirem) são saneadas com UPDATE->failed, nunca DELETE");

  console.log("centralVendasSyncRunsUniqueIndexSchema.test.js passed");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
