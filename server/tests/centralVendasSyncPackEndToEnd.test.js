// server/tests/centralVendasSyncPackEndToEnd.test.js
//
// Frete de PACK (shipment compartilhado) FIM-A-FIM pelo ponto de entrada mais alto do sync,
// no mesmo padrão de centralVendasClaimsShipmentEndToEnd.test.js: roda sincronizarVendasMeli de
// verdade (só mlFetch é estubado, por rota; repositório falso; accountContext pronto) com um ML
// falso cobrindo /orders/search, /shipments/:id/costs, GET /packs/:id e GET /orders/:id.
// Prova a passagem fetchAllOrders → resolverPacksDoRun → buildMotorFromOrders → persistência,
// os componentes persistidos e as contagens do resumo. Sem banco, sem rede: qualquer chamada que
// não case com uma rota do mock é registrada em `fugiu` e derruba o teste.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://127.0.0.1:1/x";

const assert = require("assert");
const Module = require("module");
const fx = require("./fixtures/centralFretePackFixtures");
const golden = require("./fixtures/centralFretePackGolden.json");

let checks = 0;
function ok(label, condition) { assert.ok(condition, `FALHOU: ${label}`); checks += 1; console.log(`  ok  ${label}`); }
function eq(label, actual, expected) { assert.deepStrictEqual(actual, expected, `FALHOU: ${label} — recebido ${JSON.stringify(actual)}`); checks += 1; console.log(`  ok  ${label}`); }

const cliente = { id: 1, nome: "Loja E2E", slug: "loja-e2e" };
const SELLER = "111";
const ACCOUNT_CONTEXT = { mlUserId: SELLER, base: null };
const PERIODO = { dateFrom: "2026-10-01", dateTo: "2026-10-31" };

// ML falso por rota. Estuba só utils/mlClient (os módulos sync/claims/frete destruturam mlFetch no
// topo; o cache dos 3 é invalidado junto — mesmo cuidado do teste de claims).
function criarMl({ orders, shipments = {}, packs = {}, externos = [], packStatus = null }) {
  const chamadas = [];
  const fugiu = [];
  const handler = async (path, options) => {
    chamadas.push({ path, options });
    if (path.startsWith("/orders/search")) {
      return { ok: true, status: 200, data: { results: orders, paging: { total: orders.length } } };
    }
    const msh = /^\/shipments\/(\d+)\/costs/.exec(path);
    if (msh) {
      const f = shipments[msh[1]];
      return f
        ? { ok: true, status: 200, data: { senders: [{ user_id: Number(options.mlUserId), cost: f.cost }], receiver: { cost: f.receita } } }
        : { ok: false, status: 404, data: null };
    }
    const mpk = /^\/packs\/(\d+)$/.exec(path);
    if (mpk) {
      if (packStatus) return { ok: false, status: packStatus, data: null };
      const k = packs[mpk[1]];
      return k
        ? { ok: true, status: 200, data: { id: Number(mpk[1]), shipment: { id: k.shipment }, orders: k.orders.map((id) => ({ id })) } }
        : { ok: false, status: 404, data: null };
    }
    const mor = /^\/orders\/(\d+)$/.exec(path);
    if (mor) {
      const o = externos.find((x) => String(x.id) === mor[1]);
      return o ? { ok: true, status: 200, data: o } : { ok: false, status: 404, data: null };
    }
    // Pós-venda: o sync consulta claims/returns; sem dados aqui (a cobertura é de outro teste).
    if (path.startsWith("/post-purchase/")) return { ok: true, status: 200, data: { paging: { total: 0 }, data: [] } };
    fugiu.push(path);
    return { ok: false, status: 599, data: null };
  };
  return { handler, chamadas, fugiu };
}

function carregar(ml) {
  const originalLoad = Module._load;
  Module._load = function loadWithStub(request, parent, isMain) {
    if (request === "../../utils/mlClient") {
      return { async mlFetch(_clienteId, path, options = {}) { return ml.handler(path, options); } };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    for (const m of ["centralVendasSyncService", "centralVendasClaimsService", "centralVendasFreteService"]) {
      delete require.cache[require.resolve(`../services/centralVendas/${m}`)];
    }
    return require("../services/centralVendas/centralVendasSyncService");
  } finally {
    Module._load = originalLoad;
  }
}

function fakeRepo() {
  return {
    persistedCalls: [],
    async ensureCentralVendasTables() {},
    async getClienteBySlug(slug) { return slug === cliente.slug ? cliente : null; },
    async persistCentralVendasImport(args) {
      this.persistedCalls.push(args);
      return {
        importacao: { id: this.persistedCalls.length },
        pedidosPersistidos: args.motorPayload.pedidos.length,
        itensPersistidos: args.motorPayload.itens.length,
        componentesPersistidos: args.motorPayload.componentes.length,
      };
    },
  };
}

async function rodar(ml) {
  const repo = fakeRepo();
  const { createCentralVendasSyncService } = carregar(ml);
  const { sincronizarVendasMeli } = createCentralVendasSyncService(repo, {});
  const original = console.log;
  const originalWarn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  let resultado;
  try {
    resultado = await sincronizarVendasMeli({ clienteSlug: cliente.slug, marketplace: "meli", accountContext: ACCOUNT_CONTEXT, ...PERIODO });
  } finally {
    console.log = original;
    console.warn = originalWarn;
  }
  const motor = repo.persistedCalls.flatMap((c) => c.motorPayload.componentes);
  const pedidos = repo.persistedCalls.flatMap((c) => c.motorPayload.pedidos);
  return { resultado, repo, componentes: motor, pedidos };
}

const comp = (r, tipo) => r.componentes.filter((c) => c.tipo === tipo);
const soma = (lista) => Math.round(lista.reduce((s, c) => s + Math.abs(c.valor ?? 0), 0) * 100);
const ordem = (id, itens, extra = {}) => ({
  ...fx.pedido(id, { shipment: 7001, pack: 8001, itens, ...extra }),
  seller: { id: Number(SELLER) },
});

(async () => {
  // ── 1) pack com 2 pedidos no run ─────────────────────────────────────────
  console.log("\n▸ 1. pack com 2 pedidos no run (shipment: frete 30 / receita de envio 10)");
  {
    const P1 = ordem(2001, [["MLB100", 2, 100, 12.5]]); // receita 200
    const P2 = ordem(2002, [["MLB200", 1, 100, 10]]);   // receita 100
    const ml = criarMl({ orders: [P1, P2], shipments: { 7001: { cost: 30, receita: 10 } }, packs: { 8001: { shipment: 7001, orders: [2001, 2002] } } });
    const r = await rodar(ml);
    eq("Σ frete_seller persistido == 30,00 (antes: 60,00)", soma(comp(r, "frete_seller")), 3000);
    eq("Σ receita_envio persistida == 10,00 (antes: 20,00)", soma(comp(r, "receita_envio")), 1000);
    eq("rateio pela receita: 20,00 / 10,00", comp(r, "frete_seller").map((c) => [c.pedidoId, c.valor]), [["2001", -20], ["2002", -10]]);
    ok("obs registra o rateio de pack", comp(r, "frete_seller").every((c) => /compartilhado por 2 pedidos, rateado pela receita/.test(c.obs)));
    ok("pedido persistido carrega envioCompartilhadoPor", r.pedidos.every((p) => p.envioCompartilhadoPor === 2));
    eq("resumo de packs do resultado", [r.resultado.packs.packsConsultados, r.resultado.packs.packsIncompletos, r.resultado.packs.irmaosBuscados, r.resultado.packs.chamadas], [1, 0, 0, 1]);
    eq("chamadas: 1 /packs, 1 /shipments (cache por shipment), 0 /orders/:id", [ml.chamadas.filter((c) => /^\/packs\//.test(c.path)).length, ml.chamadas.filter((c) => /^\/shipments\//.test(c.path)).length, ml.chamadas.filter((c) => /^\/orders\/\d+$/.test(c.path)).length], [1, 1, 0]);
    ok("mlUserId da conta em /packs", ml.chamadas.filter((c) => /^\/packs\//.test(c.path)).every((c) => String(c.options.mlUserId) === SELLER));
    eq("nenhuma chamada fugiu do mock", ml.fugiu, []);
  }

  // ── 2) irmão FORA do run, cancelado ──────────────────────────────────────
  console.log("\n▸ 2. irmão fora do run (obtido por /orders/:id, cancelado) ⇒ o pedido do run leva 100%");
  {
    const P1 = ordem(2101, [["MLB100", 1, 100, 12.5]]);
    const P2 = { ...ordem(2102, [["MLB200", 1, 100, 10]]), status: "cancelled" };
    const ml = criarMl({ orders: [P1], externos: [P2], shipments: { 7001: { cost: 30, receita: 10 } }, packs: { 8001: { shipment: 7001, orders: [2101, 2102] } } });
    const r = await rodar(ml);
    eq("pedido do run leva os 30,00 e a receita de envio 10,00", [comp(r, "frete_seller").map((c) => c.valor), comp(r, "receita_envio").map((c) => c.valor)], [[-30], [10]]);
    eq("resumo: 1 pack, 0 incompletos, 1 irmão buscado, 2 chamadas", [r.resultado.packs.packsConsultados, r.resultado.packs.packsIncompletos, r.resultado.packs.irmaosBuscados, r.resultado.packs.chamadas], [1, 0, 1, 2]);
    ok("/orders/2102 chamado com o mlUserId da conta", ml.chamadas.some((c) => c.path === "/orders/2102" && String(c.options.mlUserId) === SELLER));
    eq("nenhuma chamada fugiu do mock", ml.fugiu, []);
  }

  // ── 3) irmão externo PAGO ────────────────────────────────────────────────
  console.log("\n▸ 3. irmão externo pago (claims dele não estão no contexto) ⇒ frete NULL + frete_pack_incompleto");
  {
    const P1 = ordem(2201, [["MLB100", 1, 100, 12.5]]);
    const P2 = ordem(2202, [["MLB200", 1, 100, 10]]); // paid, fora do run
    const ml = criarMl({ orders: [P1], externos: [P2], shipments: { 7001: { cost: 30, receita: 10 } }, packs: { 8001: { shipment: 7001, orders: [2201, 2202] } } });
    const r = await rodar(ml);
    ok("frete_seller e receita_envio NULL (nunca cheio, nunca 0)", [...comp(r, "frete_seller"), ...comp(r, "receita_envio")].every((c) => c.valor === null));
    ok("pendência frete_pack_incompleto no pedido", r.pedidos[0].pendencias.includes("frete_pack_incompleto"));
    eq("resumo: 1 pack incompleto, 1 irmão buscado, 1 externo com pós-venda incerto", [r.resultado.packs.packsConsultados, r.resultado.packs.packsIncompletos, r.resultado.packs.irmaosBuscados, r.resultado.packs.irmaosExternosComPosVendaIncerto], [1, 1, 1, 1]);
    eq("nenhuma chamada fugiu do mock", ml.fugiu, []);
  }

  // ── 4) /packs falha ──────────────────────────────────────────────────────
  console.log("\n▸ 4. GET /packs falha (503) ⇒ frete NULL + pendência, nunca o valor cheio");
  {
    const P1 = ordem(2301, [["MLB100", 1, 100, 12.5]]);
    const P2 = ordem(2302, [["MLB200", 1, 100, 10]]);
    const ml = criarMl({ orders: [P1, P2], shipments: { 7001: { cost: 30, receita: 10 } }, packStatus: 503 });
    const r = await rodar(ml);
    ok("todos os componentes de frete e receita de envio NULL", [...comp(r, "frete_seller"), ...comp(r, "receita_envio")].every((c) => c.valor === null));
    ok("pendência frete_pack_incompleto em ambos os pedidos", r.pedidos.length === 2 && r.pedidos.every((p) => p.pendencias.includes("frete_pack_incompleto")));
    eq("resumo: 1 pack consultado, 1 incompleto, 0 irmãos, 3 tentativas (retry com backoff)", [r.resultado.packs.packsConsultados, r.resultado.packs.packsIncompletos, r.resultado.packs.irmaosBuscados, r.resultado.packs.chamadas], [1, 1, 0, 3]);
    eq("nenhuma chamada fugiu do mock", ml.fugiu, []);
  }

  // ── 5) pedidos simples: idênticos ao golden de f9c5fea9 ──────────────────
  console.log("\n▸ 5. pedidos simples (1 pedido/shipment) ⇒ frete e receita de envio IDÊNTICOS ao golden (motor de f9c5fea9)");
  {
    const orders = fx.ordersIndependentes().map((o) => ({ ...o, seller: { id: Number(SELLER) } }));
    // 5001: 18,40 / receita 0; 5002 (pack_id próprio, 1 pedido): 12,35 / 7,90; 5003: sem custo de frete (ausente)
    const ml = criarMl({
      orders,
      shipments: { 5001: { cost: 18.4, receita: 0 }, 5002: { cost: 12.35, receita: 7.9 } },
      packs: { 9001: { shipment: 5002, orders: [1002] } },
    });
    const r = await rodar(ml);
    const proj = (c) => ({ pedidoId: c.pedidoId, itemId: c.itemId, tipo: c.tipo, valor: c.valor, fonte: c.fonte, confianca: c.confianca, obs: c.obs });
    const tipos = new Set(["frete_seller", "receita_envio"]);
    const esperado = golden.componentes.filter((c) => tipos.has(c.tipo)).map(proj);
    const obtido = r.componentes.filter((c) => tipos.has(c.tipo)).map(proj);
    eq("componentes frete_seller/receita_envio == golden (byte a byte)", obtido, esperado);
    ok("nenhum pedido simples recebeu obs/campo de envio compartilhado", r.pedidos.every((p) => p.envioCompartilhadoPor === undefined));
    eq("pack de 1 pedido (pack_id próprio): 1 /packs, nenhum incompleto, 0 irmãos", [r.resultado.packs.packsConsultados, r.resultado.packs.packsIncompletos, r.resultado.packs.irmaosBuscados, r.resultado.packs.chamadas], [1, 0, 0, 1]);
    eq("só o pedido com pack_id consultou /packs", ml.chamadas.filter((c) => /^\/packs\//.test(c.path)).map((c) => c.path), ["/packs/9001"]);
    eq("nenhuma chamada fugiu do mock", ml.fugiu, []);
  }

  console.log(`\n${checks} verificações passaram.`);
})().catch((err) => { console.error(err); process.exit(1); });
