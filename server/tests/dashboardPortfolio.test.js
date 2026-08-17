const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
  buildReadinessSnapshot,
  createDashboardService,
  selectAuthorizedClients,
} = require("../services/dashboardService");

let checks = 0;
function eq(label, actual, expected) {
  assert.deepStrictEqual(actual, expected, `${label}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}
function ok(label, condition) {
  assert.ok(condition, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

const authorized = [
  { id: 1, slug: "cliente-a", nome: "Cliente A" },
  { id: 2, slug: "cliente-b", nome: "Cliente B" },
  { id: 3, slug: "cliente-c", nome: "Cliente C" },
];

console.log("\n▸ Dashboard Carteira — autorização e seleção");
eq("sem filtro mantém a carteira A/B/C", selectAuthorizedClients(authorized, []).map((c) => c.slug), ["cliente-a", "cliente-b", "cliente-c"]);
eq("filtro A/B reduz a carteira", selectAuthorizedClients(authorized, ["cliente-a", "cliente-b"]).map((c) => c.slug), ["cliente-a", "cliente-b"]);
eq("slug X não autorizado nunca aparece", selectAuthorizedClients(authorized, ["cliente-a", "cliente-x"]).map((c) => c.slug), ["cliente-a"]);
eq("seleção somente não autorizada fica vazia", selectAuthorizedClients(authorized, ["cliente-x"]), []);

console.log("\n▸ Dashboard Carteira — prontidão canônica");
const mlSemGrant = buildReadinessSnapshot({
  slug: "cliente-a", nome: "Cliente A", marketplaces: ["meli"],
  has_base: true, ml_grant_connected: false, has_diagnosis: true,
  has_closing: false, has_ads: false, has_freight: false,
});
eq("ML sem grant marca grant pendente", mlSemGrant.items.find((i) => i.key === "grant").done, false);
eq("grant pendente é sempre danger", mlSemGrant.items.find((i) => i.key === "grant").severity, "danger");
eq("ML sem grant permite copiar link", mlSemGrant.can_copy_ml_link, true);

const mlComGrant = buildReadinessSnapshot({
  slug: "cliente-b", nome: "Cliente B", marketplaces: ["meli"],
  has_base: true, ml_grant_connected: true, has_diagnosis: true,
  has_closing: true, has_ads: true, has_freight: true,
});
eq("ML com grant conclui requisito", mlComGrant.items.find((i) => i.key === "grant").done, true);
eq("item concluído é success", mlComGrant.items.find((i) => i.key === "grant").severity, "success");
eq("ML com grant oculta copiar link", mlComGrant.can_copy_ml_link, false);

for (const marketplace of ["shopee", "tiktok"]) {
  const readiness = buildReadinessSnapshot({
    slug: marketplace, nome: marketplace, marketplaces: [marketplace],
    has_base: true, ml_grant_connected: false, has_diagnosis: true,
    has_closing: false, has_ads: false, has_freight: false,
  });
  ok(`${marketplace} não recebe grant ML fictício`, !readiness.items.some((i) => i.key === "grant"));
  eq(`${marketplace} oculta copiar link`, readiness.can_copy_ml_link, false);
}

const grantDesconhecido = buildReadinessSnapshot({
  slug: "cliente-u", nome: "Cliente U", marketplaces: ["meli"],
  has_base: false, ml_grant_connected: null, has_diagnosis: false,
  has_closing: false, has_ads: false, has_freight: false,
});
eq("grant desconhecido oculta copiar link", grantDesconhecido.can_copy_ml_link, false);

const scoreAltoSemGrant = buildReadinessSnapshot({
  slug: "alto", nome: "Alto", marketplaces: ["meli"],
  has_base: true, ml_grant_connected: false, has_diagnosis: true,
  has_closing: true, has_ads: true, has_freight: true,
});
eq("grant pendente não muda com score geral", scoreAltoSemGrant.items.find((i) => i.key === "grant").severity, "danger");
eq("fechamento pendente permanece warning", mlSemGrant.items.find((i) => i.key === "closing").severity, "warning");

console.log("\n▸ Dashboard Carteira — summary filtrado");
const rows = [
  { ...authorized[0], marketplaces: ["meli"], revenue: 100, margin: 0.10, has_base: true, ml_grant_connected: false, has_diagnosis: true, has_closing: false, has_ads: true, has_freight: false },
  { ...authorized[1], marketplaces: ["shopee"], revenue: 300, margin: 0.20, has_base: true, ml_grant_connected: null, has_diagnosis: true, has_closing: true, has_ads: true, has_freight: true },
  { ...authorized[2], marketplaces: ["tiktok"], revenue: null, margin: null, has_base: false, ml_grant_connected: null, has_diagnosis: false, has_closing: false, has_ads: false, has_freight: false },
];

const service = createDashboardService(null, {
  now: () => new Date("2026-08-17T12:00:00.000Z"),
  resolvePortfolio: async () => authorized,
  loadData: async ({ clients }) => rows.filter((row) => clients.some((client) => client.id === row.id)),
});

(async () => {
  const one = await service.getSummary({ user: { id: 9, role: "membro" }, period: "30d", clientes: "cliente-a" });
  eq("seleção de um cliente atualiza contagem", one.scope.selected_count, 1);
  eq("seleção de um cliente atualiza faturamento", one.metrics.revenue.value, 100);
  eq("seleção de um cliente não vaza outro cliente", one.portfolio.clients.map((c) => c.slug), ["cliente-a"]);

  const multiple = await service.getSummary({ user: { id: 9, role: "membro" }, period: "30d", clientes: "cliente-a,cliente-b,cliente-x" });
  eq("seleção múltipla soma apenas autorizados", multiple.metrics.revenue.value, 400);
  eq("summary informa total autorizado", multiple.scope.total_authorized, 3);
  eq("summary informa selecionados", multiple.scope.selected_count, 2);
  eq("X não aparece na seleção efetiva", multiple.scope.selected_slugs, ["cliente-a", "cliente-b"]);
  eq("margem é ponderada por faturamento", multiple.metrics.margin.value, 0.175);

  const empty = await service.getSummary({ user: { id: 10, role: "membro" }, period: "30d", clientes: "cliente-x" });
  eq("usuário sem seleção autorizada recebe estado vazio", empty.data_status, "empty");
  eq("estado vazio não inventa faturamento", empty.metrics.revenue.value, null);

  const root = path.join(__dirname, "..", "..");
  const html = fs.readFileSync(path.join(root, "Portal", "dashboard.html"), "utf8");
  const js = fs.readFileSync(path.join(root, "Portal", "dashboard.js"), "utf8");
  ok("topo possui exatamente os quatro KPIs aprovados", ["Faturamento", "Margem média", "Clientes em atenção", "Pendências"].every((label) => html.includes(label)));
  ok("Dashboard possui multiselect de clientes", html.includes("dash-client-picker") && html.includes("dash-client-search") && html.includes("dash-client-apply"));
  ok("Dashboard possui Minha carteira", html.includes("Minha carteira") && html.includes("dash-portfolio-body"));
  ok("Dashboard possui prontidão expansível", js.includes("aria-expanded") && js.includes("Ver prontidão") && js.includes("Ocultar"));
  ok("frontend usa apenas o agregador do Dashboard", js.includes("/dashboard/summary") && !js.includes("/admin/ml-tokens") && !js.includes("/automacoes/relatorios"));

  console.log(`\n✓ dashboardPortfolio.test.js: ${checks} verificações passaram`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
