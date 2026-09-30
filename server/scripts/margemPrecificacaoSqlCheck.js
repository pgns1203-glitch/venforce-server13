#!/usr/bin/env node
// server/scripts/margemPrecificacaoSqlCheck.js
// Validação do SQL da trilha de precificação da Central de Margem contra um
// Postgres REAL em memória (PGlite). Prova o que o repositório fake da suíte
// não prova: a migration versionada (aplicada 2x, com advisory lock), índices
// únicos PARCIAIS, o claim com token/lease e a regra "escrita enviada depois
// do preview", renovação de lease só pelo dono, reconciliação sem dupla
// escrita, desfecho só pelo token, evidência tardia, recálculo sobre o
// confirmado, a fila durável do refresh (propagação), e o índice das
// Oportunidades (EXPLAIN + tempo antes/depois).
//
// SEGURANÇA: nunca lê DATABASE_URL e nunca abre conexão de rede.
//
// Uso (a partir de server/, sem alterar package.json):
//   npm install --no-save @electric-sql/pglite@0.3
//   node scripts/margemPrecificacaoSqlCheck.js

process.env.DATABASE_URL = "postgres://127.0.0.1:1/margem-precificacao-sql-check-nunca-conecta";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

let PGlite;
try {
  ({ PGlite } = require("@electric-sql/pglite"));
} catch (_) {
  console.error("Instale antes (sem salvar no package.json): npm install --no-save @electric-sql/pglite@0.3");
  process.exit(2);
}

const repo = require("../services/motorMargem/precificacao/precificacaoRepository");
const schemaEnsure = require("../services/schema/schemaEnsure");
const { listarOportunidades } = require("../services/motorMargem/precificacao/precificacaoOportunidadesService");

async function criarDb() {
  const pg = new PGlite();
  const queries = [];
  const db = {
    async query(sql, params = []) {
      queries.push(sql);
      if (!params.length && /;\s*\S/.test(sql)) {
        const r = await pg.exec(sql);
        return { rows: r[r.length - 1]?.rows || [], rowCount: r[r.length - 1]?.affectedRows };
      }
      const r = await pg.query(sql, params);
      return { rows: r.rows, rowCount: r.affectedRows };
    },
  };
  return { pg, db, queries };
}

function preview(extra = {}) {
  return {
    clienteId: 1, clienteSlug: "a", clienteContaId: 7, itemId: "MLB1", titulo: "T",
    userId: 9, userNome: "Pedro", userEmail: "p@x", tipoAcao: "PRICE",
    precoVisto: 110.48, precoAnterior: 110.48, precoSolicitado: 114.9,
    margemAntes: 0.14638, margemDepois: 0.170757, lucroAntes: 16.17, lucroDepois: 19.62,
    gates: [{ id: "conta", tom: "ok" }], calculo: { atual: { preco: 110.48 } }, ttlMinutes: 10,
    previewFingerprint: "a".repeat(64), fingerprint: { v: 1, custo: "50.00" },
    ...extra,
  };
}

async function vencerLease(pg, id, segundos = 3600) {
  await pg.query(`UPDATE margem_precificacao_aplicacoes SET lease_expira_em = NOW() - ($2 * INTERVAL '1 second') WHERE id = $1`, [id, segundos]);
}

const checks = [];
function check(nome, fn) { checks.push({ nome, fn }); }

check("migration versionada: aplicada 2x (idempotente), dentro de BEGIN + advisory lock + COMMIT", async ({ db, queries }) => {
  await schemaEnsure.ensureMargemPrecificacaoSchema(db);
  const ini = queries.length;
  // Outra "instância" (outro objeto de conexão) roda de novo: no-op seguro.
  const outra = { query: (s, p) => db.query(s, p) };
  await schemaEnsure.ensureMargemPrecificacaoSchema(outra);
  const seq = queries.slice(ini).map((q) => q.trim().split(/\s+/).slice(0, 2).join(" "));
  assert.strictEqual(seq[0], "BEGIN");
  assert.ok(/^SELECT pg_advisory_xact_lock/.test(queries[ini + 1]), queries[ini + 1]);
  assert.strictEqual(queries[ini + 3], "COMMIT");
  const p = await repo.inserirPreview(preview(), db);
  assert.strictEqual(p.status, "preview");
  assert.strictEqual(p.precoSolicitado, 114.9);
  assert.strictEqual(p.previewFingerprint, "a".repeat(64));
  assert.deepStrictEqual(p.fingerprint, { v: 1, custo: "50.00" });
  assert.strictEqual(p.leaseValida, false);
});

check("CHECK de status aceita os estados novos e recusa lixo", async ({ db, pg }) => {
  const p = await repo.inserirPreview(preview({ itemId: "MLB-CK" }), db);
  for (const s of ["divergente", "resultado_desconhecido"]) {
    await pg.query("UPDATE margem_precificacao_aplicacoes SET status = $2 WHERE id = $1", [p.id, s]);
  }
  await assert.rejects(() => pg.query("UPDATE margem_precificacao_aplicacoes SET status = 'inventado' WHERE id = $1", [p.id]));
});

check("claim: token + lease; 2º claim do mesmo preview = null; chave duplicada = IDEMPOTENCY_KEY_EM_USO", async ({ db }) => {
  const p = await repo.inserirPreview(preview({ itemId: "MLB2" }), db);
  const c1 = await repo.reivindicar({ id: p.id, clienteContaId: 7, idempotencyKey: "k-0001-aaaa", claimToken: "tok-1", leaseSeconds: 120 }, db);
  assert.strictEqual(c1.status, "aplicando");
  assert.strictEqual(c1.claimToken, "tok-1");
  assert.strictEqual(c1.leaseValida, true);
  assert.strictEqual(await repo.reivindicar({ id: p.id, clienteContaId: 7, idempotencyKey: "k-0002-bbbb", claimToken: "tok-2", leaseSeconds: 120 }, db), null);
  const outro = await repo.inserirPreview(preview({ itemId: "MLB3" }), db);
  await assert.rejects(
    () => repo.reivindicar({ id: outro.id, clienteContaId: 7, idempotencyKey: "k-0001-aaaa", claimToken: "tok-3", leaseSeconds: 120 }, db),
    (e) => e.code === "IDEMPOTENCY_KEY_EM_USO"
  );
});

check("exclusão mútua por item + preview superado por escrita enviada depois dele", async ({ db }) => {
  const a = await repo.inserirPreview(preview({ itemId: "MLB4" }), db);
  const b = await repo.inserirPreview(preview({ itemId: "MLB4", precoSolicitado: 115.9 }), db);
  await repo.reivindicar({ id: a.id, clienteContaId: 7, idempotencyKey: "voo-a-0001", claimToken: "ta", leaseSeconds: 120 }, db);
  await assert.rejects(
    () => repo.reivindicar({ id: b.id, clienteContaId: 7, idempotencyKey: "voo-b-0002", claimToken: "tb", leaseSeconds: 120 }, db),
    (e) => e.code === "APLICACAO_EM_ANDAMENTO"
  );
  const env = await repo.renovarLease({ id: a.id, claimToken: "ta", leaseSeconds: 30, marcarEnvio: true }, db);
  assert.ok(env.escritaEnviadaEm, "ponto sem volta gravado na renovação");
  const fim = await repo.finalizar({ id: a.id, claimToken: "ta", status: "aplicado", precoConfirmado: 114.9, financeiro: { margemDepois: 0.17, lucroDepois: 19.6 }, mlStatus: 200, respostaMl: { status: 200, metodo: "PUT" }, snapshotDelaySeconds: 0 }, db);
  assert.strictEqual(fim.status, "aplicado");
  assert.strictEqual(fim.snapshotStatus, "pendente");
  assert.strictEqual(fim.margemDepois, 0.17);
  // B foi criado ANTES do envio de A: superado, mesmo com o item livre.
  await assert.rejects(
    () => repo.reivindicar({ id: b.id, clienteContaId: 7, idempotencyKey: "voo-b-0003", claimToken: "tb", leaseSeconds: 120 }, db),
    (e) => e.code === "PREVIEW_SUPERADO"
  );
  // Um preview criado DEPOIS da escrita pode entrar.
  const c = await repo.inserirPreview(preview({ itemId: "MLB4", precoVisto: 114.9, precoSolicitado: 116.9 }), db);
  const cc = await repo.reivindicar({ id: c.id, clienteContaId: 7, idempotencyKey: "voo-c-0004", claimToken: "tc", leaseSeconds: 120 }, db);
  assert.strictEqual(cc.status, "aplicando");
});

check("fencing: renovar/finalizar exigem o token; lease vencido não renova; o dono ainda registra o próprio desfecho", async ({ db, pg }) => {
  const p = await repo.inserirPreview(preview({ itemId: "MLB5" }), db);
  await repo.reivindicar({ id: p.id, clienteContaId: 7, idempotencyKey: "fen-0001-aa", claimToken: "dono", leaseSeconds: 120 }, db);
  assert.strictEqual(await repo.renovarLease({ id: p.id, claimToken: "intruso", leaseSeconds: 30 }, db), null);
  assert.strictEqual(await repo.finalizar({ id: p.id, claimToken: "intruso", status: "aplicado", precoConfirmado: 1 }, db), null);
  await vencerLease(pg, p.id, 1);
  assert.strictEqual(await repo.renovarLease({ id: p.id, claimToken: "dono", leaseSeconds: 30, marcarEnvio: true }, db), null, "lease vencido: não renova nem marca envio");
  const f = await repo.finalizar({ id: p.id, claimToken: "dono", status: "falhou", erroCodigo: "FENCING_PERDIDO", erroMensagem: "nada enviado" }, db);
  assert.strictEqual(f.status, "falhou");
  assert.strictEqual(f.escritaEnviadaEm, null);
});

check("reconciliação: só lease vencido + carência; sem envio → falhou; com envio → resultado_desconhecido; tardio vira evidência", async ({ db, pg }) => {
  const p1 = await repo.inserirPreview(preview({ itemId: "MLB6" }), db);
  await repo.reivindicar({ id: p1.id, clienteContaId: 7, idempotencyKey: "rec-0001-aa", claimToken: "t1", leaseSeconds: 120 }, db);
  assert.strictEqual((await repo.reconciliarLeasesVencidos({ clienteContaId: 7, itemId: "MLB6", graceSeconds: 30 }, db)).length, 0, "lease válido: intocado");
  await vencerLease(pg, p1.id, 10);
  assert.strictEqual((await repo.reconciliarLeasesVencidos({ clienteContaId: 7, itemId: "MLB6", graceSeconds: 30 }, db)).length, 0, "dentro da carência: intocado");
  await vencerLease(pg, p1.id, 31);
  const [r1] = await repo.reconciliarLeasesVencidos({ clienteContaId: 7, itemId: "MLB6", graceSeconds: 30 }, db);
  assert.strictEqual(r1.status, "falhou");
  assert.strictEqual(r1.erroCodigo, "APLICACAO_INTERROMPIDA_SEM_ESCRITA");

  const p2 = await repo.inserirPreview(preview({ itemId: "MLB6", precoSolicitado: 117.9 }), db);
  await repo.reivindicar({ id: p2.id, clienteContaId: 7, idempotencyKey: "rec-0002-bb", claimToken: "t2", leaseSeconds: 120 }, db);
  await repo.renovarLease({ id: p2.id, claimToken: "t2", leaseSeconds: 30, marcarEnvio: true }, db);
  await vencerLease(pg, p2.id, 60);
  const [r2] = await repo.reconciliarLeasesVencidos({ id: p2.id, graceSeconds: 30 }, db);
  assert.strictEqual(r2.status, "resultado_desconhecido");
  // O dono antigo volta: não finaliza; só anexa evidência.
  assert.strictEqual(await repo.finalizar({ id: p2.id, claimToken: "t2", status: "aplicado", precoConfirmado: 117.9 }, db), null);
  const t = await repo.registrarResultadoTardio({ id: p2.id, claimToken: "t2", resultado: { status: 200, preco: 117.9, resultadoLocal: "aplicado" } }, db);
  assert.strictEqual(t.status, "resultado_desconhecido");
  assert.strictEqual(t.resultadoTardio.preco, 117.9);
});

check("divergente: margem começa NULA (nunca a do solicitado) e é recalculada sobre o confirmado", async ({ db }) => {
  const p = await repo.inserirPreview(preview({ itemId: "MLB7" }), db);
  await repo.reivindicar({ id: p.id, clienteContaId: 7, idempotencyKey: "div-0001-aa", claimToken: "td", leaseSeconds: 120 }, db);
  const f = await repo.finalizar({ id: p.id, claimToken: "td", status: "divergente", precoConfirmado: 119.9, financeiro: { margemDepois: null, lucroDepois: null }, atencaoCodigo: "PRECO_CONFIRMADO_DIVERGENTE" }, db);
  assert.strictEqual(f.margemDepois, null);
  assert.strictEqual(f.lucroDepois, null);
  const g = await repo.atualizarFinanceiroConfirmado({ id: p.id, margemDepois: 0.2, lucroDepois: 24, atencaoCodigo: "PRECO_CONFIRMADO_DIVERGENTE", calculo: { precoConfirmado: 119.9 } }, db);
  assert.strictEqual(g.margemDepois, 0.2);
  assert.strictEqual(g.precoConfirmado, 119.9);
  assert.strictEqual(g.snapshotStatus, "pendente");
});

check("fila durável do refresh: claim exclusivo, aguardando_propagacao, atualizado, prazo → propagacao_pendente", async ({ db, pg }) => {
  const p = await repo.inserirPreview(preview({ itemId: "MLB8" }), db);
  await repo.reivindicar({ id: p.id, clienteContaId: 7, idempotencyKey: "ref-0001-aa", claimToken: "tr", leaseSeconds: 120 }, db);
  await repo.finalizar({ id: p.id, claimToken: "tr", status: "aplicado", precoConfirmado: 114.9, financeiro: { margemDepois: 0.17, lucroDepois: 19.6 }, snapshotDelaySeconds: 0, snapshotJanelaMinutos: 10 }, db);
  const [c1] = await repo.reivindicarRefresh({ id: p.id, lockSeconds: 60 }, db);
  assert.strictEqual(c1.snapshotTentativas, 1);
  assert.strictEqual((await repo.reivindicarRefresh({ id: p.id, lockSeconds: 60 }, db)).length, 0, "reivindicado: ninguém mais pega");
  const a = await repo.registrarRefresh({ id: p.id, status: "aguardando_propagacao", precoObservado: 110.48, proximaEmSeconds: 5 }, db);
  assert.strictEqual(a.snapshotStatus, "aguardando_propagacao");
  assert.strictEqual(a.snapshotPrecoObservado, 110.48);
  await pg.query("UPDATE margem_precificacao_aplicacoes SET snapshot_proxima_em = NOW() - INTERVAL '1 second' WHERE id = $1", [p.id]);
  assert.strictEqual((await repo.reivindicarRefresh({ id: p.id }, db)).length, 1);
  const ok = await repo.registrarRefresh({ id: p.id, status: "atualizado", precoObservado: 114.9 }, db);
  assert.strictEqual(ok.snapshotStatus, "atualizado");
  assert.ok(ok.snapshotAtualizadoEm);

  const q = await repo.inserirPreview(preview({ itemId: "MLB9" }), db);
  await repo.reivindicar({ id: q.id, clienteContaId: 7, idempotencyKey: "ref-0002-bb", claimToken: "tq", leaseSeconds: 120 }, db);
  await repo.finalizar({ id: q.id, claimToken: "tq", status: "aplicado", precoConfirmado: 114.9, financeiro: { margemDepois: 0.1, lucroDepois: 1 }, snapshotDelaySeconds: 0 }, db);
  await pg.query("UPDATE margem_precificacao_aplicacoes SET snapshot_prazo_em = NOW() - INTERVAL '1 second' WHERE id = $1", [q.id]);
  const pend = await repo.registrarRefresh({ id: q.id, status: "aguardando_propagacao", precoObservado: 110.48, proximaEmSeconds: 5 }, db);
  assert.strictEqual(pend.snapshotStatus, "propagacao_pendente");
});

check("conta: obterPorId de outra conta = null; resposta do ML redigida sem token", async ({ db }) => {
  const p = await repo.inserirPreview(preview({ itemId: "MLB10" }), db);
  assert.strictEqual(await repo.obterPorId({ id: p.id, clienteContaId: 8 }, db), null);
  await repo.reivindicar({ id: p.id, clienteContaId: 7, idempotencyKey: "tok-0001-aa", claimToken: "tt", leaseSeconds: 120 }, db);
  const f = await repo.finalizar({
    id: p.id, claimToken: "tt", status: "falhou", erroCodigo: "x", erroMensagem: "falhou com Bearer APP_USR-123-abc",
    respostaMl: { status: 400, codigo: "bad", motivo: "access_token=APP_USR-999 inválido" },
  }, db);
  const publico = JSON.stringify({ ...f, claimToken: undefined });
  assert.ok(!/APP_USR-/.test(publico), "nenhum token na linha");
  assert.ok(/REDACTED/.test(f.erroMensagem));
});

check("histórico: exclui previews, ordena do mais recente, filtra conta+item", async ({ db }) => {
  const hist = await repo.listarHistorico({ clienteContaId: 7, itemId: "MLB4" }, db);
  assert.ok(hist.length >= 2);
  assert.ok(hist.every((h) => h.status !== "preview" && h.itemId === "MLB4"));
  assert.ok(new Date(hist[0].criadoEm) >= new Date(hist[hist.length - 1].criadoEm));
});

check("oportunidades: SQL real + índice idx_promo_diag_conta_concluido usado pelo planner (EXPLAIN e tempo)", async ({ db, pg }) => {
  // Schema REAL do diagnóstico (inclui o índice novo); depois a migration de
  // novo (o índice guardado também é idempotente).
  await pg.exec(fs.readFileSync(path.join(__dirname, "..", "sql", "promocoes_diagnostico_schema.sql"), "utf8"));
  await schemaEnsure.ensureMargemPrecificacaoSchema({ query: (s, p) => db.query(s, p) });
  await pg.exec(`
    CREATE TABLE margin_projection_snapshots (id BIGSERIAL PRIMARY KEY, cliente_conta_id BIGINT, marketplace TEXT, item_id TEXT, titulo TEXT, image_url TEXT,
      price NUMERIC(14,2), cost NUMERIC(14,2), tax_rate NUMERIC(10,4), fixed_fee NUMERIC(14,2), commission_rate NUMERIC(10,4), freight NUMERIC(14,2),
      margin NUMERIC(10,4), status TEXT, quality_json JSONB DEFAULT '{}'::jsonb, catalog_missing_since TIMESTAMPTZ);
    -- Volume: 300 clientes × 4 contas × ~50 diagnósticos, 3 status.
    INSERT INTO promocoes_diagnosticos (cliente_id, cliente_slug, base_slug, seller_id, status, created_at)
      SELECT (g % 300) + 1, 'c' || (g % 300), 'b', (1000 + (g % 1200))::text,
             CASE WHEN g % 7 = 0 THEN 'erro' WHEN g % 11 = 0 THEN 'processando' ELSE 'concluido' END,
             NOW() - (g || ' minutes')::interval
        FROM generate_series(1, 60000) g;
    INSERT INTO promocoes_diagnosticos (cliente_id, cliente_slug, base_slug, seller_id, status, itens_scaneados, created_at)
      VALUES (1, 'a', 'b', '555', 'concluido', 10, NOW()), (1, 'a', 'b', '999', 'concluido', 10, NOW());
    ANALYZE promocoes_diagnosticos;
  `);
  const { rows: ids } = await pg.query("SELECT id, seller_id FROM promocoes_diagnosticos WHERE seller_id IN ('555','999') ORDER BY id");
  const idConta = ids.find((r) => r.seller_id === "555").id;
  const idOutra = ids.find((r) => r.seller_id === "999").id;
  await pg.query(
    `INSERT INTO promocoes_diagnostico_itens (diagnostico_id, item_id, campanha, campanha_id, tipo_promocao, preco_original, preco_promocao, retorno_ml, payload_raw)
     VALUES ($1, 'MLB1', 'C1', 'P1', 'DEAL', 100, 90, 3, '{"status":"candidate"}'), ($2, 'MLB2', 'C2', 'P2', 'DEAL', 100, 90, 3, '{"status":"candidate"}')`,
    [idConta, idOutra]
  );
  await pg.exec(`INSERT INTO margin_projection_snapshots (cliente_conta_id, marketplace, item_id, titulo, price, cost, tax_rate, fixed_fee, commission_rate, freight, margin, status)
      VALUES (7, 'meli', 'MLB1', 'P1', 100, 40, 0.1, 0, 0.12, 15, 0.2, 'HEALTHY'), (7, 'meli', 'MLB2', 'P2', 100, 40, 0.1, 0, 0.12, 15, 0.2, 'HEALTHY');`);

  const consulta = `SELECT id, created_at, parcial, itens_scaneados FROM promocoes_diagnosticos
      WHERE cliente_id = $1 AND seller_id = $2 AND status = 'concluido' ORDER BY created_at DESC, id DESC LIMIT 1`;
  const plano = async () => (await pg.query(`EXPLAIN ${consulta}`, [1, "555"])).rows.map((r) => r["QUERY PLAN"]).join("\n");
  const tempo = async () => {
    const t0 = performance.now();
    for (let i = 0; i < 200; i += 1) await pg.query(consulta, [1 + (i % 300), String(1000 + (i % 1200))]);
    return (performance.now() - t0) / 200;
  };
  const planoCom = await plano();
  const msCom = await tempo();
  await pg.exec("DROP INDEX idx_promo_diag_conta_concluido; ANALYZE promocoes_diagnosticos;");
  const planoSem = await plano();
  const msSem = await tempo();
  await pg.exec(`CREATE INDEX idx_promo_diag_conta_concluido ON promocoes_diagnosticos (cliente_id, seller_id, created_at DESC, id DESC) WHERE status = 'concluido'; ANALYZE promocoes_diagnosticos;`);
  console.log(`      EXPLAIN com índice:\n        ${planoCom.split("\n").join("\n        ")}`);
  console.log(`      EXPLAIN sem índice:\n        ${planoSem.split("\n").join("\n        ")}`);
  console.log(`      tempo médio (200 consultas, 60k diagnósticos): com ${msCom.toFixed(3)} ms · sem ${msSem.toFixed(3)} ms`);
  assert.ok(/idx_promo_diag_conta_concluido/.test(planoCom), planoCom);
  assert.ok(!/idx_promo_diag_conta_concluido/.test(planoSem));
  assert.ok(msCom < msSem, "o índice precisa acelerar a consulta real");

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
