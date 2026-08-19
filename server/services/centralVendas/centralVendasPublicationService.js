// server/services/centralVendas/centralVendasPublicationService.js
// Central de Vendas — Candidate/Published (M4 da fundação V3).
//
// Separa "dado produzido por uma sincronização" (candidate, sempre gravado)
// de "dado oficial que a Central pode exibir" (published, só depois de
// promovido por publicarRun). Nunca publica dentro do collector — só aqui,
// e só depois que o run já terminou (ver centralVendasSyncWorker).
//
// GATE DE PUBLICAÇÃO (correção sobre a primeira versão do M4 — NÃO usar
// run.completenessStatus agregado):
//
//   run.status === "completed"
//   AND
//   fonte "orders" desse run === "complete"
//
// completenessStatus (M3, agregado de orders/shipments/claims/returns/base)
// continua existindo e continua controlando confianca/podeConcluir no GET
// (buildCompletenessState em centralVendasService.js) — mas NÃO decide se um
// candidate pode virar published. Shipments/Claims/Returns incompletos ou
// falhos NUNCA bloqueiam publicação: o snapshot publica mesmo assim, só que
// com confianca="parcial"/podeConcluir=false no GET (a mesma leitura de
// sempre, via completenessStatus). Só uma coisa bloqueia: o run não ter
// terminado completed, ou a fonte "orders" não ter fechado "complete" (isto
// é, truncada/incompleta ou o run nunca chegou a rodá-la) — orders é o
// único requisito ESTRUTURAL do snapshot (mesmo STRUCTURAL_SOURCES de
// centralVendasSyncSourceService), porque sem orders completo o conjunto de
// pedidos do período não é confiável — nem para exibir como "parcial".
//
// Exemplo obrigatório (ver docs/CENTRAL_VENDAS_V3_ARQUITETURA.md):
//   Orders 587/587 complete, Shipments 570/573 incomplete,
//   Claims HTTP 400 failed, Returns blocked, run.status=completed
//   → PUBLICA (confianca=parcial, podeConcluir=false no GET)
//
//   Orders 5000/7300 incomplete, run.status=completed
//   → NÃO publica (candidate fica candidate; published anterior intacto)

const pool = require("../../config/database");
const runService = require("./centralVendasSyncRunService");
const sourceService = require("./centralVendasSyncSourceService");

function getRepository() {
  return require("./centralVendasRepository");
}

async function obterRunPorId(runId, db) {
  const result = await db.query(`SELECT * FROM central_vendas_sync_runs WHERE id = $1`, [runId]);
  return result.rows[0] ? runService.sanitizeRun(result.rows[0]) : null;
}

// Só a fonte "orders" decide elegibilidade (ver comentário do topo do
// arquivo) — nunca o agregado de completude (M3). Não duplica a lógica de
// truncamento/paginação de Orders aqui: `status === "complete"` já É o
// veredito de centralVendasSyncSourceService/fetchAllOrders para "cobriu
// integralmente o intervalo pedido, sem truncar".
async function avaliarElegibilidade(runId, db = pool) {
  const run = await obterRunPorId(runId, db);
  if (!run) return { elegivel: false, motivo: "RUN_NAO_ENCONTRADO", run: null, ordersFonte: null };
  if (run.status !== "completed") {
    return { elegivel: false, motivo: "RUN_NAO_COMPLETED", run, ordersFonte: null };
  }

  const fontes = await sourceService.listarFontesDoRun(runId, db);
  const ordersFonte = fontes.find((f) => f.source === "orders") || null;
  if (!ordersFonte || ordersFonte.status !== "complete") {
    return { elegivel: false, motivo: "ORDERS_INCOMPLETE", run, ordersFonte };
  }

  return { elegivel: true, motivo: null, run, ordersFonte };
}

// Idempotente: chamar publicarRun(runId) duas vezes não duplica nada — a
// segunda chamada encontra 0 candidates (já promovidos na primeira) e
// devolve published:true com importIds:[] sem tocar em published_at de
// novo. Se a promoção falhar (erro de banco), a query não roda parcialmente
// (é um único UPDATE atômico) — o published anterior nunca é substituído
// por um estado inconsistente, e o erro propaga para o chamador decidir
// (o worker só loga, nunca deixa isso derrubar o run completed).
async function publicarRun(runId, { db = pool, repository = getRepository() } = {}) {
  const avaliacao = await avaliarElegibilidade(runId, db);
  if (!avaliacao.elegivel) {
    return { published: false, reason: avaliacao.motivo, importIds: [] };
  }

  const promovidos = await repository.promoverCandidatesDoRun(runId, db);
  return { published: true, reason: null, importIds: promovidos.map((row) => Number(row.id)) };
}

module.exports = {
  publicarRun,
  avaliarElegibilidade,
};
