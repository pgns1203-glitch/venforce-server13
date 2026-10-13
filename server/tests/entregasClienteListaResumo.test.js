// Financeiro V3 (Relatórios gerados) — GET /entregas-cliente passa a
// devolver um RESUMO de leitura do fechamento gravado (modo de cálculo,
// cobertura de custo e marketplace do payload), sem trazer o payload_json
// inteiro. Só projeção: filtros, ordem, paginação e total não mudam.

const assert = require("assert");
const pool = require("../config/database");
const servico = require("../services/entregasClienteService");

let total = 0;
function ok(nome, cond) {
  assert.ok(cond, nome);
  total += 1;
}

async function run() {
  const original = pool.query;
  const capturas = [];
  pool.query = async (sql, params) => {
    const q = String(sql).replace(/\s+/g, " ").trim();
    capturas.push({ q, params });
    if (q.startsWith("SELECT COUNT(*)")) return { rows: [{ total: 1 }] };
    return {
      rows: [{ id: 1, periodo: "2026-10", cliente_conta_id: 10, modo_calculo: "real_financial", cobertura_custo_percentual: "98.4", marketplace_payload: "shopee" }],
    };
  };
  try {
    const r = await servico.listarEntregas({
      query: { cliente_slug: "n97", tipo: "fechamento_mensal", cliente_conta_id: 10, incluir_sem_conta: "true", limit: 24 },
      clienteIdsPermitidos: [1],
    });
    const select = capturas.find((c) => c.q.startsWith("SELECT id, tipo"));
    const count = capturas.find((c) => c.q.startsWith("SELECT COUNT(*)"));
    ok("projeta o modo de cálculo do summary gravado", /payload_json->'summary'->>'calculationMode' AS modo_calculo/.test(select.q));
    ok("projeta a cobertura de custo do summary gravado", /payload_json->'summary'->>'calculatedCoveragePercent' AS cobertura_custo_percentual/.test(select.q));
    ok("projeta o marketplace do payload (com fallback em metadados)", /COALESCE\(payload_json->>'marketplace', payload_json->'metadados'->>'marketplace'\) AS marketplace_payload/.test(select.q));
    ok("NÃO devolve o payload_json inteiro na lista", !/payload_json,|payload_json FROM| payload_json /.test(select.q.replace(/payload_json->/g, "")));
    ok("filtros continuam os mesmos no SELECT e no COUNT", select.q.includes("WHERE tipo = $1 AND cliente_slug = $2") && count.q.includes("WHERE tipo = $1 AND cliente_slug = $2"));
    ok("filtro de conta + legadas preservado", /\(cliente_conta_id = \$3 OR cliente_conta_id IS NULL\)/.test(select.q));
    ok("carteira continua no SQL", /cliente_id = ANY\(\$4::int\[\]\)/.test(select.q));
    ok("ordem e paginação inalteradas", /ORDER BY created_at DESC, id DESC LIMIT \$5 OFFSET \$6$/.test(select.q));
    ok("linhas chegam com o resumo", r.entregas[0].modo_calculo === "real_financial" && r.total === 1);
  } finally {
    pool.query = original;
  }
  console.log(`entregasClienteListaResumo.test.js: ${total} verificações passaram.`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
