const { parseSpreadsheet, detectMeliHeaderRow } = require("../utils/excelUtils");
const centralVendasService = require("../services/centralVendas/centralVendasService");
const centralVendasImportService = require("../services/centralVendas/centralVendasImportService");
const centralVendasSyncRunService = require("../services/centralVendas/centralVendasSyncRunService");
const centralVendasSyncWorker = require("../services/centralVendas/centralVendasSyncWorker");
const centralVendasSyncSourceService = require("../services/centralVendas/centralVendasSyncSourceService");
const centralVendasReadService = require("../services/centralVendas/centralVendasReadService");

const CAMPOS_SENSIVEIS = new Set([
  "access_token", "refresh_token", "api_key", "apikey", "password",
  "authorization", "token", "secret", "client_secret",
]);

function maskSensitiveData(obj) {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(maskSensitiveData);
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    if (CAMPOS_SENSIVEIS.has(String(key).toLowerCase())) {
      out[key] = "[REDACTED]";
    } else {
      out[key] = maskSensitiveData(value);
    }
  }
  return out;
}

function responder(res, statusCode, payload) {
  return res.status(statusCode).json(maskSensitiveData(payload));
}

function tratarErro(res, err, contexto) {
  const statusCode =
    Number.isFinite(Number(err?.statusCode)) && Number(err.statusCode) >= 400
      ? Number(err.statusCode)
      : 500;
  if (statusCode >= 500) console.error(`[centralVendas] ${contexto}:`, err?.message);
  const payload = { ok: false, erro: err?.message || "Erro interno." };
  // Ambiguidade de conta (409 MULTIPLE_MARKETPLACE_ACCOUNTS) precisa do
  // código + lista de contas para uma UI futura oferecer o seletor —
  // maskSensitiveData já garante que nenhum token vaze aqui.
  if (err?.code) payload.code = err.code;
  if (Array.isArray(err?.contas)) payload.contas = err.contas;
  return responder(res, statusCode, payload);
}

function slugParam(req) {
  return String(req.params.slug || "").trim().toLowerCase();
}

function isValidIsoDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

// Resolve o intervalo do request: dateFrom/dateTo tem prioridade; senao
// deriva da competencia legada (mesma regra usada pelo servico de sync).
function resolverIntervalo(req) {
  const dateFrom = req.body?.dateFrom || req.query?.dateFrom;
  const dateTo = req.body?.dateTo || req.query?.dateTo;
  if (isValidIsoDate(dateFrom) && isValidIsoDate(dateTo)) return { dateFrom, dateTo };

  const competenciaRaw = req.body?.competencia || req.query?.competencia;
  const competencia = /^\d{4}-\d{2}$/.test(String(competenciaRaw || "").trim())
    ? String(competenciaRaw).trim()
    : (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; })();
  const periodo = centralVendasService.periodoFromCompetencia(competencia);
  return { dateFrom: periodo.inicio, dateTo: periodo.fim };
}

function parseSalesRows(req) {
  // Aceita salesRowsRaw como JSON no body (testes/integração) ou upload de arquivo .xlsx
  const salesRowsBody = req.body?.salesRowsRaw;
  if (Array.isArray(salesRowsBody)) return salesRowsBody;
  if (typeof salesRowsBody === "string" && salesRowsBody.trim()) {
    try {
      const parsed = JSON.parse(salesRowsBody);
      if (Array.isArray(parsed)) return parsed;
    } catch (_) { /* ignora, tenta arquivo */ }
  }

  const salesFile = req.files?.sales?.[0];
  if (!salesFile?.buffer) {
    const err = new Error("Arquivo de vendas (sales) e obrigatorio.");
    err.statusCode = 400;
    throw err;
  }

  return parseSpreadsheet(salesFile.buffer, detectMeliHeaderRow(salesFile.buffer));
}

async function obterCentralVendas(req, res) {
  try {
    const slug = slugParam(req);
    if (!slug) return responder(res, 400, { ok: false, erro: "slug e obrigatorio." });

    const data = await centralVendasService.getCentralVendas(slug, {
      competencia: req.query.competencia,
      dateFrom: req.query.dateFrom,
      dateTo: req.query.dateTo,
      marketplace: req.query.marketplace || "meli",
      clienteContaId: req.query.clienteContaId || null,
    });
    return responder(res, 200, data);
  } catch (err) {
    return tratarErro(res, err, "obterCentralVendas");
  }
}

// M7 — Read API canonica e paginada. Rota nova, aditiva: GET legado
// (obterCentralVendas) continua devolvendo o payload completo do periodo,
// inalterado. Autorizacao igual ao GET legado (leitura, nao admin-only).
async function obterCentralVendasRead(req, res) {
  try {
    const slug = slugParam(req);
    if (!slug) return responder(res, 400, { ok: false, erro: "slug e obrigatorio." });

    const data = await centralVendasReadService.getCentralVendasRead(slug, {
      dateFrom: req.query.dateFrom,
      dateTo: req.query.dateTo,
      marketplace: req.query.marketplace || "meli",
      clienteContaId: req.query.clienteContaId || null,
      page: req.query.page,
      limit: req.query.limit,
      sort: req.query.sort,
      filtro: req.query.filtro,
      status: req.query.status,
      logistica: req.query.logistica,
      diagbase: req.query.diagbase,
      search: req.query.search,
      dataDe: req.query.dataDe,
      dataAte: req.query.dataAte,
      resumoFiltro: req.query.resumoFiltro,
    });
    return responder(res, 200, data);
  } catch (err) {
    return tratarErro(res, err, "obterCentralVendasRead");
  }
}

// M10 — carga inicial: resolve contexto e constrói o payload do período UMA
// vez só e devolve tudo que a tela busca hoje em 3 requests (/read +
// /read/daily + /read/products, cada um reconstruindo o período do zero).
// Aditiva: os 3 endpoints antigos continuam existindo e inalterados.
async function obterCentralVendasReadBootstrap(req, res) {
  try {
    const slug = slugParam(req);
    if (!slug) return responder(res, 400, { ok: false, erro: "slug e obrigatorio." });

    const data = await centralVendasReadService.getCentralVendasReadBootstrap(slug, {
      dateFrom: req.query.dateFrom,
      dateTo: req.query.dateTo,
      marketplace: req.query.marketplace || "meli",
      clienteContaId: req.query.clienteContaId || null,
      page: req.query.page,
      limit: req.query.limit,
      sort: req.query.sort,
      filtro: req.query.filtro,
      status: req.query.status,
      logistica: req.query.logistica,
      diagbase: req.query.diagbase,
      search: req.query.search,
      dataDe: req.query.dataDe,
      dataAte: req.query.dataAte,
      resumoFiltro: req.query.resumoFiltro,
    });
    return responder(res, 200, data);
  } catch (err) {
    return tratarErro(res, err, "obterCentralVendasReadBootstrap");
  }
}

// M9 — agregado diário ("Vendas por dia"), período inteiro. Aditiva: não
// substitui o GET legado nem o /read acima.
async function obterCentralVendasReadDaily(req, res) {
  try {
    const slug = slugParam(req);
    if (!slug) return responder(res, 400, { ok: false, erro: "slug e obrigatorio." });

    const data = await centralVendasReadService.getCentralVendasReadDaily(slug, {
      dateFrom: req.query.dateFrom,
      dateTo: req.query.dateTo,
      marketplace: req.query.marketplace || "meli",
      clienteContaId: req.query.clienteContaId || null,
    });
    return responder(res, 200, data);
  } catch (err) {
    return tratarErro(res, err, "obterCentralVendasReadDaily");
  }
}

// M9 — Curva ABC / Produtos agregada, período inteiro. Aditiva: não
// substitui o GET legado nem o /read acima.
async function obterCentralVendasReadProducts(req, res) {
  try {
    const slug = slugParam(req);
    if (!slug) return responder(res, 400, { ok: false, erro: "slug e obrigatorio." });

    const data = await centralVendasReadService.getCentralVendasReadProducts(slug, {
      dateFrom: req.query.dateFrom,
      dateTo: req.query.dateTo,
      marketplace: req.query.marketplace || "meli",
      clienteContaId: req.query.clienteContaId || null,
    });
    return responder(res, 200, data);
  } catch (err) {
    return tratarErro(res, err, "obterCentralVendasReadProducts");
  }
}

// M7, secao 9 — detalhe/ledger sob demanda. rowId (pedido_row_id) so
// resolve dentro do MESMO snapshot account-scoped da Read API — nunca
// aceita pedidoId/importId isolado (ver centralVendasReadService).
async function obterCentralVendasReadOrderDetail(req, res) {
  try {
    const slug = slugParam(req);
    if (!slug) return responder(res, 400, { ok: false, erro: "slug e obrigatorio." });

    const data = await centralVendasReadService.getCentralVendasReadOrderDetail(slug, req.params.rowId, {
      dateFrom: req.query.dateFrom,
      dateTo: req.query.dateTo,
      marketplace: req.query.marketplace || "meli",
      clienteContaId: req.query.clienteContaId || null,
    });
    return responder(res, 200, data);
  } catch (err) {
    return tratarErro(res, err, "obterCentralVendasReadOrderDetail");
  }
}

async function importarVendas(req, res) {
  try {
    const slug = slugParam(req);
    if (!slug) return responder(res, 400, { ok: false, erro: "slug e obrigatorio." });

    const salesRowsRaw = parseSalesRows(req);

    // Log de diagnóstico: cabeçalho da planilha para identificar mismatch de colunas
    if (salesRowsRaw.length > 0) {
      const colunas = Object.keys(salesRowsRaw[0]).slice(0, 12).join(" | ");
      console.log(`[centralVendas] importarVendas ${slug}: ${salesRowsRaw.length} linhas, colunas: ${colunas}`);
    } else {
      console.log(`[centralVendas] importarVendas ${slug}: 0 linhas após parseSpreadsheet`);
    }

    const data = await centralVendasImportService.importarVendasMeli({
      salesRowsRaw,
      clienteSlug: slug,
      clienteContaId: req.body?.clienteContaId || req.query?.clienteContaId || null,
      competencia: req.body?.competencia || req.query?.competencia,
      marketplace: req.body?.marketplace || "meli",
    });
    return responder(res, 201, data);
  } catch (err) {
    return tratarErro(res, err, "importarVendas");
  }
}

// Endpoint legado: continua respondendo de forma SINCRONA (o mesmo contrato
// de sempre, so com "runId" adicionado). Por baixo, cria um sync_run e
// AGUARDA a mesma funcao (`executarSyncRun`) que o worker roda em segundo
// plano para o endpoint novo — nao existem dois motores de sincronizacao.
async function sincronizarVendas(req, res) {
  try {
    const slug = slugParam(req);
    if (!slug) return responder(res, 400, { ok: false, erro: "slug e obrigatorio." });

    const { dateFrom, dateTo } = resolverIntervalo(req);
    const marketplace = req.body?.marketplace || "meli";
    const clienteContaId = req.body?.clienteContaId || req.query?.clienteContaId || null;

    const { run, context } = await centralVendasSyncRunService.criarSyncRun({
      clienteSlug: slug,
      clienteContaId,
      marketplace,
      dateFrom,
      dateTo,
      requestedBy: req.user?.id || null,
    });

    const data = await centralVendasSyncWorker.executarSyncRun({
      run,
      context,
      params: { clienteSlug: slug, dateFrom, dateTo, marketplace },
    });

    // executarSyncRun devolve null se o run ja tinha sido processado por
    // outra chamada concorrente (mesmo cliente/conta/periodo) — nesse caso
    // nao ha payload novo para devolver; o operador deve consultar o run.
    if (!data) {
      return responder(res, 202, {
        ok: true,
        aviso: "Sincronizacao equivalente ja em andamento ou concluida.",
        run,
      });
    }

    return responder(res, 201, data);
  } catch (err) {
    return tratarErro(res, err, "sincronizarVendas");
  }
}

// POST /:slug/sync-runs — cria o run e retorna 202 imediatamente. A
// sincronizacao roda em segundo plano (mesmo processo Node, fila
// in-process — ver centralVendasSyncWorker).
async function criarSyncRunController(req, res) {
  try {
    const slug = slugParam(req);
    if (!slug) return responder(res, 400, { ok: false, erro: "slug e obrigatorio." });

    const { dateFrom, dateTo } = resolverIntervalo(req);
    const marketplace = req.body?.marketplace || "meli";
    const clienteContaId = req.body?.clienteContaId || req.query?.clienteContaId || null;

    const { run, context, reaproveitado } = await centralVendasSyncRunService.criarSyncRun({
      clienteSlug: slug,
      clienteContaId,
      marketplace,
      dateFrom,
      dateTo,
      requestedBy: req.user?.id || null,
    });

    // Novo (queued): enfileira para o worker processar em background.
    // Reaproveitado (ja queued/running de um clique anterior): nao enfileira
    // de novo, so devolve o run existente para o frontend acompanhar.
    if (!reaproveitado) {
      centralVendasSyncWorker.enfileirar({
        run,
        context,
        params: { clienteSlug: slug, dateFrom, dateTo, marketplace },
      });
    }

    return responder(res, 202, { ok: true, run, reaproveitado: !!reaproveitado });
  } catch (err) {
    return tratarErro(res, err, "criarSyncRun");
  }
}

async function obterSyncRunController(req, res) {
  try {
    const slug = slugParam(req);
    if (!slug) return responder(res, 400, { ok: false, erro: "slug e obrigatorio." });
    const runId = Number(req.params.runId);
    if (!Number.isFinite(runId)) return responder(res, 400, { ok: false, erro: "runId invalido." });

    const run = await centralVendasSyncRunService.obterSyncRun({ runId, clienteSlug: slug });
    // M3, seção 41: sources sempre escopadas pelo mesmo runId já validado
    // (dono do cliente) acima por obterSyncRun — nunca outro caminho de
    // acesso a central_vendas_sync_sources.
    const sources = await centralVendasSyncSourceService.listarFontesDoRun(run.id);
    // Hardening M3, seção 26: expõe a agregação já pronta (missingSources/
    // incompleteSources/failedSources) — nunca duplicar a regra no
    // controller nem obrigar o frontend a recalculá-la a partir de `sources`.
    const completeness = await centralVendasSyncSourceService.calcularCompletudeDoRun(run.id, { runStatus: run.status });
    return responder(res, 200, { ok: true, run, completeness, sources });
  } catch (err) {
    return tratarErro(res, err, "obterSyncRun");
  }
}

async function listarSyncRunsController(req, res) {
  try {
    const slug = slugParam(req);
    if (!slug) return responder(res, 400, { ok: false, erro: "slug e obrigatorio." });

    const runs = await centralVendasSyncRunService.listarSyncRuns({
      clienteSlug: slug,
      clienteContaId: req.query?.clienteContaId || null,
      marketplace: req.query?.marketplace || null,
      status: req.query?.status || null,
      dateFrom: req.query?.dateFrom || null,
      dateTo: req.query?.dateTo || null,
      limit: req.query?.limit || 20,
    });
    return responder(res, 200, { ok: true, runs });
  } catch (err) {
    return tratarErro(res, err, "listarSyncRuns");
  }
}

module.exports = {
  obterCentralVendas,
  obterCentralVendasRead,
  obterCentralVendasReadOrderDetail,
  obterCentralVendasReadBootstrap,
  obterCentralVendasReadDaily,
  obterCentralVendasReadProducts,
  importarVendas,
  sincronizarVendas,
  criarSyncRunController,
  obterSyncRunController,
  listarSyncRunsController,
  maskSensitiveData,
};
