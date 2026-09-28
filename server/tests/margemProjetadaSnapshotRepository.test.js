// server/tests/margemProjetadaSnapshotRepository.test.js
//
// FASE 2B do plano de margem projetada global — ver
// docs/AUDITORIA_ANUNCIOS_ML_MARGEM_PROJETADA_FASE2_JOB_MANUAL.md. Testa
// `margemProjetadaSnapshotRepository.upsertSnapshot` SEM Postgres real (fake
// `db` que captura SQL/params, mesmo padrão de schemaEnsureEntregasCliente.test.js).
//
// Prova:
//   - o SQL usa a UNIQUE (cliente_id, item_id) existente (ON CONFLICT).
//   - os valores gravados vêm de item.margin.projected/item.pricing/item.quality
//     — nenhum recálculo.
//   - "inserted" reflete xmax=0 do retorno (distingue create de update).

const assert = require("assert");
const { upsertSnapshot, valorEvidencia, lerSnapshotPorItens } = require("../services/motorMargem/margemProjetadaSnapshotRepository");

let checks = 0;
function ok(label, cond) {
  assert.ok(cond, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

function fakeDb(respostaInserted) {
  const capturas = [];
  return {
    capturas,
    async query(sql, params) {
      capturas.push({ sql: String(sql), params });
      return { rows: [{ inserted: respostaInserted }] };
    },
  };
}

function itemFixture() {
  return {
    identity: { itemId: "MLB123" },
    pricing: {
      current: { value: 150.5, source: "MELI_API", quality: "MEASURED", observedAt: "2026-09-25T10:00:00Z" },
      list: { value: 199.9, source: "MELI_API", quality: "MEASURED", observedAt: "2026-09-25T10:00:00Z" },
    },
    margin: {
      projected: {
        profit: 30.25,
        margin: 0.2,
        marginPercent: 20,
        computable: true,
        strict: true,
        missing: [],
        assumed: [],
      },
    },
    quality: { status: "HEALTHY" },
  };
}

async function run() {
  // ── valorEvidencia ───────────────────────────────────────────────────────

  ok("valorEvidencia extrai .value de uma evidência presente", valorEvidencia({ value: 42 }) === 42);
  ok("valorEvidencia devolve null para evidência ausente", valorEvidencia(null) === null);
  ok("valorEvidencia devolve null quando .value é null", valorEvidencia({ value: null }) === null);

  // ── upsertSnapshot: SQL usa a UNIQUE existente, valores vêm do item ──────

  {
    const db = fakeDb(true);
    const item = itemFixture();
    const resultado = await upsertSnapshot(
      { clienteId: 16, clienteContaId: null, itemId: "MLB123", item, origemJob: "manual_cli" },
      db
    );

    ok("upsertSnapshot chama query() exatamente 1 vez", db.capturas.length === 1);
    const { sql, params } = db.capturas[0];

    ok("SQL usa ON CONFLICT (cliente_id, item_id) — a UNIQUE já existente, não uma nova", /ON CONFLICT \(cliente_id, item_id\)/i.test(sql));
    ok("SQL faz INSERT ... DO UPDATE (upsert real, não dois statements)", /INSERT INTO anuncios_margem_projetada_snapshot/i.test(sql) && /DO UPDATE SET/i.test(sql));
    ok("SQL atualiza calculado_em com NOW() (não um valor fixo do JS)", /calculado_em\s*=\s*NOW\(\)/i.test(sql));

    ok("cliente_id/item_id vêm dos parâmetros recebidos, não recalculados", params[0] === 16 && params[2] === "MLB123");
    ok("margin_percent vem de item.margin.projected.marginPercent (20), não recalculado", params[3] === 20);
    ok("profit vem de item.margin.projected.profit (30.25), não recalculado", params[4] === 30.25);
    ok("computable vem de item.margin.projected.computable (true)", params[5] === true);
    ok("status vem de item.quality.status (HEALTHY)", params[6] === "HEALTHY");
    ok("preco_atual vem de item.pricing.current.value (150.5), mesmo helper valorEvidencia do controller", params[7] === 150.5);
    ok("preco_original vem de item.pricing.list.value (199.9)", params[8] === 199.9);
    ok("faltantes_json serializa item.margin.projected.missing ([])", params[9] === "[]");
    ok("origem_job vem do parâmetro recebido (manual_cli), nunca hardcoded no SQL", params[10] === "manual_cli");

    ok("resultado.inserted reflete xmax=0 (true = linha nova)", resultado.inserted === true);
  }

  {
    const db = fakeDb(false);
    const resultado = await upsertSnapshot(
      { clienteId: 16, clienteContaId: 6, itemId: "MLB123", item: itemFixture(), origemJob: "manual_cli" },
      db
    );
    ok("resultado.inserted reflete xmax!=0 (false = linha atualizada)", resultado.inserted === false);
    ok("cliente_conta_id chega ao SQL exatamente como recebido (6)", db.capturas[0].params[1] === 6);
  }

  {
    // Item não computável: profit/marginPercent nulos, missing preenchido —
    // grava exatamente isso, não inventa zero.
    const db = fakeDb(true);
    const item = itemFixture();
    item.margin.projected = { profit: null, margin: null, marginPercent: null, computable: false, strict: false, missing: ["cost"], assumed: [] };
    item.quality.status = "UNVALIDATED";

    await upsertSnapshot({ clienteId: 1, clienteContaId: null, itemId: "MLB999", item, origemJob: "manual_cli" }, db);
    const { params } = db.capturas[0];
    ok("item não computável: profit/margin_percent gravados como null (nunca 0 inventado)", params[3] === null && params[4] === null);
    ok("item não computável: computable=false gravado", params[5] === false);
    ok("item não computável: faltantes_json reflete item.margin.projected.missing", params[9] === JSON.stringify(["cost"]));
  }

  // ── lerSnapshotPorItens: leitura em lote p/ ordenação global ────────────

  {
    // Array vazio: nem chama o banco.
    const db = { async query() { throw new Error("não deveria ser chamado"); } };
    const mapa = await lerSnapshotPorItens({ clienteId: 1, itemIds: [] }, db);
    ok("lerSnapshotPorItens([]) devolve Map vazio sem tocar o banco", mapa instanceof Map && mapa.size === 0);
  }

  {
    const capturas = [];
    const db = {
      async query(sql, params) {
        capturas.push({ sql: String(sql), params });
        return {
          rows: [
            { item_id: "MLB1", margin_percent: "23.45", profit: "12.30", computable: true, status: "HEALTHY", calculado_em: "2026-09-28T05:00:00Z", origem_job: "orquestrador_manual" },
            { item_id: "MLB2", margin_percent: null, profit: null, computable: false, status: "UNVALIDATED", calculado_em: "2026-09-28T05:00:00Z", origem_job: "orquestrador_manual" },
          ],
        };
      },
    };
    const mapa = await lerSnapshotPorItens({ clienteId: 16, itemIds: ["MLB1", "MLB2", "MLB1"] }, db);

    ok("lerSnapshotPorItens dedupe itemIds antes de mandar pro SQL", capturas[0].params[1].length === 2);
    ok("SQL filtra por cliente_id (params[0])", capturas[0].params[0] === 16);
    ok("SQL usa item_id = ANY($2)", /item_id = ANY\(\$2::text\[\]\)/.test(capturas[0].sql));

    ok("Map tem 1 entrada por item_id retornado pelo SQL", mapa.size === 2);
    const mlb1 = mapa.get("MLB1");
    ok("marginPercent vira Number (coluna NUMERIC chega como string do pg)", mlb1.marginPercent === 23.45);
    ok("profit vira Number", mlb1.profit === 12.3);
    ok("computable=true preservado", mlb1.computable === true);
    ok("status preservado", mlb1.status === "HEALTHY");
    ok("calculadoEm preservado", mlb1.calculadoEm === "2026-09-28T05:00:00Z");
    ok("origemJob preservado", mlb1.origemJob === "orquestrador_manual");

    const mlb2 = mapa.get("MLB2");
    ok("item não computável: marginPercent/profit null preservados (nunca 0 inventado)", mlb2.marginPercent === null && mlb2.profit === null);
    ok("item não computável: computable=false preservado", mlb2.computable === false);
  }

  {
    // Item sem linha no snapshot simplesmente não entra no Map.
    const db = { async query() { return { rows: [] }; } };
    const mapa = await lerSnapshotPorItens({ clienteId: 1, itemIds: ["MLB-SEM-SNAPSHOT"] }, db);
    ok("item sem snapshot: Map não tem a chave (nunca um valor inventado)", mapa.has("MLB-SEM-SNAPSHOT") === false);
  }

  console.log(`\nmargemProjetadaSnapshotRepository.test.js: ${checks} verificações passaram.`);
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
