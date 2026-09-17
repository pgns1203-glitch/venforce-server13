// server/tests/cliente360V3HistoricoController.test.js
//
// FASE 6 (Projeto_cliente360) — teste de invocação REAL do controller (não
// só require), o mesmo tipo de teste que pegou o bug de wiring real na
// Fase 3 (resolverContaObrigatoria sem deps internas).

const assert = require("assert");
const { historico } = require("../controllers/cliente360V3HistoricoController");

let passed = 0;
const check = (n, c) => { assert.ok(c, `FALHOU: ${n}`); passed++; console.log(`  ok  ${n}`); };

function criarRes() {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

const DEPS_CONTA_FAKE = {
  resolverClientePorIdOuSlug: async (slug) => ({ id: 1, slug, nome: "Cliente X" }),
  obterConta: async (id) => ({ id, cliente_id: 1, marketplace: "meli", ativo: true }),
  sanitizarConta: (c) => c,
};

(async () => {
  // 1. Sem ?conta= → 400, nunca escolhe conta sozinho.
  {
    const req = { params: { slug: "cliente-x" }, query: {} };
    const res = criarRes();
    await historico(req, res, { deposContaOverrides: DEPS_CONTA_FAKE });
    check("sem ?conta= → 400", res.statusCode === 400);
  }

  // 2. Invocação real com deps completas — wiring correto, sem TypeError.
  {
    const req = { params: { slug: "cliente-x" }, query: { conta: "10" } };
    const res = criarRes();
    let recebido = null;
    await historico(req, res, {
      deposContaOverrides: DEPS_CONTA_FAKE,
      listarEventos: async (args) => { recebido = args; return { eventos: [], fontes: {} }; },
    });
    check("chama listarEventos com clienteSlug/clienteContaId/marketplace resolvidos", res.statusCode === 200);
    check("clienteContaId propagado (nunca inferido)", recebido.clienteContaId === 10);
    check("marketplace vem da conta resolvida, nunca um parâmetro livre", recebido.marketplace === "meli");
  }

  // 3. limite é repassado adiante (default do service se ausente).
  {
    const req = { params: { slug: "cliente-x" }, query: { conta: "10", limite: "5" } };
    const res = criarRes();
    let recebido = null;
    await historico(req, res, {
      deposContaOverrides: DEPS_CONTA_FAKE,
      listarEventos: async (args) => { recebido = args; return { eventos: [], fontes: {} }; },
    });
    check("limite da querystring é repassado ao service", recebido.limite === "5");
  }

  // 4. conta inativa/estrangeira → erro real da resolução, nunca escondido.
  {
    const req = { params: { slug: "cliente-x" }, query: { conta: "10" } };
    const res = criarRes();
    await historico(req, res, {
      deposContaOverrides: {
        ...DEPS_CONTA_FAKE,
        obterConta: async (id) => { const e = new Error("Conta não pertence ao cliente."); e.statusCode = 409; throw e; },
      },
    });
    check("erro de resolução de conta propaga o statusCode real", res.statusCode === 409);
  }

  console.log(`\n${passed} verificações passaram. Controller histórico: wiring real testado, conta obrigatória, sem escolha silenciosa.`);
})().catch((e) => { console.error(e); process.exit(1); });
