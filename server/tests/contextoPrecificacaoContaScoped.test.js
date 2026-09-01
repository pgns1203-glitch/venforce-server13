// server/tests/contextoPrecificacaoContaScoped.test.js
//
// D-8 (Convergência #4, mission §11): contextoPrecificacaoService era
// client-level — um cliente com Conta A → Base A e Conta B → Base B, com
// Conta B explicitamente selecionada, ainda enxergava as 2 bases do
// cliente e devolvia 424 BASE_AMBIGUA em vez de usar a base já resolvida
// para a Conta B por resolveMarketplaceAccountContext. Esta suíte prova a
// regra corrigida:
//
//   1. ClienteConta explícita + base própria → usa a base da conta, nunca
//      reabre ambiguidade client-level.
//   2. ClienteConta explícita sem base própria → BASE_AUSENTE (nunca
//      ambígua por causa da base de outra conta).
//   3. Sem ClienteConta explícita e SEM cliente_contas cadastradas (cliente
//      totalmente legado) + múltiplas bases → BASE_AMBIGUA preservada.
//   4. Legado single-account (1 única conta ativa, sem seleção explícita)
//      continua resolvendo a base dessa conta normalmente.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const pool = require("../config/database");
const Module = require("module");

const originalLoad = Module._load;
let GRANT_CONECTADO = false;
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

const { resolverContextoPrecificacao, MOTIVOS } = require("../services/automacoes/contextoPrecificacaoService");
const { CODIGOS_CANONICOS } = require("../utils/erroContextoCanonico");

Module._load = originalLoad;

let checks = 0;
function ok(label, condition) {
  assert.ok(condition, `FALHOU: ${label}`);
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

const cliente = { id: 1, nome: "Cliente Multi", slug: "cliente-multi", ativo: true };

// Fixture: Conta A (501, external 111) -> Base A (7001). Conta B (502,
// external 222) -> Base B (7002). Cenário legado separado (sem contas
// cadastradas) usa vínculos com cliente_conta_id = null.
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
    if (q.startsWith("SELECT COUNT(*)::int AS total FROM cliente_contas WHERE cliente_id = $1 AND marketplace = $2 AND ativo = true")) {
      const total = this.contas.filter(
        (c) => c.cliente_id === Number(params[0]) && c.marketplace === params[1] && c.ativo !== false
      ).length;
      return { rows: [{ total }] };
    }
    // obterBaseDaConta "direto": vínculo pela CONTA (cliente_conta_id).
    if (q.includes("v.cliente_conta_id = $1 AND v.ativo = true")) {
      const v = this.vinculos.find((x) => x.cliente_conta_id === Number(params[0]) && x.ativo !== false);
      if (!v) return { rows: [] };
      const b = this.basesById[v.base_id];
      return { rows: [{ vinculo_id: v.id, base_id: v.base_id, slug: b.slug, nome: b.nome }] };
    }
    // buscarBasesMeliDoCliente: TODAS as bases ativas do cliente (qualquer
    // conta), com cliente_conta_id do vínculo — usado pelo narrowing D-8.
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
    // obterBaseDaConta "legado_unico" / resolveMarketplaceAccountContext legado
    // (conta === null): vínculo por cliente_id + marketplace, sem filtro de conta.
    if (q.includes("v.cliente_id = $1 AND v.marketplace = $2 AND v.ativo = true")) {
      const rows = this.vinculos
        .filter((x) => x.cliente_id === Number(params[0]) && x.marketplace === params[1] && x.ativo !== false)
        .map((v) => ({ vinculo_id: v.id, base_id: v.base_id, slug: this.basesById[v.base_id].slug, nome: this.basesById[v.base_id].nome }));
      return { rows: rows.slice(0, 1) };
    }
    return { rows: [] };
  }
}

function withMockDb(dbOpts, grantConectado, fn) {
  const original = pool.query;
  GRANT_CONECTADO = grantConectado;
  pool.query = (sql, params) => new MockDb(dbOpts).query(sql, params);
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      pool.query = original;
      GRANT_CONECTADO = false;
    });
}

const contaA = { id: 501, cliente_id: 1, marketplace: "meli", nome: "Conta A", slug: "conta-a", external_account_id: "111", is_primary: true, ativo: true, metadata_json: {}, created_at: null, updated_at: null };
const contaB = { id: 502, cliente_id: 1, marketplace: "meli", nome: "Conta B", slug: "conta-b", external_account_id: "222", is_primary: false, ativo: true, metadata_json: {}, created_at: null, updated_at: null };

const baseA = { id: 7001, slug: "base-a", nome: "Base A", ativo: true, created_at: null, updated_at: null };
const baseB = { id: 7002, slug: "base-b", nome: "Base B", ativo: true, created_at: null, updated_at: null };

const vinculoA = { id: 9001, cliente_id: 1, cliente_conta_id: 501, base_id: 7001, marketplace: "meli", ativo: true };
const vinculoB = { id: 9002, cliente_id: 1, cliente_conta_id: 502, base_id: 7002, marketplace: "meli", ativo: true };

async function run() {
  // 1. Conta B explícita, cada conta com sua base — narrow para a base da
  //    conta B, nunca vê/considera a base A, nunca BASE_AMBIGUA.
  await withMockDb(
    { contas: [contaA, contaB], vinculos: [vinculoA, vinculoB], basesById: { 7001: baseA, 7002: baseB } },
    true,
    async () => {
      const ctx = await resolverContextoPrecificacao({ clienteSlugRaw: "cliente-multi", clienteContaId: 502 });
      ok("conta B explícita: pronto (nunca BASE_AMBIGUA por causa da base A)", ctx.pronto === true);
      ok("conta B explícita: usa a base B (7002)", ctx.base.id === 7002);
      ok("conta B explícita: motivo OK", ctx.motivo === MOTIVOS.OK);
    }
  );

  // 2. Conta A explícita — o inverso do teste 1, prova que não é hardcode.
  await withMockDb(
    { contas: [contaA, contaB], vinculos: [vinculoA, vinculoB], basesById: { 7001: baseA, 7002: baseB } },
    true,
    async () => {
      const ctx = await resolverContextoPrecificacao({ clienteSlugRaw: "cliente-multi", clienteContaId: 501 });
      ok("conta A explícita: usa a base A (7001), não a B", ctx.base.id === 7001);
    }
  );

  // 3. Conta B explícita, mas SEM vínculo de base próprio — BASE_AUSENTE,
  //    nunca ambígua (mesmo com a base A existindo para o cliente).
  await withMockDb(
    { contas: [contaA, contaB], vinculos: [vinculoA], basesById: { 7001: baseA } },
    true,
    async () => {
      const ctx = await resolverContextoPrecificacao({ clienteSlugRaw: "cliente-multi", clienteContaId: 502 });
      ok("conta B sem base própria: NÃO pronto", ctx.pronto === false);
      ok("conta B sem base própria: motivo BASE_AUSENTE (não ambígua)", ctx.motivo === MOTIVOS.BASE_MELI_NAO_VINCULADA);
    }
  );

  // 3b. Híbrido real (fixture de precificacaoServiceContaScoped.test.js /
  //     promocoesRetornoContaScoped.test.js): 2 contas ativas, mas a base
  //     ainda está vinculada só a nível de cliente (cliente_conta_id NULL,
  //     não migrada por conta). Não é "base de outra conta" — é vínculo
  //     legado sem dono específico — continua resolvendo para QUALQUER
  //     conta explícita do cliente, sem exigir migração de dado.
  const vinculoCompartilhado = { id: 9005, cliente_id: 1, cliente_conta_id: null, base_id: 7005, marketplace: "meli", ativo: true };
  const baseCompartilhada = { id: 7005, slug: "base-compartilhada", nome: "Base Compartilhada", ativo: true, created_at: null, updated_at: null };
  await withMockDb(
    { contas: [contaA, contaB], vinculos: [vinculoCompartilhado], basesById: { 7005: baseCompartilhada } },
    true,
    async () => {
      const ctxA = await resolverContextoPrecificacao({ clienteSlugRaw: "cliente-multi", clienteContaId: 501 });
      ok("híbrido: conta A explícita resolve a base compartilhada não migrada", ctxA.base?.id === 7005);
      const ctxB = await resolverContextoPrecificacao({ clienteSlugRaw: "cliente-multi", clienteContaId: 502 });
      ok("híbrido: conta B explícita também resolve a mesma base compartilhada", ctxB.base?.id === 7005);
    }
  );

  // 4. Sem conta explícita e SEM cliente_contas cadastradas (cliente
  //    totalmente legado, client-level) + múltiplas bases → BASE_AMBIGUA
  //    preservada (legado intacto).
  const vinculoLegadoX = { id: 9003, cliente_id: 1, cliente_conta_id: null, base_id: 7003, marketplace: "meli", ativo: true };
  const vinculoLegadoY = { id: 9004, cliente_id: 1, cliente_conta_id: null, base_id: 7004, marketplace: "meli", ativo: true };
  const baseX = { id: 7003, slug: "base-x", nome: "Base X", ativo: true, created_at: null, updated_at: null };
  const baseY = { id: 7004, slug: "base-y", nome: "Base Y", ativo: true, created_at: null, updated_at: null };
  await withMockDb(
    { contas: [], vinculos: [vinculoLegadoX, vinculoLegadoY], basesById: { 7003: baseX, 7004: baseY } },
    true,
    async () => {
      const ctx = await resolverContextoPrecificacao({ clienteSlugRaw: "cliente-multi", clienteContaId: null });
      ok("legado sem cliente_contas, 2 bases: NÃO pronto", ctx.pronto === false);
      ok("legado sem cliente_contas, 2 bases: motivo BASE_AMBIGUA preservado", ctx.motivo === MOTIVOS.MULTIPLAS_BASES_MELI);
    }
  );

  // 5. Legado single-account: 1 única conta ativa, SEM seleção explícita —
  //    continua resolvendo a base dessa conta automaticamente (não regride).
  await withMockDb(
    { contas: [contaA], vinculos: [vinculoA], basesById: { 7001: baseA } },
    true,
    async () => {
      const ctx = await resolverContextoPrecificacao({ clienteSlugRaw: "cliente-multi", clienteContaId: null });
      ok("single-account legado: pronto sem seleção explícita", ctx.pronto === true);
      ok("single-account legado: resolve a base da única conta ativa", ctx.base.id === 7001);
    }
  );

  // 6. 2+ contas ativas SEM seleção explícita: propagação do 409 estrutural
  //    de resolveMarketplaceAccountContext é preservada (comportamento
  //    pré-existente, não regride com este fix).
  await withMockDb(
    { contas: [contaA, contaB], vinculos: [vinculoA, vinculoB], basesById: { 7001: baseA, 7002: baseB } },
    true,
    async () => {
      await rejeitaCom(
        "2+ contas ativas sem clienteContaId → 409 MULTIPLE_MARKETPLACE_ACCOUNTS, nunca escolhe em silêncio",
        resolverContextoPrecificacao({ clienteSlugRaw: "cliente-multi", clienteContaId: null }),
        (err) => err.statusCode === 409 && err.code === "MULTIPLE_MARKETPLACE_ACCOUNTS"
      );
    }
  );

  console.log(`\ncontextoPrecificacaoContaScoped.test.js: ${checks} verificações passaram.`);
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
