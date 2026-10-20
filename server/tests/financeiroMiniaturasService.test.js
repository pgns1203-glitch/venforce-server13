// server/tests/financeiroMiniaturasService.test.js
//
// Foto dos produtos do Financeiro: normalização do MLB, escopo cliente+conta
// na consulta, https, resposta na chave que a tela pediu e tabela ausente.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const { obterMiniaturas, normalizarItemId, MAX_ITENS } = require("../services/financeiroMiniaturasService");

let checks = 0;
function ok(label, cond) {
  assert.ok(cond, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

function dbCom(rows) {
  const chamadas = [];
  return {
    chamadas,
    async query(sql, params) {
      chamadas.push({ sql, params });
      return { rows };
    },
  };
}

async function erroDe(fn) {
  try { await fn(); } catch (e) { return e; }
  return null;
}

async function run() {
  ok("MLB normal", normalizarItemId("MLB123") === "MLB123");
  ok("minúsculo com hífen", normalizarItemId("mlb-123") === "MLB123");
  ok("só o número vira MLB", normalizarItemId("4567") === "MLB4567");
  ok("id de outro marketplace é ignorado", normalizarItemId("SKU-ABC") === null);
  ok("vazio é ignorado", normalizarItemId("") === null);

  const base = { clienteSlugRaw: "zenite", clienteContaIdRaw: "42" };

  let e = await erroDe(() => obterMiniaturas({ ...base, clienteContaIdRaw: "", itensRaw: "MLB1" }, { db: dbCom([]) }));
  ok("sem conta → 400 CONTA_OBRIGATORIA", e && e.statusCode === 400 && e.code === "CONTA_OBRIGATORIA");
  const muitos = Array.from({ length: MAX_ITENS + 1 }, (_, i) => `MLB${i}`).join(",");
  e = await erroDe(() => obterMiniaturas({ ...base, itensRaw: muitos }, { db: dbCom([]) }));
  ok(`mais de ${MAX_ITENS} itens → 400 ITENS_DEMAIS`, e && e.code === "ITENS_DEMAIS");

  const vazio = dbCom([]);
  const r0 = await obterMiniaturas({ ...base, itensRaw: "SKU-1,,ABC" }, { db: vazio });
  ok("nenhum id de ML → mapa vazio sem consultar o banco", Object.keys(r0.miniaturas).length === 0 && vazio.chamadas.length === 0);

  const db = dbCom([
    { item_id: "MLB1", thumbnail: "http://http2.mlstatic.com/D_1-I.jpg" },
    { item_id: "MLB2", thumbnail: "https://http2.mlstatic.com/D_2-I.jpg" },
  ]);
  const r = await obterMiniaturas({ ...base, itensRaw: "MLB1, 1 ,mlb2,MLB9" }, { db });
  const { sql, params } = db.chamadas[0];
  ok("consulta escopada por slug do cliente e conta (aceita linha antiga sem conta)",
    /c\.slug = \$1/.test(sql) && /cliente_conta_id = \$3 OR ma\.cliente_conta_id IS NULL/.test(sql) && params[0] === "zenite" && params[2] === 42);
  ok("ids normalizados e sem repetição na consulta", JSON.stringify(params[1].sort()) === JSON.stringify(["MLB1", "MLB2", "MLB9"]));
  ok("http vira https", r.miniaturas.MLB1 === "https://http2.mlstatic.com/D_1-I.jpg");
  ok("a resposta volta em cada chave que a tela pediu", r.miniaturas["1"] === r.miniaturas.MLB1 && r.miniaturas.mlb2 === "https://http2.mlstatic.com/D_2-I.jpg");
  ok("sem foto no banco não aparece no mapa", !("MLB9" in r.miniaturas));

  const semTabela = { async query() { const err = new Error("relation does not exist"); err.code = "42P01"; throw err; } };
  const rt = await obterMiniaturas({ ...base, itensRaw: "MLB1" }, { db: semTabela });
  ok("tabela meli_anuncios ausente → mapa vazio, não 500", Object.keys(rt.miniaturas).length === 0);

  const quebrado = { async query() { const err = new Error("boom"); err.code = "XX000"; throw err; } };
  e = await erroDe(() => obterMiniaturas({ ...base, itensRaw: "MLB1" }, { db: quebrado }));
  ok("outro erro de banco propaga", e && e.message === "boom");

  console.log(`\n✓ financeiroMiniaturasService: ${checks} checks`);
}

run().catch((err) => { console.error(err); process.exit(1); });
