const assert = require("assert");
const fs = require("fs");
const path = require("path");

const { READINESS_WEIGHTS, buildReadinessSnapshot } = require("../services/dashboardService");

let checks = 0;
function ok(label, condition) {
  assert.ok(condition, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}
function eq(label, actual, expected) {
  assert.strictEqual(actual, expected, `${label}: ${actual} !== ${expected}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

console.log("\n▸ Dashboard summary — prontidão e estrutura segura");
eq("peso cliente preservado", READINESS_WEIGHTS.client, 12);
eq("peso canal preservado", READINESS_WEIGHTS.channel, 10);
eq("peso base preservado", READINESS_WEIGHTS.base, 18);
eq("peso grant preservado", READINESS_WEIGHTS.grant, 18);
eq("peso diagnóstico preservado", READINESS_WEIGHTS.diagnosis, 14);
eq("peso fechamento preservado", READINESS_WEIGHTS.closing, 8);
eq("peso Ads preservado", READINESS_WEIGHTS.ads, 10);
eq("peso frete preservado", READINESS_WEIGHTS.freight, 10);
eq("pesos ML totalizam 100", Object.values(READINESS_WEIGHTS).reduce((sum, value) => sum + value, 0), 100);

const complete = buildReadinessSnapshot({
  id: 1, slug: "cliente", marketplaces: ["meli"], has_base: true,
  ml_grant_connected: true, has_diagnosis: true, has_closing: true,
  has_ads: true, has_freight: true,
});
eq("setup ML completo vale 100", complete.score, 100);
eq("setup completo é pronto", complete.status, "healthy");

const root = path.join(__dirname, "..", "..");
const html = fs.readFileSync(path.join(root, "Portal", "dashboard.html"), "utf8");
const js = fs.readFileSync(path.join(root, "Portal", "dashboard.js"), "utf8");
const css = fs.readFileSync(path.join(root, "Portal", "css", "pages", "dashboard-v2.css"), "utf8");
const layout = fs.readFileSync(path.join(root, "Portal", "layout.js"), "utf8");
const clientesJs = fs.readFileSync(path.join(root, "Portal", "clientes.js"), "utf8");
const mlController = fs.readFileSync(path.join(root, "server", "controllers", "mlController.js"), "utf8");
const index = fs.readFileSync(path.join(root, "server", "index.js"), "utf8");

ok("Dashboard usa tokens oficiais", html.includes("css/vf-tokens-v2.css"));
ok("Dashboard usa componentes oficiais", html.includes("css/vf-components-v2.css"));
ok("Dashboard usa CSS escopado", html.includes("css/pages/dashboard-v2.css") && css.includes(".vf-page-dashboard"));
ok("Dashboard não carrega design system intermediário", !html.includes("venforce-ui-v2.css"));
ok("Dashboard não mantém bloco style inline", !/<style[\s>]/i.test(html));
ok("tabela tem caption e cabeçalhos com scope", /<caption[^>]*>/.test(html) && /<th[^>]*scope="col"/.test(html));
ok("frontend faz uma única família de GET", js.includes("/dashboard/summary") && !js.includes("/admin/ml-tokens") && !js.includes("/automacoes/relatorios") && !js.includes("/bases"));
ok("frontend não contém clientes demo", !/(Barnato|Norte Tools|CEAS Modas)/i.test(js + html));
ok("marketplace permanece desabilitado até cobertura uniforme", html.includes('id="dash-marketplace" disabled'));
ok("Copiar link ML exige três condições", js.includes("client.has_ml === true && client.ml_grant_connected === false && readiness.can_copy_ml_link === true"));
const footerTemplate = layout.match(/footer\.innerHTML\s*=\s*`([\s\S]*?)`;\s*const footerAvatar/)?.[1] || "";
ok("footer compartilhado não interpola nome/email em innerHTML", !!footerTemplate && !/user\.(nome|email)/.test(footerTemplate));
ok("listagem ML não seleciona tokens completos", !/SELECT[\s\S]{0,500}t\.access_token\s*,\s*t\.refresh_token/.test(mlController));
ok("listagem de clientes não seleciona api_key", !/SELECT id, nome, slug, api_key, ativo, created_at FROM clientes/.test(index));
ok("tela de clientes não grava segredo no DOM", !clientesJs.includes("data-apikey"));

const dashboardRoutes = require("../routes/dashboardRoutes");
const layer = dashboardRoutes.stack.find((item) => item.route?.path === "/summary");
ok("GET /summary existe", !!layer && layer.route.methods.get);
const middlewareNames = layer.route.stack.map((item) => item.handle.name);
eq("rota exige autenticação primeiro", middlewareNames[0], "authMiddleware");
eq("rota preserva gate de Automações", middlewareNames[1], "requireAutomacoesAccess");

console.log(`\n✓ dashboardSummary.test.js: ${checks} verificações passaram`);
