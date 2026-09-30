#!/usr/bin/env node
// server/scripts/margemPrecificacaoSqlCheck.js
// Validação do SQL da trilha de precificação da Central de Margem contra um
// Postgres REAL em memória (PGlite). Prova o que o repositório fake da suíte
// não prova: índices únicos PARCIAIS (idempotência e 1 'aplicando' por
// item), claim com guarda de status/expiração, transições guardadas, recovery
// de 'aplicando' travado e o SQL das Oportunidades (ANY(text[])).
//
// SEGURANÇA: nunca lê DATABASE_URL e nunca abre conexão de rede.
//
// Uso (a partir de server/, sem alterar package.json):
//   npm install --no-save @electric-sql/pglite@0.3
//   node scripts/margemPrecificacaoSqlCheck.js

process.env.DATABASE_URL = "postgres://127.0.0.1:1/margem-precificacao-sql-check-nunca-conecta";

const assert = require("assert");

let PGlite;
try {
  ({ PGlite } = require("@electric-sql/pglite"));
} catch (_) {
  console.error("Instale antes (sem salvar no package.json): npm install --no-save @electric-sql/pglite@0.3");
  process.exit(2);
}

const repo = require("../services/motorMargem/precificacao/precificacaoRepository");
const { listarOportunidades } = require("../services/motorMargem/precificacao/precificacaoOportunidadesService");

async function criarDb() {
  const pg = new PGlite();
  const db = {
    async query(sql, params = []) {
      if (!params.length && /;\s*\S/.test(sql)) {
        const r = await pg.exec(sql);
        return { rows: r[r.length - 1]?.rows || [], rowCount: r[r.length - 1]?.affectedRows };
      }
      const r = await pg.query(sql, params);
      return { rows: r.rows, rowCount: r.affectedRows };
    },
  };
  return { pg, db };
}

function preview(extra = {}) {
  return {
    clienteId: 1, clienteSlug: "a", clienteContaId: 7, itemId: "MLB1", titulo: "T",
    userId: 9, userNome: "Pedro", userEmail: "p@x", tipoAcao: "PRICE",
    precoVisto: 110.48, precoAnterior: 110.48, precoSolicitado: 114.9,
    margemAntes: 0.14638, margemDepois: 0.170757, lucroAntes: 16.17, lucroDepois: 19.62,
    gates: [{ id: "conta", tom: "ok" }], calculo: { atual: { preco: 110.48 } }, ttlMinutes: 10,
    ...extra,
  };
}

const checks = [];
function check(nome, fn) { checks.push({ nome, fn }); }

check("schema idempotente (2x) e numeric volta como número", async ({ db }) => {
  await repo.ensureTables(db);
  await db.query(require("fs").readFileSync(require("path").join(__dirname, "..", "sql", "margem_precificacao_schema.sql"), "utf8"));
  const p = await repo.inserirPreview(preview(), db);
  assert.strictEqual(p.status, "preview");
  assert.strictEqual(p.precoSolicitado, 114.9);
  assert.strictEqual(p.margemDepois, 0.170757);
  assert.ok(new Date(p.expiraEm).getTime() > Date.now());
  assert.deepStrictEqual(p.gates, [{ id: "conta", tom: "ok" }]);
});

check("claim: preview→aplicando com chave; 2º claim do mesmo preview = null; chave duplicada = IDEMPOTENCY_KEY_EM_USO", async ({ db }) => {
  const p = await repo.inserirPreview(preview({ itemId: "MLB2" }), db);
  const c1 = await repo.reivindicar({ id: p.id, clienteContaId: 7, idempotencyKey: "k-0001-aaaa" }, db);
  assert.strictEqual(c1.status, "aplicando");
  assert.strictEqual(await repo.reivindicar({ id: p.id, clienteContaId: 7, idempotencyKey: "k-0002-bbbb" }, db), null);
  const outro = await repo.inserirPreview(preview({ itemId: "MLB3" }), db);
  await assert.rejects(
    () => repo.reivindicar({ id: outro.id, clienteContaId: 7, idempotencyKey: "k-0001-aaaa" }, db),
    (e) => e.code === "IDEMPOTENCY_KEY_EM_USO"
  );
  assert.strictEqual((await repo.obterPorIdempotencia("k-0001-aaaa", db)).id, p.id);
});

check("concorrência: 2º preview do MESMO item não entra em 'aplicando' enquanto o 1º está em voo", async ({ db }) => {
  const a = await repo.inserirPreview(preview({ itemId: "MLB4" }), db);
  const b = await repo.inserirPreview(preview({ itemId: "MLB4", precoSolicitado: 115.9 }), db);
  await repo.reivindicar({ id: a.id, clienteContaId: 7, idempotencyKey: "voo-a-0001" }, db);
  await assert.rejects(
    () => repo.reivindicar({ id: b.id, clienteContaId: 7, idempotencyKey: "voo-b-0002" }, db),
    (e) => e.code === "APLICACAO_EM_ANDAMENTO"
  );
  const fim = await repo.finalizar({ id: a.id, status: "aplicado", precoConfirmado: 114.9, margemDepois: 0.17, lucroDepois: 19.6, mlStatus: 200, respostaMl: { status: 200, metodo: "PUT" } }, db);
  assert.strictEqual(fim.status, "aplicado");
  assert.strictEqual(fim.snapshotStatus, "pendente");
  assert.ok(fim.aplicadoEm);
  // Liberado: agora o 2º pode entrar.
  const cb = await repo.reivindicar({ id: b.id, clienteContaId: 7, idempotencyKey: "voo-b-0002" }, db);
  assert.strictEqual(cb.status, "aplicando");
  // finalizar só sai de 'aplicando' (guarda de origem).
  assert.strictEqual(await repo.finalizar({ id: a.id, status: "falhou" }, db), null);
});

check("expiração: preview vencido não é reivindicado e recusarPreview marca recusado", async ({ db, pg }) => {
  const p = await repo.inserirPreview(preview({ itemId: "MLB5" }), db);
  await pg.query("UPDATE margem_precificacao_aplicacoes SET expira_em = NOW() - INTERVAL '1 minute' WHERE id = $1", [p.id]);
  assert.strictEqual(await repo.reivindicar({ id: p.id, clienteContaId: 7, idempotencyKey: "exp-0001-aa" }, db), null);
  const r = await repo.recusarPreview({ id: p.id, clienteContaId: 7, erroCodigo: "PREVIEW_EXPIRADO", erroMensagem: "expirou" }, db);
  assert.strictEqual(r.status, "recusado");
  assert.strictEqual(r.erroCodigo, "PREVIEW_EXPIRADO");
});

check("recovery: 'aplicando' travado vira falhou APLICACAO_INTERROMPIDA e libera o item", async ({ db, pg }) => {
  const p = await repo.inserirPreview(preview({ itemId: "MLB6" }), db);
  await repo.reivindicar({ id: p.id, clienteContaId: 7, idempotencyKey: "trav-0001-a" }, db);
  await pg.query("UPDATE margem_precificacao_aplicacoes SET aplicando_em = NOW() - INTERVAL '30 minutes' WHERE id = $1", [p.id]);
  const n = await repo.liberarAplicandoTravados({ clienteContaId: 7, itemId: "MLB6", staleMinutes: 10 }, db);
  assert.strictEqual(n, 1);
  const row = await repo.obterPorId({ id: p.id, clienteContaId: 7 }, db);
  assert.strictEqual(row.status, "falhou");
  assert.strictEqual(row.erroCodigo, "APLICACAO_INTERROMPIDA");
});

check("conta: obterPorId de outra conta = null; resposta do ML redigida sem token", async ({ db }) => {
  const p = await repo.inserirPreview(preview({ itemId: "MLB7" }), db);
  assert.strictEqual(await repo.obterPorId({ id: p.id, clienteContaId: 8 }, db), null);
  await repo.reivindicar({ id: p.id, clienteContaId: 7, idempotencyKey: "tok-0001-aa" }, db);
  const f = await repo.finalizar({
    id: p.id, status: "falhou", erroCodigo: "x", erroMensagem: "falhou com Bearer APP_USR-123-abc",
    respostaMl: { status: 400, codigo: "bad", motivo: "access_token=APP_USR-999 inválido" },
  }, db);
  assert.ok(!/APP_USR-/.test(JSON.stringify(f)), "nenhum token na linha");
  assert.ok(/REDACTED/.test(f.erroMensagem));
});

check("histórico: exclui previews, ordena do mais recente, filtra conta+item", async ({ db }) => {
  const hist = await repo.listarHistorico({ clienteContaId: 7, itemId: "MLB4" }, db);
  assert.ok(hist.length >= 2);
  assert.ok(hist.every((h) => h.status !== "preview" && h.itemId === "MLB4"));
  assert.ok(new Date(hist[0].criadoEm) >= new Date(hist[hist.length - 1].criadoEm));
  await repo.atualizarSnapshotStatus({ id: hist[hist.length - 1].id, status: "atualizado" }, db);
});

check("oportunidades: SQL real (diagnóstico da conta + ANY(text[]) no snapshot)", async ({ db, pg }) => {
  await pg.exec(`
    CREATE TABLE promocoes_diagnosticos (id BIGSERIAL PRIMARY KEY, cliente_id BIGINT, seller_id TEXT, status TEXT, parcial BOOLEAN DEFAULT false, itens_scaneados INT, created_at TIMESTAMPTZ DEFAULT NOW());
    CREATE TABLE promocoes_diagnostico_itens (id BIGSERIAL PRIMARY KEY, diagnostico_id BIGINT, item_id TEXT, titulo TEXT, campanha TEXT, campanha_id TEXT, tipo_promocao TEXT,
      preco_original NUMERIC, preco_promocao NUMERIC, desconto_total NUMERIC, seller_percentage NUMERIC, meli_percentage NUMERIC, retorno_ml NUMERIC, payload_raw JSONB DEFAULT '{}'::jsonb);
    CREATE TABLE margin_projection_snapshots (id BIGSERIAL PRIMARY KEY, cliente_conta_id BIGINT, marketplace TEXT, item_id TEXT, titulo TEXT, image_url TEXT,
      price NUMERIC(14,2), cost NUMERIC(14,2), tax_rate NUMERIC(10,4), fixed_fee NUMERIC(14,2), commission_rate NUMERIC(10,4), freight NUMERIC(14,2),
      margin NUMERIC(10,4), status TEXT, quality_json JSONB DEFAULT '{}'::jsonb, catalog_missing_since TIMESTAMPTZ);
    INSERT INTO promocoes_diagnosticos (cliente_id, seller_id, status, itens_scaneados) VALUES (1, '555', 'concluido', 10), (1, '999', 'concluido', 10);
    INSERT INTO promocoes_diagnostico_itens (diagnostico_id, item_id, campanha, campanha_id, tipo_promocao, preco_original, preco_promocao, retorno_ml, payload_raw)
      VALUES (1, 'MLB1', 'C1', 'P1', 'DEAL', 100, 90, 3, '{"status":"candidate"}'), (2, 'MLB2', 'C2', 'P2', 'DEAL', 100, 90, 3, '{"status":"candidate"}');
    INSERT INTO margin_projection_snapshots (cliente_conta_id, marketplace, item_id, titulo, price, cost, tax_rate, fixed_fee, commission_rate, freight, margin, status)
      VALUES (7, 'meli', 'MLB1', 'P1', 100, 40, 0.1, 0, 0.12, 15, 0.2, 'HEALTHY'), (7, 'meli', 'MLB2', 'P2', 100, 40, 0.1, 0, 0.12, 15, 0.2, 'HEALTHY');
  `);
  const r = await listarOportunidades(
    { clienteSlug: "a", clienteContaId: 7 },
    {
      db,
      resolverContaDoCliente: async () => ({ cliente: { id: 1, slug: "a" }, conta: { id: 7 } }),
      obterConta: async () => ({ id: 7, external_account_id: "555" }),
      carregarRealizada: async () => ({ porMlb: new Map() }),
    }
  );
  assert.strictEqual(r.disponivel, true);
  assert.deepStrictEqual(r.oportunidades.map((o) => o.itemId), ["MLB1"], "só o diagnóstico da conta 555");
  assert.strictEqual(r.oportunidades[0].retornoMl, 3);
});

async function main() {
  const ctx = await criarDb();
  let falhas = 0;
  for (const c of checks) {
    try {
      await c.fn(ctx);
      console.log(`  ✓ ${c.nome}`);
    } catch (err) {
      falhas += 1;
      console.error(`  ✗ ${c.nome}\n    ${err.stack || err.message}`);
    }
  }
  await ctx.pg.close();
  if (falhas) {
    console.error(`margemPrecificacaoSqlCheck: ${falhas} de ${checks.length} falharam`);
    process.exitCode = 1;
  } else {
    console.log(`margemPrecificacaoSqlCheck: ok (${checks.length} checagens, Postgres real em memória)`);
  }
}

main();
