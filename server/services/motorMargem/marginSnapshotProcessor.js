// server/services/motorMargem/marginSnapshotProcessor.js
// Margin Snapshot — Processor real (M3, ver
// docs/AUDITORIA_WORKERS_E_PLANO_MARGIN_SNAPSHOT.md §5/§8/§9/§10, e
// PROMPT_M3_MARGIN_SNAPSHOT_PROCESSOR_REAL_BATCHES.md).
//
// Este é o processor que o worker de M2 (marginSnapshotWorker.createMarginSnapshotWorker)
// chama por injeção depois de reivindicar (`claim`) um run `running`. M2 não tinha
// processor real algum — só um fake nos testes. M3 entrega o primeiro processor que
// de fato:
//
//   run claimado (running, cliente_conta_id sempre presente — §6 do prompt)
//     → prepareWorkspaceContext UMA VEZ (Motor de Margem, motorMargemService.js)
//     → loop SEQUENCIAL de lotes de 20 itens (mesmo teto natural do multiget
//       /items?ids= do ML — PAGE_LIMIT_MAX em motorMargemService.js)
//     → enrichBatch por lote (reaproveita o Motor, ZERO fórmula nova de margem)
//     → mapeia margem PROJETADA (nunca realizada) para o contrato de
//       margin_projection_snapshots
//     → upsertProjectionSnapshot por item dentro do lote
//     → updateRunProgress uma vez por lote (heartbeat_at é atualizado pela MESMA
//       query — não existe chamada extra a touchHeartbeat por lote, ver nota
//       abaixo)
//
// NÃO usa `carregarWorkspace`: essa função tem o teto de leitura de tela
// (RESUMO_MAX_ITENS_TETO=200, motorMargemService.js) e não persiste nada por
// lote. Este processor caminha o catálogo inteiro (offset < totalItensMl),
// sem clamp — o próprio ponto de M3 é provar que o catálogo inteiro pode ser
// atualizado em background.
//
// NÃO refaz nenhuma conta do Motor: profit/margin/marginPercent/status vêm
// prontos de `item.margin.projected`/`item.quality`, só copiados.

const pool = require("../../config/database");
const motorMargem = require("./motorMargemService");
const snapshotRepository = require("./marginSnapshotRepository");
const runRepository = require("./marginSnapshotRunRepository");
const { FIELDS } = require("./core/marginEvidence");

// Mesmo valor de PAGE_LIMIT_MAX do Motor (motorMargemService.js) — teto do
// multiget /items?ids= do Mercado Livre. Não é um número novo inventado por
// M3: é o próprio teto que já rege enrichBatch (§3.B do prompt: "não
// inventar lote de 100/500").
const BATCH_SIZE = motorMargem.PAGE_LIMIT_MAX;

// M3 só implementa Mercado Livre (§7 do prompt). O schema aceita outros
// marketplaces por arquitetura futura (coluna TEXT livre, sem CHECK), mas o
// processor não tenta rodar nenhum adapter que não seja o do Motor de Margem
// atual — que hoje só sabe falar com o ML.
const MARKETPLACES_SUPORTADOS = ["meli"];

class MarginSnapshotMarketplaceNaoSuportadoError extends Error {
  constructor(marketplace) {
    super(
      `Margin Snapshot: marketplace "${marketplace}" não suportado pelo processor (M3 só implementa "meli").`
    );
    this.name = "MarginSnapshotMarketplaceNaoSuportadoError";
    this.code = "MARGIN_SNAPSHOT_MARKETPLACE_NAO_SUPORTADO";
  }
}

function isoOrNull(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  return value;
}

// Valor PROJETADO de uma variável do Motor — nunca `valor || 0` (§12 do
// prompt): campo ausente (`.projected` null) vira `null`, nunca 0. `?? null`
// não confunde 0 real com ausência porque só reage a null/undefined.
function valorProjetado(item, fieldKey) {
  const field = item.fields[fieldKey];
  const projetado = field && field.projected ? field.projected.value : undefined;
  return projetado ?? null;
}

// ---------------------------------------------------------------------------
// Mapeamento item canônico do Motor -> snapshot (§10/§11/§12/§13/§14 do prompt)
// ---------------------------------------------------------------------------
//
// Só a fotografia PROJETADA/atual. Nunca `pricing.sold`, `item.margin.realized`,
// `item.sales`, reembolso ou pedido — isso continua vivendo só na Central de
// Vendas por período (§11).
function mapItemParaSnapshot({ item, run, base, observedAt }) {
  return {
    clienteId: run.clienteId,
    // §6: SEMPRE a conta explícita do run — nunca `prepared.cliente`/`conta`
    // auto-resolvida. Conta 5 nunca pode produzir snapshot da conta 6.
    clienteContaId: run.clienteContaId,
    marketplace: run.marketplace,
    itemId: item.identity.itemId,
    sku: item.identity.sku,
    titulo: item.identity.titulo,
    baseId: base ? base.id : null,

    price: valorProjetado(item, FIELDS.PRICE),
    listPrice: valorProjetado(item, FIELDS.LIST_PRICE),
    promoPrice: valorProjetado(item, FIELDS.PROMO_PRICE),
    cost: valorProjetado(item, FIELDS.COST),
    taxRate: valorProjetado(item, FIELDS.TAX_RATE),
    fixedFee: valorProjetado(item, FIELDS.FIXED_FEE),
    commission: valorProjetado(item, FIELDS.COMMISSION),
    commissionRate: valorProjetado(item, FIELDS.COMMISSION_RATE),
    freight: valorProjetado(item, FIELDS.FREIGHT),

    // Copiado do núcleo — nunca recalculado aqui (§10).
    profit: item.margin.projected.profit,
    margin: item.margin.projected.margin,
    marginPercent: item.margin.projected.marginPercent,
    status: item.quality.status,

    confidenceLevel: item.quality.confidence,
    // Só o que o schema M1 define — nunca o item inteiro (§13).
    quality: {
      confidence: item.quality.confidence,
      confidenceByField: item.quality.confidenceByField,
      reasons: item.quality.reasons,
      hasConflict: item.quality.hasConflict,
      hasDrift: item.quality.hasDrift,
      statusLabel: item.quality.statusLabel,
      statusSeverity: item.quality.statusSeverity,
      statusReasons: item.quality.statusReasons,
    },
    // missing/assumed são os da margem PROJETADA (a única persistida) — nunca
    // os da realizada.
    missing: item.margin.projected.missing,
    assumed: item.margin.projected.assumed,
    divergences: item.quality.divergences,

    // observed_at: o mesmo `now` que o Motor carimbou em toda evidência
    // MELI_API deste run (prepareWorkspaceContext → enrichBatch →
    // aplicarEvidenciasProjetadas). É evidência real do Motor, nunca
    // inventada (§14).
    observedAt,
    // calculated_at: null → o repository/DB preenche com NOW() no momento do
    // upsert (COALESCE($27, NOW()) em marginSnapshotRepository), que É o
    // "momento do cálculo atual do processor" (§14).
    calculatedAt: null,
    // source_updated_at: DECISÃO PENDENTE do plano (§8.2 da auditoria) — o
    // body de /items?ids= do ML pode trazer `last_updated`, mas
    // `meliApiEvidenceAdapter.aplicarEvidenciasProjetadas` não repassa esse
    // campo no contrato hoje, e M3 optou por ZERO refatoração estrutural do
    // Motor nesta rodada (§2 do prompt). Não inventar timestamp — fica null.
    sourceUpdatedAt: null,

    runId: run.id,
    refreshStatus: "fresh",
    lastError: null,
  };
}

// ---------------------------------------------------------------------------
// Processor
// ---------------------------------------------------------------------------
//
// Assinatura compatível com o que marginSnapshotWorker.runOnce() já chama:
// `processor(run, { db })`. `deps` aceita overrides de TODAS as peças
// injetáveis (prepareWorkspaceContext, enrichBatch, upsertProjectionSnapshot,
// updateRunProgress) — é assim que os testes evitam qualquer chamada real ao
// Mercado Livre ou ao Postgres.
async function processMarginSnapshotRun(run, deps = {}) {
  if (!run || !run.id) {
    throw new Error("processMarginSnapshotRun: run é obrigatório.");
  }
  // §6: nunca depender de auto-resolução — o run já É a conta.
  if (!run.clienteContaId) {
    throw new Error("processMarginSnapshotRun: run.clienteContaId é obrigatório (nunca auto-resolver).");
  }

  const marketplace = String(run.marketplace || "").trim().toLowerCase();
  if (!MARKETPLACES_SUPORTADOS.includes(marketplace)) {
    // Falha tipada/controlada (§7) — nunca tenta rodar um adapter errado.
    // Propaga para o worker, que marca o run FAILED (mesmo caminho de
    // qualquer erro estrutural, §17).
    throw new MarginSnapshotMarketplaceNaoSuportadoError(run.marketplace);
  }

  const db = deps.db || pool;
  const prepareWorkspaceContext = deps.prepareWorkspaceContext || motorMargem.prepareWorkspaceContext;
  const enrichBatch = deps.enrichBatch || motorMargem.enrichBatch;
  const upsertProjectionSnapshot = deps.upsertProjectionSnapshot || snapshotRepository.upsertProjectionSnapshot;
  const updateRunProgress = deps.updateRunProgress || runRepository.updateRunProgress;

  // Contexto resolvido UMA VEZ por run (§5): cliente/grant/Base, custos,
  // Central de Vendas do período e agregação por MLB. Nunca repetido por
  // lote. A conta é passada explicitamente — exigirContextoPronto (dentro de
  // prepareWorkspaceContext) valida que ela pertence ao cliente e propaga
  // qualquer erro estrutural (conta de outro cliente, marketplace
  // incompatível, conta inativa) sem engolir.
  const prepared = await prepareWorkspaceContext(
    { clienteSlug: run.clienteSlug, clienteContaId: run.clienteContaId },
    { ...deps, db }
  );

  // Timestamp único de observação do MELI_API para todo o run — é
  // literalmente o `now` que o Motor carimba em cada evidência projetada
  // (ver nota em mapItemParaSnapshot).
  const observedAt = isoOrNull(prepared.now);

  const limit = BATCH_SIZE;
  let offset = run.cursorOffset || 0;
  let processedItems = run.processedItems || 0;
  let successItems = run.successItems || 0;
  let failedItems = run.failedItems || 0;
  let totalItensMl = run.totalItems ?? null;

  // Loop de lotes — SEMPRE sequencial (§22: nunca Promise.all do catálogo
  // inteiro, nunca paralelizar lotes). Continua enquanto offset < total do
  // catálogo real do ML — nunca um `for` com teto hardcoded (§9), nunca o
  // clamp de 200 de RESUMO_MAX_ITENS_TETO (§4/§28).
  // eslint-disable-next-line no-constant-condition
  while (totalItensMl === null || offset < totalItensMl) {
    // Falha de LOTE (fetch de catálogo/detalhe no ML) é estrutural — nunca
    // capturada aqui. Propaga, o worker marca o run FAILED (§17: "não
    // transformar erro estrutural em 5.000 missing").
    const resultado = await enrichBatch(prepared, { offset, limit }, { ...deps, db });
    totalItensMl = resultado.totalItensMl;

    if (!resultado.itens.length) {
      // Lote vazio encerra de forma segura (§9/§21) — sem avançar o cursor
      // (nada foi persistido), mas ainda registra o total/heartbeat mais
      // recente conhecido.
      await updateRunProgress({
        runId: run.id,
        processedItems,
        successItems,
        failedItems,
        cursorOffset: offset,
        totalItems: totalItensMl,
        db,
      });
      break;
    }

    for (const item of resultado.itens) {
      processedItems += 1;
      try {
        // §18: item UNVALIDATED (dado ausente, sem exceção) é um snapshot
        // válido — persiste normalmente, conta como sucesso. Só uma exceção
        // real (falha técnica) cai no catch abaixo.
        const dados = mapItemParaSnapshot({ item, run, base: prepared.base, observedAt });
        await upsertProjectionSnapshot(dados, db);
        successItems += 1;
      } catch (err) {
        // §17/§19: erro isolado de item nunca derruba o lote nem apaga o
        // snapshot anterior — o UPSERT desse item simplesmente não
        // aconteceu; a linha antiga (se existir) permanece intocada.
        failedItems += 1;
        (deps.logger || console).error?.(
          `[marginSnapshot] run #${run.id} — item ${item?.identity?.itemId || "?"} falhou ao persistir snapshot:`,
          err?.message
        );
      }
    }

    // Cursor só avança DEPOIS de todo o lote persistido (§16: "não avançar
    // cursor antes de persistir").
    const proximoOffset = offset + limit;

    // updateRunProgress também atualiza heartbeat_at = NOW() na mesma query
    // (marginSnapshotRunRepository.js) — é o heartbeat "por lote" do §21;
    // não existe uma segunda chamada a touchHeartbeat aqui para não gastar
    // um round-trip extra por lote fazendo a mesma coisa duas vezes.
    await updateRunProgress({
      runId: run.id,
      processedItems,
      successItems,
      failedItems,
      cursorOffset: proximoOffset,
      totalItems: totalItensMl,
      db,
    });

    if (proximoOffset >= totalItensMl) break;
    offset = proximoOffset;
  }

  return { processedItems, successItems, failedItems, totalItensMl, cursorOffset: offset };
}

module.exports = {
  BATCH_SIZE,
  MARKETPLACES_SUPORTADOS,
  MarginSnapshotMarketplaceNaoSuportadoError,
  mapItemParaSnapshot,
  processMarginSnapshotRun,
};
