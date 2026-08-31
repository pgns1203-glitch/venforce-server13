// server/tests/fechamentoClientesCarteira.test.js
//
// V3 P2.7 BLOCO L — GET /fechamentos/financeiro/clientes vazava a base inteira.
//
// O BUG: listarClientesAtivosFinanceiro rodava
//     SELECT id, nome, slug, ativo FROM clientes WHERE ativo = true
// sem NENHUM filtro de carteira, e o controller chamava a funcao SEM passar
// req.user. Qualquer papel de automacoes (`membro` inclusive) enxergava todos
// os clientes ativos da base no seletor do Fechamento — inclusive os de outros
// Squads e os de outros sellers.
//
// A CORRECAO passa a rota pelo authorizationService (`resolvePortfolioClientes`),
// a MESMA fonte unica de carteira usada pelo resto do V3. Com
// SQUADS_ENFORCEMENT=OFF o resultado para papel interno e identico ao de hoje
// (todos os clientes ativos), entao nao ha quebra de comportamento agora — o
// que muda e que a rota passa a respeitar a carteira automaticamente quando o
// enforcement for ligado, e ja hoje isola `seller`.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const pool = require("../config/database");
const { listarClientesAtivosFinanceiro } = require("../services/fechamentoFinanceiro/clientesFinanceiroService");

let checks = 0;
function ok(label, condition) {
  assert.ok(condition, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

const TODOS = [
  { id: 1, slug: "cliente-a", nome: "Cliente A" },
  { id: 2, slug: "cliente-b", nome: "Cliente B" },
  { id: 3, slug: "cliente-c", nome: "Cliente C" },
];
const DO_SELLER = [{ id: 2, slug: "cliente-b", nome: "Cliente B" }];
const DO_SQUAD = [{ id: 3, slug: "cliente-c", nome: "Cliente C" }];

// Roteia pelas marcas /* authz:... */ que o authorizationService ja usa.
async function withMockDb(fn) {
  const original = pool.query;
  const vistas = [];
  pool.query = async (sql, params) => {
    const q = String(sql);
    vistas.push(q);
    if (q.includes("authz:PORTFOLIO_ADMIN_ALL")) return { rows: TODOS };
    if (q.includes("authz:PORTFOLIO_SELLER")) return { rows: DO_SELLER };
    if (q.includes("authz:PORTFOLIO_INTERNAL_ENFORCEMENT_OFF")) return { rows: TODOS };
    if (q.includes("authz:PORTFOLIO_INTERNAL_BY_SQUAD")) return { rows: DO_SQUAD };
    throw new Error(`Query nao mockada (a rota deve passar pelo authorizationService): ${q.replace(/\s+/g, " ").slice(0, 140)}`);
  };
  try { return await fn(vistas); } finally { pool.query = original; }
}

async function run() {
  // A regressao central: a rota NAO pode mais fazer um SELECT direto em
  // `clientes` sem carteira. O mock lanca se isso acontecer.
  await withMockDb(async (vistas) => {
    const clientes = await listarClientesAtivosFinanceiro({ id: 7, role: "admin" });
    ok("admin continua vendo todos os clientes ativos (bypass canonico)", clientes.length === 3);
    ok("a rota passa pelo authorizationService, nao por SELECT direto em clientes",
      vistas.some((q) => q.includes("authz:PORTFOLIO_ADMIN_ALL")));
  });

  await withMockDb(async () => {
    const clientes = await listarClientesAtivosFinanceiro({ id: 9, role: "seller" });
    ok("seller so ve os clientes do proprio vinculo (isolamento ja hoje)", clientes.length === 1 && clientes[0].slug === "cliente-b");
  });

  await withMockDb(async () => {
    const clientes = await listarClientesAtivosFinanceiro({ id: 5, role: "membro" });
    ok("papel interno com enforcement OFF ve todos os ativos (sem quebra de comportamento hoje)", clientes.length === 3);
  });

  // Papel desconhecido nunca cai em "todos os clientes".
  await withMockDb(async () => {
    const clientes = await listarClientesAtivosFinanceiro({ id: 11, role: "shopee_reviewer" });
    ok("papel sem carteira operacional recebe lista vazia, nunca a base inteira", clientes.length === 0);
  });
  await withMockDb(async () => {
    const clientes = await listarClientesAtivosFinanceiro(undefined);
    ok("sem usuario a lista e vazia (fail-closed), nunca a base inteira", clientes.length === 0);
  });

  // Contrato de resposta preservado: exatamente os 4 campos de antes.
  await withMockDb(async () => {
    const [c] = await listarClientesAtivosFinanceiro({ id: 7, role: "admin" });
    ok("contrato preserva os 4 campos historicos", Object.keys(c).sort().join(",") === "ativo,id,nome,slug");
    ok("ativo continua true (a carteira so devolve cliente ativo)", c.ativo === true);
  });

  console.log(`\nfechamentoClientesCarteira.test.js: ${checks} verificacoes passaram.`);
}

run().catch((err) => { console.error(err); process.exitCode = 1; });
