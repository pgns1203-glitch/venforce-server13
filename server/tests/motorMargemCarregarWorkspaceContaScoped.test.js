// server/tests/motorMargemCarregarWorkspaceContaScoped.test.js
//
// GAP encontrado na auditoria da FASE 2 do plano de margem projetada global
// (docs/AUDITORIA_ANUNCIOS_ML_MARGEM_PROJETADA_FASE2_JOB_MANUAL.md §1.2):
// `prepareWorkspaceContext` já aceita `clienteContaId` nativamente (usado
// para resolver a conta certa via `resolveMarketplaceAccountContext`), mas
// `carregarWorkspace` — a função de mais alto nível, a que um futuro job
// multi-conta chamaria — nunca desestruturava nem repassava esse parâmetro.
// Efeito: um cliente com 2+ contas MELI ativas não tinha como pedir o
// workspace de UMA conta específica; a resolução "automática" sempre caía em
// `409 MULTIPLE_MARKETPLACE_ACCOUNTS`.
//
// Esta suíte prova a correção em duas camadas:
//   A) unitária — clienteContaId chega até `prepareWorkspaceContext` (mesmo
//      estilo do teste já existente em motorMargemApi.test.js para
//      "prepareWorkspaceContext repassa clienteContaId para carregarVendas",
//      um nível abaixo).
//   B) integração — a cadeia REAL de resolução de conta
//      (exigirContextoPronto → resolverContextoPrecificacao →
//      resolveMarketplaceAccountContext, SEM mock de nenhuma dessas funções)
//      exercitada A PARTIR de `carregarWorkspace`, provando os 3 cenários
//      pedidos: single-account continua funcionando, multi-account sem
//      clienteContaId continua falhando com 409 MULTIPLE_MARKETPLACE_ACCOUNTS,
//      multi-account COM clienteContaId resolve a conta certa sem misturar
//      seller/grant/base. Nenhuma lógica de resolução de conta nova foi
//      criada — só reaproveitada (mesmo padrão de mock de
//      contextoPrecificacaoContaScoped.test.js).

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const pool = require("../config/database");
const Module = require("module");

// ── stub de mlTokenService, mesmo padrão de contextoPrecificacaoContaScoped.test.js ──
const originalLoad = Module._load;
let GRANT_CONECTADO = true;
async function resolveMlGrantStub({ mlUserId, requireUsable }) {
  if (!GRANT_CONECTADO) {
    const err = new Error("Cliente não possui grant Mercado Livre.");
    err.code = "ML_GRANT_NOT_FOUND";
    throw err;
  }
  return { ml_user_id: mlUserId || "111" };
}
Module._load = function loadWithMlTokenStub(request, parent, isMain) {
  if (request === "../mlTokenService") {
    return {
      resolveMlGrant: resolveMlGrantStub,
      createMlTokenService: () => ({ resolveMlGrant: resolveMlGrantStub }),
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

// motorMargemService (e sua cadeia: contextoPrecificacaoService →
// clienteContaService → mlTokenService) precisa carregar ENQUANTO o stub
// está ativo, senão a versão real de mlTokenService fica em cache.
const service = require("../services/motorMargem/motorMargemService");

Module._load = originalLoad;

let checks = 0;
function ok(label, cond) {
  assert.ok(cond, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}
async function rejeitaCom(label, promise, verificar) {
  let erro = null;
  try {
    await promise;
  } catch (e) {
    erro = e;
  }
  assert.ok(erro, `FALHOU (não rejeitou): ${label}`);
  if (verificar) assert.ok(verificar(erro), `FALHOU (erro inesperado): ${label} — ${JSON.stringify(erro.payload || erro.message)}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

// ── A) unitário — clienteContaId chega até prepareWorkspaceContext ─────────

async function testeUnitario() {
  // A1. clienteContaId informado é repassado tal-e-qual.
  {
    const chamadas = [];
    const deps = {
      prepareWorkspaceContext: async (args) => {
        chamadas.push(args);
        return {
          cliente: { id: 1, slug: "c" }, base: { id: 9 }, mlUserId: "99",
          periodo: { dateFrom: "2026-08-01", dateTo: "2026-08-31" },
          vendasRaw: { sincronizado: true, pedidos: [] }, porMlb: new Map(),
          naoAtribuido: { reembolso: 0 },
        };
      },
      enrichBatch: async () => ({ totalItensMl: 0, itens: [] }),
    };

    await service.carregarWorkspace(
      { clienteSlug: "c", dateFrom: "2026-08-01", dateTo: "2026-08-31", maxItens: 20, clienteContaId: 502 },
      deps
    );

    ok("carregarWorkspace repassa clienteContaId para prepareWorkspaceContext",
      chamadas.length === 1 && chamadas[0].clienteContaId === 502);
  }

  // A2. sem clienteContaId — continua null, comportamento anterior preservado.
  {
    const chamadas = [];
    const deps = {
      prepareWorkspaceContext: async (args) => {
        chamadas.push(args);
        return {
          cliente: { id: 1, slug: "c" }, base: { id: 9 }, mlUserId: "99",
          periodo: { dateFrom: "2026-08-01", dateTo: "2026-08-31" },
          vendasRaw: { sincronizado: true, pedidos: [] }, porMlb: new Map(),
          naoAtribuido: { reembolso: 0 },
        };
      },
      enrichBatch: async () => ({ totalItensMl: 0, itens: [] }),
    };

    await service.carregarWorkspace(
      { clienteSlug: "c", dateFrom: "2026-08-01", dateTo: "2026-08-31", maxItens: 20 },
      deps
    );

    ok("carregarWorkspace sem clienteContaId não quebra (continua null, comportamento anterior)",
      chamadas.length === 1 && chamadas[0].clienteContaId === null);
  }
}

// ── B) integração — cadeia REAL de resolução de conta, sem mock dela ───────

const cliente = { id: 1, nome: "Cliente Multi", slug: "cliente-multi", ativo: true };
const contaA = { id: 501, cliente_id: 1, marketplace: "meli", nome: "Conta A", slug: "conta-a", external_account_id: "AAA", is_primary: true, ativo: true, metadata_json: {}, created_at: null, updated_at: null };
const contaB = { id: 502, cliente_id: 1, marketplace: "meli", nome: "Conta B", slug: "conta-b", external_account_id: "BBB", is_primary: false, ativo: true, metadata_json: {}, created_at: null, updated_at: null };
const baseA = { id: 7001, slug: "base-a", nome: "Base A", ativo: true, created_at: null, updated_at: null };
const baseB = { id: 7002, slug: "base-b", nome: "Base B", ativo: true, created_at: null, updated_at: null };
const vinculoA = { id: 9001, cliente_id: 1, cliente_conta_id: 501, base_id: 7001, marketplace: "meli", ativo: true };
const vinculoB = { id: 9002, cliente_id: 1, cliente_conta_id: 502, base_id: 7002, marketplace: "meli", ativo: true };

class MockDb {
  constructor({ contas = [], vinculos = [], basesById = {} } = {}) {
    this.contas = contas;
    this.vinculos = vinculos;
    this.basesById = basesById;
  }
  async query(sql, params = []) {
    const q = String(sql).replace(/\s+/g, " ").trim();

    if (q.startsWith("SELECT id, nome, slug FROM clientes WHERE slug = $1 AND ativo = true")) {
      return { rows: cliente.slug === params[0] ? [cliente] : [] };
    }
    if (q.startsWith("SELECT id, nome, slug, ativo FROM clientes WHERE slug = $1")) {
      return { rows: cliente.slug === params[0] ? [cliente] : [] };
    }
    if (q.startsWith("SELECT id, nome, slug, ativo FROM clientes WHERE id = $1")) {
      return { rows: cliente.id === Number(params[0]) ? [cliente] : [] };
    }
    if (q.startsWith("SELECT * FROM cliente_contas WHERE id = $1")) {
      const row = this.contas.find((c) => c.id === Number(params[0]));
      return { rows: row ? [row] : [] };
    }
    if (q.startsWith("SELECT * FROM cliente_contas WHERE cliente_id = $1 AND marketplace = $2 AND ativo = true")) {
      const rows = this.contas.filter(
        (c) => c.cliente_id === Number(params[0]) && c.marketplace === params[1] && c.ativo !== false
      );
      return { rows };
    }
    if (q.includes("v.cliente_conta_id = $1 AND v.ativo = true")) {
      const v = this.vinculos.find((x) => x.cliente_conta_id === Number(params[0]) && x.ativo !== false);
      if (!v) return { rows: [] };
      const b = this.basesById[v.base_id];
      return { rows: [{ vinculo_id: v.id, base_id: v.base_id, slug: b.slug, nome: b.nome }] };
    }
    if (q.includes("b.ativo = true") && q.includes("v.cliente_id = $1")) {
      const rows = this.vinculos
        .filter((x) => x.cliente_id === Number(params[0]) && x.ativo !== false && x.marketplace === "meli")
        .map((v) => {
          const b = this.basesById[v.base_id];
          return b ? { ...b, cliente_conta_id: v.cliente_conta_id ?? null } : null;
        })
        .filter((b) => b && b.ativo !== false);
      return { rows };
    }
    if (q.includes("v.cliente_id = $1 AND v.marketplace = $2 AND v.ativo = true")) {
      const rows = this.vinculos
        .filter((x) => x.cliente_id === Number(params[0]) && x.marketplace === params[1] && x.ativo !== false)
        .map((v) => ({ vinculo_id: v.id, base_id: v.base_id, slug: this.basesById[v.base_id].slug, nome: this.basesById[v.base_id].nome }));
      return { rows: rows.slice(0, 1) };
    }
    return { rows: [] };
  }
}

function withMockDb(dbOpts, fn) {
  const original = pool.query;
  pool.query = (sql, params) => new MockDb(dbOpts).query(sql, params);
  return Promise.resolve()
    .then(fn)
    .finally(() => { pool.query = original; });
}

// deps que isolam TUDO que não é a resolução de conta (custos/vendas/ML) —
// não são o que está sendo testado aqui; só precisam não quebrar. `enrichBatch`
// recebe o `prepared` inteiro (inclui `mlUserId` e `base`, que o retorno de
// `carregarWorkspace` não expõe) — captura para provar, sem mudar o contrato
// de `carregarWorkspace`, que a conta resolvida internamente é a certa.
function depsSemNegocio(capturado) {
  return {
    carregarCustos: async () => ({ index: new Map(), total: 0 }),
    carregarVendas: async (args) => {
      if (capturado) capturado.carregarVendasArgs = args;
      return { sincronizado: false, pedidos: [], pedidosTodos: [], itens: [], componentes: [], importSnapshotAt: null };
    },
    agregarPorMlb: () => ({ porMlb: new Map(), reembolsoPorMlb: new Map(), naoAtribuido: { reembolso: 0 }, reembolsos: {} }),
    enrichBatch: async (prepared) => {
      if (capturado) capturado.mlUserId = prepared.mlUserId;
      return { totalItensMl: 0, itens: [] };
    },
  };
}

const PARAMS_BASE = { clienteSlug: "cliente-multi", dateFrom: "2026-08-01", dateTo: "2026-08-31", maxItens: 20 };

async function testeIntegracao() {
  // B1. single-account: continua funcionando sem clienteContaId (regressão).
  await withMockDb(
    { contas: [contaA], vinculos: [vinculoA], basesById: { 7001: baseA } },
    async () => {
      const capturado = {};
      const workspace = await service.carregarWorkspace({ ...PARAMS_BASE }, depsSemNegocio(capturado));
      ok("single-account: carregarWorkspace resolve sem clienteContaId (comportamento anterior preservado)",
        capturado.mlUserId === "AAA" && workspace.base.id === 7001);
    }
  );

  // B2. multi-account SEM clienteContaId: continua rejeitando com 409 MULTIPLE_MARKETPLACE_ACCOUNTS.
  await withMockDb(
    { contas: [contaA, contaB], vinculos: [vinculoA, vinculoB], basesById: { 7001: baseA, 7002: baseB } },
    async () => {
      await rejeitaCom(
        "multi-account sem clienteContaId: carregarWorkspace propaga 409 MULTIPLE_MARKETPLACE_ACCOUNTS (nunca escolhe em silêncio)",
        service.carregarWorkspace({ ...PARAMS_BASE }, depsSemNegocio()),
        (err) => err.statusCode === 409 && err.code === "MULTIPLE_MARKETPLACE_ACCOUNTS"
      );
    }
  );

  // B3. multi-account COM clienteContaId=A: resolve a conta A, nunca a B.
  await withMockDb(
    { contas: [contaA, contaB], vinculos: [vinculoA, vinculoB], basesById: { 7001: baseA, 7002: baseB } },
    async () => {
      const capturado = {};
      const workspace = await service.carregarWorkspace({ ...PARAMS_BASE, clienteContaId: 501 }, depsSemNegocio(capturado));
      ok("multi-account, clienteContaId=A: resolve mlUserId da conta A (AAA), não da B",
        capturado.mlUserId === "AAA");
      ok("multi-account, clienteContaId=A: resolve a base da conta A (7001), não a da B",
        workspace.base.id === 7001);
      ok("multi-account, clienteContaId=A: Central de Vendas recebe o MESMO clienteContaId (501), nunca outro",
        capturado.carregarVendasArgs?.clienteContaId === 501);
    }
  );

  // B4. multi-account COM clienteContaId=B: resolve a conta B, nunca a A — espelhado, prova que não é hardcode.
  await withMockDb(
    { contas: [contaA, contaB], vinculos: [vinculoA, vinculoB], basesById: { 7001: baseA, 7002: baseB } },
    async () => {
      const capturado = {};
      const workspace = await service.carregarWorkspace({ ...PARAMS_BASE, clienteContaId: 502 }, depsSemNegocio(capturado));
      ok("multi-account, clienteContaId=B: resolve mlUserId da conta B (BBB), não da A",
        capturado.mlUserId === "BBB");
      ok("multi-account, clienteContaId=B: resolve a base da conta B (7002), não a da A",
        workspace.base.id === 7002);
      ok("multi-account, clienteContaId=B: Central de Vendas recebe o MESMO clienteContaId (502), nunca outro",
        capturado.carregarVendasArgs?.clienteContaId === 502);
    }
  );

  // B5. clienteContaId de uma conta que não pertence ao cliente — erro estrutural propagado, nunca ignorado.
  const contaDeOutroCliente = { id: 999, cliente_id: 2, marketplace: "meli", nome: "Outro", slug: "outro", external_account_id: "ZZZ", is_primary: true, ativo: true, metadata_json: {}, created_at: null, updated_at: null };
  await withMockDb(
    { contas: [contaA, contaDeOutroCliente], vinculos: [vinculoA], basesById: { 7001: baseA } },
    async () => {
      await rejeitaCom(
        "clienteContaId de outro cliente: carregarWorkspace propaga 403 CONTA_NAO_PERTENCE_AO_CLIENTE",
        service.carregarWorkspace({ ...PARAMS_BASE, clienteContaId: 999 }, depsSemNegocio()),
        (err) => err.statusCode === 403
      );
    }
  );
}

async function run() {
  await testeUnitario();
  await testeIntegracao();
  console.log(`\nmotorMargemCarregarWorkspaceContaScoped.test.js: ${checks} verificações passaram.`);
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
