// server/tests/authzCoverageWiring.test.js
//
// P2.1 — prova que os routers dos módulos legados montam o seam de carteira
// (carteiraClienteGuard / carteiraClienteContaGuard) nas rotas client-scoped,
// depois do gate de role. Introspecção de router.stack — mesmo padrão de
// fullRoutes.test.js.
//
// O COMPORTAMENTO do seam (403/404, admin bypass, seller) é coberto por
// authzCoverageSeam.test.js e pelos testes de matriz por módulo.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";
process.env.FULL_CENTRAL_ENABLED = "true";

const assert = require("assert");

let checks = 0;
function ok(label, cond) { assert.ok(cond, `FALHOU: ${label}`); checks += 1; console.log(`  ok  ${label}`); }

// Retorna os nomes dos handlers da rota que casa method+path.
function handlersDe(router, method, path) {
  for (const layer of router.stack) {
    if (!layer.route) continue;
    if (layer.route.path !== path) continue;
    if (method && !layer.route.methods[method.toLowerCase()]) continue;
    return layer.route.stack.map((l) => l.handle.name || "(anon)");
  }
  return null;
}

function temCarteira(names) {
  return Array.isArray(names) && names.includes("carteiraClienteGuard");
}
function temCarteiraConta(names) {
  return Array.isArray(names) && names.includes("carteiraClienteContaGuard");
}
// o seam roda DEPOIS do gate de role
function ordemOk(names, guard) {
  if (!Array.isArray(names)) return false;
  const iRole = names.indexOf("requireAutomacoesAccess");
  const iGuard = names.indexOf(guard);
  if (iGuard === -1) return false;
  return iRole === -1 || iRole < iGuard;
}

function run() {
  // ── Central de Vendas ──
  {
    const r = require("../routes/centralVendasRoutes");
    const rotas = [
      ["get", "/:slug"],
      ["get", "/:slug/read"],
      ["get", "/:slug/read/orders/:rowId"],
      ["get", "/:slug/read/bootstrap"],
      ["get", "/:slug/read/daily"],
      ["get", "/:slug/read/products"],
      ["get", "/:slug/read/mercado-pago/reconciliation"],
      ["post", "/:slug/importar-vendas"],
      ["post", "/:slug/sincronizar"],
      ["post", "/:slug/sync-runs"],
      ["get", "/:slug/sync-runs/:runId"],
      ["get", "/:slug/sync-runs"],
      ["get", "/:slug/sync-runs/:runId/mercado-pago/reconciliation"],
      ["post", "/:slug/sync-runs/:runId/mercado-pago/settlement"],
    ];
    for (const [m, p] of rotas) {
      const names = handlersDe(r, m, p);
      ok(`central-vendas ${m.toUpperCase()} ${p} tem carteiraClienteGuard`, temCarteira(names));
      ok(`central-vendas ${m.toUpperCase()} ${p} — seam depois do gate de role`, ordemOk(names, "carteiraClienteGuard"));
    }
  }

  // ── Central de Margem ──
  {
    const r = require("../routes/motorMargemRoutes");
    const rotas = [
      ["get", "/:clienteSlug/contexto"],
      ["get", "/:clienteSlug/resumo"],
      ["get", "/:clienteSlug/workspace"],
      ["get", "/:clienteSlug/itens"],
      ["get", "/:clienteSlug/itens/:itemId/evidencias"],
      ["get", "/:clienteSlug/itens/:itemId"],
      ["get", "/:clienteSlug"],
    ];
    for (const [m, p] of rotas) {
      const names = handlersDe(r, m, p);
      ok(`central-margem ${m.toUpperCase()} ${p} tem carteiraClienteGuard`, temCarteira(names));
      ok(`central-margem ${m.toUpperCase()} ${p} — seam depois do gate de role`, ordemOk(names, "carteiraClienteGuard"));
    }
  }

  // ── Full (contas por clienteContaId) ──
  {
    const r = require("../routes/fullRoutes");
    const rotas = [
      "/contas/:clienteContaId/snapshot",
      "/contas/:clienteContaId/inventories/:inventoryId/movements",
      "/contas/:clienteContaId/inventories/:inventoryId",
    ];
    for (const p of rotas) {
      const names = handlersDe(r, "get", p);
      ok(`full GET ${p} tem carteiraClienteContaGuard`, temCarteiraConta(names));
      ok(`full GET ${p} — seam depois do gate de role`, ordemOk(names, "carteiraClienteContaGuard"));
    }
  }

  // ── GET /cliente-contas/:id e derivadas por id de conta ──
  {
    const r = require("../routes/clienteContasRoutes");
    const rotas = [
      ["get", "/cliente-contas/:id"],
      ["get", "/cliente-contas/:id/base"],
      ["get", "/cliente-contas/:id/bases-elegiveis"],
    ];
    for (const [m, p] of rotas) {
      const names = handlersDe(r, m, p);
      ok(`cliente-contas ${m.toUpperCase()} ${p} tem carteiraClienteContaGuard`, temCarteiraConta(names));
      ok(`cliente-contas ${m.toUpperCase()} ${p} — seam depois do gate de role`, ordemOk(names, "carteiraClienteContaGuard"));
    }
    // a rota já protegida por carteira de cliente continua com o guard de cliente
    const listar = handlersDe(r, "get", "/clientes/:cliente/contas");
    ok("cliente-contas GET /clientes/:cliente/contas mantém carteiraClienteGuard", temCarteira(listar));
  }

  // ── Ads (clienteSlug em query/body, por rota) ──
  {
    const r = require("../routes/adsRoutes");
    const rotas = [
      ["get", "/performance"],
      ["get", "/acompanhamento"],
      ["put", "/acompanhamento"],
      ["get", "/resumo-mensal"],
      ["put", "/resumo-mensal"],
    ];
    for (const [m, p] of rotas) {
      const names = handlersDe(r, m, p);
      ok(`ads ${m.toUpperCase()} ${p} tem carteiraClienteGuard`, temCarteira(names));
      ok(`ads ${m.toUpperCase()} ${p} — seam depois do gate de role`, ordemOk(names, "carteiraClienteGuard"));
    }
    // a lista global não é client-scoped
    ok("ads GET /clientes NÃO tem seam de carteira (lista global)", !temCarteira(handlersDe(r, "get", "/clientes")));
  }

  // ── Métricas e Anúncios ML: seam no nível do router (router.use) ──
  function usaCarteiraNoRouter(router) {
    return router.stack.some((l) => !l.route && l.handle && l.handle.name === "carteiraClienteGuard");
  }
  function ordemRouterOk(router) {
    const idxRole = router.stack.findIndex((l) => !l.route && l.handle && l.handle.name === "requireAutomacoesAccess");
    const idxGuard = router.stack.findIndex((l) => !l.route && l.handle && l.handle.name === "carteiraClienteGuard");
    return idxGuard !== -1 && idxRole !== -1 && idxRole < idxGuard;
  }
  {
    const r = require("../routes/metricasRoutes");
    ok("métricas: carteiraClienteGuard no router", usaCarteiraNoRouter(r));
    ok("métricas: seam depois do requireAutomacoesAccess", ordemRouterOk(r));
  }
  {
    const r = require("../routes/meliAnunciosRoutes");
    ok("anúncios-ml: carteiraClienteGuard no router", usaCarteiraNoRouter(r));
    ok("anúncios-ml: seam depois do requireAutomacoesAccess", ordemRouterOk(r));
  }

  // ── Automações (client-scoped) ──
  {
    const r = require("../routes/automacoesRoutes");
    const rotas = [
      "/automacoes/precificacao/preview",
      "/automacoes/precificacao/preview-ml",
      "/automacoes/clientes/:clienteSlug/planilha-precificacao.xlsx",
      "/automacoes/clientes/:clienteSlug/modelo-base-custos.xlsx",
      "/automacoes/promocoes-retorno/preview",
      "/automacoes/promocoes-retorno/snapshot",
      "/automacoes/promocoes-retorno/diagnostico/start",
      "/automacoes/diagnostico-completo/start",
      "/automacoes/relatorios",
    ];
    for (const p of rotas) {
      const names = handlersDe(r, null, p);
      ok(`automações ${p} tem carteiraClienteGuard`, temCarteira(names));
      ok(`automações ${p} — seam depois do gate de role`, ordemOk(names, "carteiraClienteGuard"));
    }
    ok("automações GET /automacoes/clientes NÃO tem seam (lista global)", !temCarteira(handlersDe(r, "get", "/automacoes/clientes")));
  }

  console.log(`\nauthzCoverageWiring.test.js: ${checks} verificações passaram.`);
}

run();
