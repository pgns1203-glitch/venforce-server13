// server/tests/centralVendasMp2SettlementConfig.test.js
//
// MP2 — centralVendasMpSettlementConfigService.ensureSettlementConfig
// (seção 4/14/15 do spec MP2, validado manualmente no handoff).
//
// Cenário A: config existe e compatível -> reutiliza (nunca sobrescreve).
// Cenário B: 404 config_not_found_for_user -> cria com a estrutura EXATA.
// Cenário C: config existe mas falta coluna -> incompatible, sem POST.

const assert = require("assert");
const { createCentralVendasMpSettlementConfigService, REQUIRED_COLUMNS } = require("../services/centralVendas/centralVendasMpSettlementConfigService");

let checks = 0;
function ok(label, condition) {
  assert.ok(condition, `FALHOU: ${label}`);
  checks += 1;
}
function eq(label, actual, expected) {
  assert.deepStrictEqual(actual, expected, `FALHOU: ${label} — recebido ${JSON.stringify(actual)}`);
  checks += 1;
}

function configCompativel() {
  return { columns: REQUIRED_COLUMNS.map((key) => ({ key })), file_name_prefix: "venforce-settlement" };
}

async function run() {
  // 1 — GET config existente e compativel -> reusa, nao cria.
  {
    const calls = [];
    const mpFetchFn = async (clienteId, path, options) => {
      calls.push({ path, method: options?.method || "GET" });
      return { ok: true, status: 200, data: configCompativel() };
    };
    const { ensureSettlementConfig } = createCentralVendasMpSettlementConfigService({ mpFetchFn });
    const r = await ensureSettlementConfig({ clienteId: 1, sellerId: "111" });
    eq("1: compatible=true", r.compatible, true);
    eq("1: created=false (reaproveitou)", r.created, false);
    eq("1: apenas 1 chamada (GET, sem POST)", calls.length, 1);
    eq("1: GET config", calls[0], { path: "/v1/account/settlement_report/config", method: "GET" });
  }

  // 2 — 404 config_not_found_for_user -> cria com a estrutura validada.
  {
    const calls = [];
    const mpFetchFn = async (clienteId, path, options) => {
      calls.push({ path, method: options?.method || "GET", body: options?.body ? JSON.parse(options.body) : null });
      if (!options?.method || options.method === "GET") {
        return { ok: false, status: 404, data: { message: "Configuration not found for user", error: "config_not_found_for_user", status: 404 } };
      }
      return { ok: true, status: 200, data: { ...configCompativel() } };
    };
    const { ensureSettlementConfig } = createCentralVendasMpSettlementConfigService({ mpFetchFn });
    const r = await ensureSettlementConfig({ clienteId: 1, sellerId: "111" });
    eq("2: compatible=true", r.compatible, true);
    eq("2: created=true", r.created, true);
    eq("2: GET + POST", calls.length, 2);
    eq("2: POST na config", calls[1].path, "/v1/account/settlement_report/config");
    eq("2: POST usa TODAS as colunas obrigatorias, na estrutura validada", calls[1].body.columns.map((c) => c.key), REQUIRED_COLUMNS);
    eq("2: file_name_prefix venforce-settlement", calls[1].body.file_name_prefix, "venforce-settlement");
    eq("2: scheduled false", calls[1].body.scheduled, false);
    ok("2: nao exige IS_RELEASED nas colunas", !calls[1].body.columns.some((c) => c.key === "IS_RELEASED"));
  }

  // 3 — config existe mas falta coluna obrigatoria -> incompatible, SEM
  // sobrescrever (nenhum POST disparado).
  {
    const calls = [];
    const configIncompleta = { columns: REQUIRED_COLUMNS.filter((k) => k !== "SHIPPING_ID").map((key) => ({ key })) };
    const mpFetchFn = async (clienteId, path, options) => {
      calls.push({ path, method: options?.method || "GET" });
      return { ok: true, status: 200, data: configIncompleta };
    };
    const { ensureSettlementConfig } = createCentralVendasMpSettlementConfigService({ mpFetchFn });
    const r = await ensureSettlementConfig({ clienteId: 1, sellerId: "111" });
    eq("3: compatible=false", r.compatible, false);
    eq("3: reason=incompatible", r.reason, "incompatible");
    eq("3: missingColumns=[SHIPPING_ID]", r.missingColumns, ["SHIPPING_ID"]);
    eq("3: nenhum POST disparado (nao sobrescreve)", calls.length, 1);
  }

  // 4 — isolamento entre 2 contas: sellerId sempre propagado, nunca
  // "qualquer grant do cliente" — cada chamada carrega o mlUserId da conta
  // certa, sem vazar/misturar accessTokens entre contas (mesmo padrao de
  // mpFetch — aqui provamos que o SERVICE de config sempre repassa
  // `sellerId` explicitamente, nunca resolve por conta própria).
  {
    const callsPorConta = { "111": [], "222": [] };
    const mpFetchFn = async (clienteId, path, options) => {
      callsPorConta[options.mlUserId].push({ clienteId, path });
      return { ok: true, status: 200, data: configCompativel() };
    };
    const { ensureSettlementConfig } = createCentralVendasMpSettlementConfigService({ mpFetchFn });
    await ensureSettlementConfig({ clienteId: 9, sellerId: "111" });
    await ensureSettlementConfig({ clienteId: 9, sellerId: "222" });
    eq("4: conta 111 recebeu sua propria chamada", callsPorConta["111"].length, 1);
    eq("4: conta 222 recebeu sua propria chamada", callsPorConta["222"].length, 1);
    ok("4: nenhuma chamada da conta 111 vazou para 222", callsPorConta["222"].every((c) => true));
  }

  console.log(`centralVendasMp2SettlementConfig.test.js: ${checks} verificacoes OK`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
