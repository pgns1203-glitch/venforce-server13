// server/services/motorMargem/marginSnapshotProcessor.js
// Margin Snapshot — Processor real (M3, ver
// docs/AUDITORIA_WORKERS_E_PLANO_MARGIN_SNAPSHOT.md §5/§8/§9/§10).
//
// É o processor que o worker (marginSnapshotWorker) chama depois de
// reivindicar um run `running`:
//
//   run claimado (cliente_conta_id sempre presente, nunca auto-resolvido)
//     → prepareWorkspaceContext UMA VEZ (Motor de Margem), SEM fonte de vendas
//     → lista o catálogo inteiro da conta por scan (ativos + pausados)
//     → lotes SEQUENCIAIS de 20 itens → enrichBatch(prepared, { itemIds })
//       (o mesmo Motor da tela — ZERO fórmula nova de margem)
//     → retry por LOTE (backoff exponencial com teto + Retry-After)
//     → upsert do snapshot projetado por item; lote que falhou de vez marca
//       como `failed` só as linhas que já existiam (valores preservados)
//     → progresso + heartbeat persistidos a cada lote
//     → itens que saíram do catálogo são marcados (nunca apagados)
//
// DECISÕES (sustentadas por código, não inventadas):
//
// 1. Listagem por scan, não por offset. /users/{id}/items/search não aceita
//    offset > 1000 (doc do ML; o repo já usa scan em meliSyncService,
//    modeloBaseCustosService e planilhaPrecificacaoSemBaseService). Com offset
//    o worker quebraria exatamente nos catálogos grandes que motivam o
//    snapshot. O Motor continua sendo quem calcula: enrichBatch aceita
//    `itemIds` (mesmo caminho do detalhe de item).
//
// 2. Snapshot = margem PROJETADA pura. O Motor classifica status/confiança
//    pela margem EXIBIDA (realizada quando há venda no período). Persistir
//    isso congelaria o realizado de uma janela arbitrária (30 dias do momento
//    do run) dentro do snapshot — o que o plano §12 proíbe. Por isso o
//    contexto é preparado com a fonte de vendas VAZIA (injeção explícita):
//    preço/comissão/frete/custo/imposto/taxa e a margem projetada são
//    idênticos aos da leitura ao vivo; status/confiança passam a depender só
//    das fontes projetadas. A realizada é combinada na LEITURA, pelo período
//    pedido pela tela (M5).
//
// 3. Unidade de retry = lote. A cotação por item nunca lança (o Motor engole
//    e devolve null) — então nenhum item é "corrigido" aqui.

const pool = require("../../config/database");
const motorMargem = require("./motorMargemService");
const snapshotRepository = require("./marginSnapshotRepository");
const runRepository = require("./marginSnapshotRunRepository");
const meliApi = require("./adapters/meliApiEvidenceAdapter");
const { FIELDS } = require("./core/marginEvidence");
const { resolveMarginSnapshotConfig } = require("./marginSnapshotConfig");
const { executarComRetry, esperar, MarginSnapshotStopError } = require("./marginSnapshotRetry");

// Mesmo teto do multiget /items?ids= que rege enrichBatch (PAGE_LIMIT_MAX).
const BATCH_SIZE = motorMargem.PAGE_LIMIT_MAX;

const MARKETPLACES_SUPORTADOS = ["meli"];

class MarginSnapshotMarketplaceNaoSuportadoError extends Error {
  constructor(marketplace) {
    super(
      `Margin Snapshot: marketplace "${marketplace}" não suportado pelo processor (só "meli" é implementado).`
    );
    this.name = "MarginSnapshotMarketplaceNaoSuportadoError";
    this.code = "MARGIN_SNAPSHOT_MARKETPLACE_NAO_SUPORTADO";
  }
}

function erroTipado(code, message, extra = {}) {
  const err = new Error(message);
  err.code = code;
  Object.assign(err, extra);
  return err;
}

// Fonte de vendas vazia (ver decisão 2 do cabeçalho). Mesmo formato que
// centralVendasEvidenceAdapter.carregarVendasDoPeriodo/agregarPorMlb devolvem.
async function carregarVendasVazias() {
  return { sincronizado: false, pedidos: [], pedidosTodos: [], itens: [], componentes: [], imports: [], importSnapshotAt: null };
}

function agregadoVazio() {
  return {
    porMlb: new Map(),
    reembolsoPorMlb: new Map(),
    naoAtribuido: { reembolso: 0 },
    reembolsos: { atribuidoMlb: 0, atribuidoPedido: 0, naoAtribuivel: 0 },
  };
}

function isoOrNull(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  return value;
}

// Valor PROJETADO de uma variável — nunca `valor || 0`: ausente fica null.
function valorProjetado(item, fieldKey) {
  const field = item.fields[fieldKey];
  const projetado = field && field.projected ? field.projected.value : undefined;
  return projetado ?? null;
}

// Evidências projetadas do Motor, compactas, para a leitura reconstruir o
// mesmo contrato `fields` (fonte, qualidade, observedAt, nota) sem chamar o
// ML. Como o snapshot é preparado sem vendas, só há evidência PROJECTED.
function evidenciasProjetadas(item) {
  const out = {};
  for (const [key, field] of Object.entries(item.fields || {})) {
    const lista = (field && Array.isArray(field.evidences) ? field.evidences : [])
      .filter((e) => e && e.kind === "PROJECTED" && e.value !== null && e.value !== undefined)
      .map((e) => ({
        source: e.source,
        value: e.value,
        quality: e.quality,
        observedAt: e.observedAt || null,
        note: e.note || null,
      }));
    if (lista.length) out[key] = lista;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Mapeamento item canônico do Motor -> snapshot
// ---------------------------------------------------------------------------
//
// Só a fotografia PROJETADA/atual. Nunca `pricing.sold`, `margin.realized`,
// `sales`, reembolso ou pedido — isso vive na Central de Vendas por período.
function mapItemParaSnapshot({ item, run, base, observedAt }) {
  return {
    clienteId: run.clienteId,
    // SEMPRE a conta explícita do run — nunca auto-resolvida.
    clienteContaId: run.clienteContaId,
    marketplace: run.marketplace,
    itemId: item.identity.itemId,
    sku: item.identity.sku,
    titulo: item.identity.titulo,
    baseId: base ? base.id : null,
    imageUrl: item.identity.image || null,

    price: valorProjetado(item, FIELDS.PRICE),
    listPrice: valorProjetado(item, FIELDS.LIST_PRICE),
    promoPrice: valorProjetado(item, FIELDS.PROMO_PRICE),
    cost: valorProjetado(item, FIELDS.COST),
    taxRate: valorProjetado(item, FIELDS.TAX_RATE),
    fixedFee: valorProjetado(item, FIELDS.FIXED_FEE),
    commission: valorProjetado(item, FIELDS.COMMISSION),
    commissionRate: valorProjetado(item, FIELDS.COMMISSION_RATE),
    freight: valorProjetado(item, FIELDS.FREIGHT),

    // Copiado do núcleo — nunca recalculado aqui.
    profit: item.margin.projected.profit,
    margin: item.margin.projected.margin,
    marginPercent: item.margin.projected.marginPercent,
    status: item.quality.status,

    confidenceLevel: item.quality.confidence,
    quality: {
      confidence: item.quality.confidence,
      confidenceByField: item.quality.confidenceByField,
      reasons: item.quality.reasons,
      hasConflict: item.quality.hasConflict,
      hasDrift: item.quality.hasDrift,
      statusLabel: item.quality.statusLabel,
      statusSeverity: item.quality.statusSeverity,
      statusReasons: item.quality.statusReasons,
      // Meta usada na classificação — a leitura precisa saber com qual meta
      // o status projetado foi julgado.
      targetMargin: item.margin.target ? item.margin.target.marginTarget : null,
      evidencias: evidenciasProjetadas(item),
      faltantesMeliApi: item.diagnostico ? item.diagnostico.faltantesMeliApi || [] : [],
      temCustoNaBase: item.diagnostico ? item.diagnostico.temCustoNaBase === true : null,
      statusAnuncio: item.diagnostico ? item.diagnostico.statusAnuncio || null : null,
    },
    missing: item.margin.projected.missing,
    assumed: item.margin.projected.assumed,
    divergences: item.quality.divergences,

    observedAt,
    // null → o repository preenche com NOW() (COALESCE) no momento do upsert.
    calculatedAt: null,
    // DECISÃO PENDENTE do plano (§8.2): o adapter não repassa `last_updated`
    // do ML no contrato; não inventar timestamp.
    sourceUpdatedAt: null,

    runId: run.id,
    refreshStatus: "fresh",
    lastError: null,
  };
}

function mensagemCurta(err) {
  return String(err?.message || "Erro desconhecido.").slice(0, 500);
}

// ---------------------------------------------------------------------------
// Processor
// ---------------------------------------------------------------------------
//
// Assinatura compatível com marginSnapshotWorker: `processor(run, { db, signal,
// logger })`. `deps` aceita override de TODAS as peças (Motor, adapter,
// repositories, sleep, config) — é assim que os testes evitam ML/Postgres.
async function processMarginSnapshotRun(run, deps = {}) {
  if (!run || !run.id) {
    throw new Error("processMarginSnapshotRun: run é obrigatório.");
  }
  if (!run.clienteContaId) {
    throw new Error("processMarginSnapshotRun: run.clienteContaId é obrigatório (nunca auto-resolver).");
  }

  const marketplace = String(run.marketplace || "").trim().toLowerCase();
  if (!MARKETPLACES_SUPORTADOS.includes(marketplace)) {
    throw new MarginSnapshotMarketplaceNaoSuportadoError(run.marketplace);
  }

  const db = deps.db || pool;
  const logger = deps.logger || console;
  const signal = deps.signal || null;
  const config = deps.config || resolveMarginSnapshotConfig(deps.env);
  const sleep = deps.sleep || esperar;
  const clock = deps.clock || (() => Date.now());
  const prepareWorkspaceContext = deps.prepareWorkspaceContext || motorMargem.prepareWorkspaceContext;
  const enrichBatch = deps.enrichBatch || motorMargem.enrichBatch;
  const listarIdsCatalogo = deps.listarIdsCatalogo || meliApi.listarIdsCatalogo;
  const upsertProjectionSnapshot = deps.upsertProjectionSnapshot || snapshotRepository.upsertProjectionSnapshot;
  const markSnapshotsRefreshFailed = deps.markSnapshotsRefreshFailed || snapshotRepository.markSnapshotsRefreshFailed;
  const markSnapshotsOutsideCatalog = deps.markSnapshotsOutsideCatalog || snapshotRepository.markSnapshotsOutsideCatalog;
  const updateRunProgress = deps.updateRunProgress || runRepository.updateRunProgress;
  const mergeRunMetadata = deps.mergeRunMetadata || runRepository.mergeRunMetadata;

  const inicio = clock();
  const LOG = `[marginSnapshot] run #${run.id} conta=${run.clienteContaId}`;
  const stats = { retries: 0, rateLimitedRetries: 0, lotesFalhos: 0, itensNaoRetornados: 0, itensForaDoCatalogo: 0 };

  function verificarParada() {
    if (signal?.aborted) throw new MarginSnapshotStopError();
  }

  // Um run que deixou de estar `running` (reconciliado como stale por outra
  // instância, M8) não pode continuar escrevendo: updateRunProgress devolve
  // null quando o UPDATE ... WHERE status='running' não casa.
  async function registrarProgresso(dados) {
    const atualizado = await updateRunProgress({ runId: run.id, db, ...dados });
    if (atualizado === null) {
      throw erroTipado(
        "MARGIN_SNAPSHOT_RUN_NAO_ESTA_MAIS_RUNNING",
        "O run deixou de estar em execução (provável reconciliação por heartbeat); processamento interrompido."
      );
    }
    return atualizado;
  }

  // ── 1. Contexto UMA VEZ, sem vendas (decisão 2) ─────────────────────────
  // Conta explícita: exigirContextoPronto valida que ela pertence ao cliente,
  // é do marketplace e está ativa — erro estrutural propaga (run failed).
  const prepared = await prepareWorkspaceContext(
    { clienteSlug: run.clienteSlug, clienteContaId: run.clienteContaId },
    { ...deps, db, carregarVendas: carregarVendasVazias, agregarPorMlb: agregadoVazio }
  );
  verificarParada();
  const observedAt = isoOrNull(prepared.now);

  // ── 2. Catálogo inteiro (scan) com retry ────────────────────────────────
  const listagem = await executarComRetry(
    () => listarIdsCatalogo(
      { clienteId: prepared.cliente.id, mlUserId: prepared.mlUserId, maxItens: config.maxCatalogItems },
      deps.mlFetchCatalogo
    ),
    {
      config, sleep, signal,
      onRetry: ({ tentativa, delayMs, classificacao }) => {
        stats.retries += 1;
        if (classificacao.rateLimited) stats.rateLimitedRetries += 1;
        logger.warn?.(`${LOG} listagem do catálogo: nova tentativa ${tentativa + 1} em ${delayMs}ms (status=${classificacao.status ?? "rede"})`);
      },
    }
  );
  if (!listagem.ok) {
    // Sem catálogo não existe lote para processar: falha estrutural do run.
    const err = erroTipado(
      listagem.error?.code || "MARGIN_SNAPSHOT_CATALOGO_FALHOU",
      `Falha ao listar o catálogo após ${listagem.attempts} tentativa(s): ${mensagemCurta(listagem.error)}`
    );
    throw err;
  }

  const ids = listagem.value.ids;
  const total = ids.length;
  logger.log?.(`${LOG} catálogo listado: ${total} item(ns) (ativos=${listagem.value.totalAtivos ?? "?"}, pausados=${listagem.value.totalPausados ?? "?"})`);

  // Só contadores e ids — nunca payload do ML, token ou dado financeiro.
  function resumoMetadata() {
    return {
      processor: {
        catalogo: { total, ativos: listagem.value.totalAtivos ?? null, pausados: listagem.value.totalPausados ?? null },
        retries: stats.retries,
        rateLimitedRetries: stats.rateLimitedRetries,
        lotesFalhos: stats.lotesFalhos,
        itensNaoRetornados: stats.itensNaoRetornados,
        itensForaDoCatalogo: stats.itensForaDoCatalogo,
        duracaoMs: clock() - inicio,
      },
    };
  }

  let processedItems = 0;
  let successItems = 0;
  let failedItems = 0;
  let falhasConsecutivas = 0;

  await registrarProgresso({ processedItems, successItems, failedItems, cursorOffset: 0, totalItems: total });

  // ── 3. Lotes sequenciais ────────────────────────────────────────────────
  // Nunca Promise.all de lotes; nunca teto de 200. Um lote termina (sucesso
  // ou falha definitiva) antes do próximo começar.
  for (let offset = 0; offset < total; offset += BATCH_SIZE) {
    verificarParada();
    const loteIds = ids.slice(offset, offset + BATCH_SIZE);

    const tentativa = await executarComRetry(
      () => enrichBatch(prepared, { itemIds: loteIds }, { ...deps, db }),
      {
        config, sleep, signal,
        onRetry: ({ tentativa: n, delayMs, classificacao }) => {
          stats.retries += 1;
          if (classificacao.rateLimited) stats.rateLimitedRetries += 1;
          logger.warn?.(`${LOG} lote offset=${offset}: nova tentativa ${n + 1} em ${delayMs}ms (status=${classificacao.status ?? "rede"}${classificacao.rateLimited ? ", rate limit" : ""})`);
        },
      }
    );

    if (tentativa.ok) {
      falhasConsecutivas = 0;
      const retornados = new Set();
      for (const item of tentativa.value.itens || []) {
        const itemId = item?.identity?.itemId ? String(item.identity.itemId) : "";
        // O multiget pode devolver entrada de erro sem id (item excluído entre
        // a listagem e o detalhe): não é snapshot, é "não retornado" abaixo.
        if (!itemId || !loteIds.includes(itemId) || retornados.has(itemId)) continue;
        retornados.add(itemId);
        try {
          const dados = mapItemParaSnapshot({ item, run, base: prepared.base, observedAt });
          await upsertProjectionSnapshot(dados, db);
          successItems += 1;
        } catch (err) {
          // Falha técnica isolada de persistência: a linha anterior (se
          // existir) fica intocada — o UPSERT simplesmente não aconteceu.
          failedItems += 1;
          logger.error?.(`${LOG} item ${itemId} falhou ao persistir snapshot: ${mensagemCurta(err)}`);
        }
      }

      const naoRetornados = loteIds.filter((id) => !retornados.has(id));
      if (naoRetornados.length) {
        stats.itensNaoRetornados += naoRetornados.length;
        failedItems += naoRetornados.length;
        await markSnapshotsRefreshFailed({
          clienteId: run.clienteId, clienteContaId: run.clienteContaId, marketplace,
          itemIds: naoRetornados, runId: run.id,
          lastError: "Item listado no catálogo, mas não retornado pelo detalhe do Mercado Livre nesta leitura.",
          db,
        });
      }
    } else {
      // Falha DEFINITIVA do lote: falha parcial do run, não exceção. As
      // linhas que já existiam ficam com valores anteriores + status failed.
      falhasConsecutivas += 1;
      stats.lotesFalhos += 1;
      failedItems += loteIds.length;
      const motivo = `Lote não pôde ser recalculado (${tentativa.motivo}, ${tentativa.attempts} tentativa(s)): ${mensagemCurta(tentativa.error)}`;
      logger.error?.(`${LOG} lote offset=${offset} falhou definitivamente: ${motivo}`);
      await markSnapshotsRefreshFailed({
        clienteId: run.clienteId, clienteContaId: run.clienteContaId, marketplace,
        itemIds: loteIds, runId: run.id, lastError: motivo, db,
      });

      if (falhasConsecutivas >= config.maxConsecutiveBatchFailures) {
        processedItems += loteIds.length;
        await registrarProgresso({ processedItems, successItems, failedItems, cursorOffset: offset + loteIds.length, totalItems: total });
        await mergeRunMetadata({ runId: run.id, patch: resumoMetadata(), db });
        throw erroTipado(
          "MARGIN_SNAPSHOT_LOTES_FALHANDO",
          `${falhasConsecutivas} lote(s) seguidos falharam; run interrompido. Último erro: ${mensagemCurta(tentativa.error)}`
        );
      }
    }

    processedItems += loteIds.length;
    // Cursor só avança DEPOIS de todo o lote persistido/marcado. O mesmo
    // UPDATE renova heartbeat_at (é o heartbeat "por lote").
    await registrarProgresso({ processedItems, successItems, failedItems, cursorOffset: offset + loteIds.length, totalItems: total });

    if (config.batchPauseMs > 0 && offset + BATCH_SIZE < total) {
      await sleep(config.batchPauseMs, signal);
    }
  }

  // ── 4. Itens fora do catálogo (listagem completa e bem-sucedida) ────────
  const foraDoCatalogo = await markSnapshotsOutsideCatalog({
    clienteId: run.clienteId, clienteContaId: run.clienteContaId, marketplace,
    catalogItemIds: ids, runId: run.id, db,
  });
  stats.itensForaDoCatalogo = foraDoCatalogo.length;

  await mergeRunMetadata({ runId: run.id, patch: resumoMetadata(), db });

  // Nenhum item calculado num catálogo não vazio = nada foi atualizado: o
  // run não pode terminar "completed" fingindo sucesso.
  if (total > 0 && successItems === 0) {
    throw erroTipado(
      "MARGIN_SNAPSHOT_NENHUM_ITEM_CALCULADO",
      `Nenhum dos ${total} item(ns) do catálogo pôde ser recalculado neste run.`
    );
  }

  logger.log?.(`${LOG} concluído: ${successItems}/${total} ok, ${failedItems} falha(s), ${stats.retries} retry(s), ${stats.itensForaDoCatalogo} fora do catálogo, ${clock() - inicio}ms`);

  return { processedItems, successItems, failedItems, totalItensMl: total, cursorOffset: total, stats };
}

module.exports = {
  BATCH_SIZE,
  MARKETPLACES_SUPORTADOS,
  MarginSnapshotMarketplaceNaoSuportadoError,
  mapItemParaSnapshot,
  evidenciasProjetadas,
  carregarVendasVazias,
  agregadoVazio,
  processMarginSnapshotRun,
};
