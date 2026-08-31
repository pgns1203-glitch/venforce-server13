// server/tests/financeiroV3ContaObrigatoria.test.js
//
// VenForce V3 — Pós-Convergência #2 (BLOCO 7/8/15 / 19).
//
// POST /fechamentos/financeiro é o motor NATIVO do Financeiro V3 (processa
// planilha + declara competência/divergência — nada duplicado). BLOCO 8:
// quando o request se declara account-aware (clienteContaId informado), o
// backend PROVA cliente + conta + posse + conta ativa. Nunca aceita
// silenciosamente conta de outro cliente / primária / primeira / fallback.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const pool = require("../config/database");
const { validarContaDoCliente } = require("../controllers/fechamentosFinanceiroController");

let checks = 0;
function ok(label, cond) { assert.ok(cond, `FALHOU: ${label}`); checks += 1; console.log(`  ok  ${label}`); }
async function rejeitaCom(label, promise, verificar) {
  let erro = null;
  try { await promise; } catch (e) { erro = e; }
  assert.ok(erro, `FALHOU (nao rejeitou): ${label}`);
  if (verificar) assert.ok(verificar(erro), `FALHOU (erro inesperado): ${label} — status=${erro.statusCode} code=${erro.code}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

// Cliente 1 = "red-fish" tem a conta 41. Cliente 2 = "outro" tem a conta 99.
// A conta 50 pertence ao cliente 1 mas está DESATIVADA.
const CLIENTES = { "red-fish": { id: 1, slug: "red-fish", nome: "Red Fish", ativo: true }, "outro": { id: 2, slug: "outro", nome: "Outro", ativo: true } };
const CONTAS = {
  41: { id: 41, cliente_id: 1, nome: "ML Red Fish", ativo: true },
  99: { id: 99, cliente_id: 2, nome: "ML Outro", ativo: true },
  50: { id: 50, cliente_id: 1, nome: "ML Antiga", ativo: false },
};

function mundo(sql, params) {
  const q = String(sql).replace(/\s+/g, " ");
  if (q.includes("FROM clientes WHERE slug = $1")) {
    const c = CLIENTES[String(params[0])];
    return { rows: c ? [c] : [] };
  }
  if (q.includes("FROM cliente_contas WHERE id = $1")) {
    const c = CONTAS[Number(params[0])];
    return { rows: c ? [c] : [] };
  }
  return { rows: [] };
}

const queryOriginal = pool.query;

async function run() {
  pool.query = (sql, params) => Promise.resolve(mundo(sql, params));
  try {
    // ---------- client-level / legado: clienteContaId ausente → ok, sem query
    {
      const r = await validarContaDoCliente({ clienteSlug: "red-fish", clienteContaId: null });
      ok("sem clienteContaId (client-level) passa sem exigir conta", r === null);
    }

    // ---------- account-aware feliz
    {
      const r = await validarContaDoCliente({ clienteSlug: "red-fish", clienteContaId: 41 });
      ok("conta 41 pertence ao red-fish e está ativa → { clienteId:1, clienteContaId:41 }",
        r && r.clienteId === 1 && r.clienteContaId === 41);
    }

    // ---------- conta de OUTRO cliente → 409 canônico, nunca processa
    await rejeitaCom(
      "conta 99 (do cliente 2) declarada como red-fish → 409 CONTA_NAO_PERTENCE_AO_CLIENTE",
      validarContaDoCliente({ clienteSlug: "red-fish", clienteContaId: 99 }),
      (e) => e.statusCode === 409 && e.code === "CONTA_NAO_PERTENCE_AO_CLIENTE"
    );

    // ---------- conta desativada → 409 CONTA_INATIVA
    await rejeitaCom(
      "conta 50 (do red-fish, mas desativada) → 409 CONTA_INATIVA",
      validarContaDoCliente({ clienteSlug: "red-fish", clienteContaId: 50 }),
      (e) => e.statusCode === 409 && e.code === "CONTA_INATIVA"
    );

    // ---------- account-aware sem cliente_slug → 400 (não dá para provar posse)
    await rejeitaCom(
      "clienteContaId sem cliente_slug → 400",
      validarContaDoCliente({ clienteSlug: null, clienteContaId: 41 }),
      (e) => e.statusCode === 400
    );

    // ---------- conta inexistente → 404 (via obterConta)
    await rejeitaCom(
      "clienteContaId inexistente → 404",
      validarContaDoCliente({ clienteSlug: "red-fish", clienteContaId: 7777 }),
      (e) => e.statusCode === 404
    );
  } finally {
    pool.query = queryOriginal;
  }

  console.log(`\nfinanceiroV3ContaObrigatoria.test.js: ${checks} verificações passaram.`);
}

run().catch((err) => { pool.query = queryOriginal; console.error(err); process.exitCode = 1; });
