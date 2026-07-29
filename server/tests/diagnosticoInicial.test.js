const assert = require("assert");
const schema = require("../../Portal/diagnostico-inicial-schema");
const reportRenderer = require("../../Portal/diagnostico-inicial-report");
const repo = require("../services/diagnosticoInicial/diagnosticoInicialRepository");
const service = require("../services/diagnosticoInicial/diagnosticoInicialService");
const gerador = require("../services/diagnosticoInicial/diagnosticoInicialGeradorService");

let checks = 0;
function ok(label, condition) {
  assert.ok(condition, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}
function eq(label, actual, expected) {
  assert.deepStrictEqual(actual, expected, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}
async function rejects(label, fn, statusCode) {
  await assert.rejects(fn, (error) => error?.statusCode === statusCode);
  checks += 1;
  console.log(`  ok  ${label}`);
}

const rows = [];
let nextId = 1;
const client = { id: 10, nome: "Cliente <Executivo>", slug: "cliente-executivo", ativo: true };
const withMeta = (row) => row ? { ...row, cliente_nome: client.nome, cliente_slug: client.slug, responsavel_nome: "Ana Gestora" } : null;

repo.getClienteAtivoById = async (id) => Number(id) === client.id ? client : null;
repo.findRascunho = async ({ clienteId, marketplace }) => withMeta(rows.find((row) => row.cliente_id === clienteId && row.marketplace === marketplace && row.status === "rascunho"));
repo.createDiagnostico = async ({ clienteId, marketplace, responsavelUserId, dataDiagnostico, respostasJson }) => {
  if (rows.some((row) => row.cliente_id === clienteId && row.marketplace === marketplace && row.status === "rascunho")) {
    const error = new Error("unique"); error.code = "23505"; throw error;
  }
  const now = new Date().toISOString();
  const row = {
    id: nextId++, cliente_id: clienteId, marketplace, responsavel_user_id: responsavelUserId,
    data_diagnostico: dataDiagnostico || "2026-07-29", status: "rascunho", respostas_json: respostasJson || {},
    diagnostico_gerado_json: null, diagnostico_revisado_json: null, relatorio_snapshot_json: null,
    completude: 0, created_at: now, updated_at: now, completed_at: null,
  };
  rows.push(row);
  return withMeta(row);
};
repo.getDiagnosticoById = async (id) => withMeta(rows.find((row) => row.id === Number(id)));
repo.listDiagnosticos = async ({ clienteId, marketplace }) => rows.filter((row) => (!clienteId || row.cliente_id === clienteId) && (!marketplace || row.marketplace === marketplace)).map(withMeta);
repo.updateDiagnostico = async (id, fields) => {
  const row = rows.find((item) => item.id === Number(id));
  if (!row) return null;
  Object.assign(row, JSON.parse(JSON.stringify(fields)), { updated_at: new Date().toISOString() });
  return withMeta(row);
};
repo.concluirDiagnostico = async (id, data) => {
  const row = rows.find((item) => item.id === Number(id));
  if (!row || row.status !== "rascunho") return null;
  Object.assign(row, {
    status: "concluido", diagnostico_revisado_json: data.diagnosticoRevisadoJson,
    relatorio_snapshot_json: data.relatorioSnapshotJson, completude: data.completude,
    completed_at: data.completedAt, updated_at: data.completedAt,
  });
  return withMeta(row);
};

function setPath(target, path, value) {
  const keys = path.split(".");
  let node = target;
  for (const key of keys.slice(0, -1)) node = node[key] || (node[key] = {});
  node[keys[keys.length - 1]] = value;
}

function completeAnswers(marketplace) {
  const answers = {};
  for (const field of schema.getFields(marketplace).filter((item) => item.completion !== false)) {
    if (!schema.isApplicable(field, answers)) continue;
    const value = field.type === "tristate" ? "nao"
      : field.type === "table" ? [{ mes: "2026-07", id: "SKU-1", faturamento: 0, vendas: 0 }]
      : field.type === "boolean" ? false : field.type === "text" ? "Avaliado" : 0;
    setPath(answers, field.path, value);
  }
  return answers;
}

(async () => {
  console.log("\n▸ Diagnóstico Inicial — ciclo completo e relatório");

  const draft = await service.obterOuCriarRascunho({ clienteId: 10, marketplace: "meli", responsavelUserId: 7, dataDiagnostico: "2026-07-29" });
  ok("1. cria diagnóstico em rascunho", draft.id === 1 && draft.status === "rascunho");

  const duplicate = await service.obterOuCriarRascunho({ clienteId: 10, marketplace: "meli", responsavelUserId: 7 });
  ok("2. não cria rascunho duplicado", duplicate.id === draft.id && rows.length === 1);

  const answers = completeAnswers("meli");
  const saved = await service.atualizarRespostas(draft.id, { respostasJson: answers });
  ok("3. salva respostas_json", saved.respostas_json.metricasNegocio.meses[0].faturamento === 0);
  eq("4. zero é resposta válida e completude chega a 100", saved.completude, 100);

  const reopened = await service.obterOuCriarRascunho({ clienteId: 10, marketplace: "meli", responsavelUserId: 7 });
  eq("5. recupera rascunho com respostas", reopened.respostas_json, answers);

  const generated = await service.gerar(draft.id, { geradoPor: "Ana Gestora" });
  ok("6. gera diagnóstico estruturado", generated.diagnostico_gerado_json?.resumoExecutivo && generated.diagnostico_revisado_json);

  await service.atualizarRespostas(draft.id, {
    diagnosticoRevisadoJson: { ...generated.diagnostico_revisado_json, completude: 6.06, conclusaoAnalista: "Conclusão revisada" },
  });
  const beforeConclusion = JSON.stringify(rows[0].respostas_json);
  const concluded = await service.concluir(draft.id);
  eq("7. conclusão preserva respostas_json", JSON.stringify(concluded.respostas_json), beforeConclusion);
  eq("8. conclusão ignora completude antiga da revisão", concluded.completude, 100);
  ok("9. conclusão gera snapshot estável", concluded.relatorio_snapshot_json?.version === 1 && concluded.relatorio_snapshot_json.status === "concluido");
  ok("10. snapshot contém cliente, análise, seções e pendências", concluded.relatorio_snapshot_json.cliente.nome === client.nome && concluded.relatorio_snapshot_json.analise.conclusaoAnalista === "Conclusão revisada" && concluded.relatorio_snapshot_json.secoes.length === 11 && Array.isArray(concluded.relatorio_snapshot_json.informacoesAusentes));
  ok("11. snapshot não contém autenticação", !JSON.stringify(concluded.relatorio_snapshot_json).match(/token|authorization|senha/i));

  const recoveredCompleted = await service.obterPorId(draft.id);
  ok("12. recupera diagnóstico concluído e snapshot", recoveredCompleted.status === "concluido" && recoveredCompleted.relatorio_snapshot_json.version === 1);
  await rejects("13. diagnóstico concluído não pode ser sobrescrito", () => service.atualizarRespostas(draft.id, { respostasJson: {} }), 409);

  const nextDraft = await service.obterOuCriarRascunho({ clienteId: 10, marketplace: "meli", responsavelUserId: 7 });
  ok("14. novo rascunho não sobrescreve concluído", nextDraft.id !== draft.id && rows.find((row) => row.id === draft.id).status === "concluido");

  const shopeeDraft = await service.obterOuCriarRascunho({ clienteId: 10, marketplace: "shopee", responsavelUserId: 7 });
  const shopeeSaved = await service.atualizarRespostas(shopeeDraft.id, { respostasJson: completeAnswers("shopee") });
  ok("15. Mercado Livre e Shopee permanecem separados", shopeeSaved.marketplace === "shopee" && shopeeSaved.id !== nextDraft.id && shopeeSaved.completude === 100);

  ok("16. false é valor válido", schema.isMissing(false) === false && schema.isAnswered({ type: "boolean" }, false));
  const nullAnswers = completeAnswers("meli");
  nullAnswers.reputacao.reclamacoesPercentual = null;
  const nullCompleteness = gerador.calcularCompletudeDetalhada("meli", nullAnswers);
  ok("17. null é ausência real", nullCompleteness.percentual < 100 && nullCompleteness.camposPendentes.some((item) => item.label === "Percentual de reclamações"));

  const conditional = completeAnswers("meli");
  conditional.full.utilizaFull = "nao";
  delete conditional.full.produtosRiscoCobranca;
  const notApplicable = gerador.calcularCompletudeDetalhada("meli", conditional);
  conditional.full.utilizaFull = "sim";
  const applicable = gerador.calcularCompletudeDetalhada("meli", conditional);
  ok("18. campo condicional só fica pendente quando aplicável", !notApplicable.camposPendentes.some((item) => item.label.includes("risco de cobrança")) && applicable.camposPendentes.some((item) => item.label.includes("risco de cobrança")));

  const tableAnswers = completeAnswers("meli");
  tableAnswers.metricasNegocio.meses = [{ mes: "2026-07", faturamento: 0, unidades: 0 }];
  ok("19. tabela mensal com valores zero é preenchida", gerador.calcularCompletudeDetalhada("meli", tableAnswers).camposPendentes.every((item) => item.path !== "metricasNegocio.meses"));

  const legacy = withMeta({ ...rows[0], id: 99, relatorio_snapshot_json: null });
  const legacyEnriched = service.enriquecerDiagnostico(legacy);
  ok("20. diagnóstico antigo sem snapshot recebe fallback", legacyEnriched.relatorio_snapshot_fallback === true && legacyEnriched.relatorio_snapshot_json.version === 1);

  const html = reportRenderer.renderReportHtml(concluded.relatorio_snapshot_json);
  ok("21. relatório inclui respostas e análise escapadas", html.includes("Respostas registradas") && html.includes("Conclusão revisada") && html.includes("Cliente &lt;Executivo&gt;"));
  ok("22. relatório não contém elementos da aplicação", !/<(?:input|select|textarea|button)\b/i.test(html) && !/diag-empty-state|vf-sidebar|vf-app-topbar|Selecione um cliente/i.test(html));
  ok("23. relatório apresenta tabela com cabeçalhos legíveis", html.includes("Faturamento") && html.includes("<table") && !html.includes("metricasNegocio.meses"));

  const routes = require("../routes/diagnosticoInicialRoutes");
  const endpoints = routes.stack.filter((layer) => layer.route).map((layer) => `${Object.keys(layer.route.methods)[0].toUpperCase()} ${layer.route.path}`);
  ok("24. endpoints de criar, salvar, gerar, concluir, listar e recuperar permanecem autenticados", ["GET /", "GET /:id", "POST /", "PATCH /:id", "POST /:id/gerar", "POST /:id/concluir"].every((endpoint) => endpoints.includes(endpoint)) && routes.stack.filter((layer) => layer.route).every((layer) => layer.route.stack.length >= 3));

  console.log(`\n${checks} verificações passaram no Diagnóstico Inicial.`);
})().catch((error) => { console.error(error); process.exit(1); });
