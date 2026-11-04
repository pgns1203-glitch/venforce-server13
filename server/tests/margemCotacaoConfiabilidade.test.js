// server/tests/margemCotacaoConfiabilidade.test.js
//
// P0 04/11/2026 — confiabilidade financeira da Central de Margem.
// Caso real: Alianza Jeans 2 (conta 87, grant 114, seller 2433262404) é a conta
// SECUNDÁRIA do cliente; a principal é a conta 86 (grant 113, seller
// 1587129755). Cinco runs: 532/532 "cotação incompleta".
//
// Um "Mercado Livre" falso com DOIS vendedores responde como o real: só o token
// do DONO lê o anúncio (multiget devolve 403 por entrada para token de outro
// usuário — doc erro-403: "access token de outro usuário"). O mlFetch falso
// resolve o token como o mlFetch real: sem `mlUserId` ⇒ grant PRINCIPAL.
//
// Cadeia REAL: enrichBatch → meliApiEvidenceAdapter → marketplaceCurrentQuoteService
// → núcleo → processor → repository (fake db em memória). Nenhuma chamada real.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://nobody@127.0.0.1:1/teste-sem-banco";

const assert = require("assert");
const motorMargem = require("../services/motorMargem/motorMargemService");
const meliApi = require("../services/motorMargem/adapters/meliApiEvidenceAdapter");
const { buscarComissaoEFrete } = require("../services/shared/marketplaceCurrentQuoteService");
const { buildCostIndex } = require("../services/motorMargem/adapters/baseCustosEvidenceAdapter");
const { processMarginSnapshotRun } = require("../services/motorMargem/marginSnapshotProcessor");
const { resolveMarginSnapshotConfig } = require("../services/motorMargem/marginSnapshotConfig");
const { createRateLimiter } = require("../services/motorMargem/marginSnapshotRateLimiter");
const snapshotRepository = require("../services/motorMargem/marginSnapshotRepository");
const runRepository = require("../services/motorMargem/marginSnapshotRunRepository");
const { makeMarginSnapshotFakeDb } = require("./helpers/marginSnapshotFakeDb");
const { MlTimeoutError } = require("../utils/mlClient");
const core = require("../services/motorMargem/core");

const NOW = new Date("2026-11-04T12:00:00.000Z");
const SILENCIOSO = { log() {}, warn() {}, error() {} };
const SELLER_1 = "1587129755"; // conta 86 — grant 113 PRINCIPAL
const SELLER_2 = "2433262404"; // conta 87 — grant 114 secundário

let checks = 0;
const casos = [];
function cenario(nome, fn) { casos.push({ nome, fn }); }
function ok(cond, msg) { assert.ok(cond, msg); checks += 1; }

// ── Mercado Livre falso ─────────────────────────────────────────────────────
function mundoMl({ listing = null, frete = null } = {}) {
  const anuncios = {
    MLB201: { seller: SELLER_2, price: 50, category_id: "MLB1430", listing_type_id: "gold_special", logistic_type: "fulfillment" },
    MLB202: { seller: SELLER_2, price: 80, category_id: "MLB1430", listing_type_id: "gold_special", logistic_type: "not_specified" },
    MLB101: { seller: SELLER_1, price: 60, category_id: "MLB1430", listing_type_id: "gold_pro", logistic_type: "cross_docking" },
  };
  const chamadas = [];
  async function mlFetch(clienteId, path, opts = {}) {
    const dono = opts && opts.mlUserId ? String(opts.mlUserId) : SELLER_1; // sem mlUserId ⇒ principal
    chamadas.push({ path: String(path), dono });
    const p = String(path);
    if (p.startsWith("/items?ids=")) {
      const ids = p.slice("/items?ids=".length).split(",");
      return {
        ok: true, status: 200,
        data: ids.map((id) => {
          const a = anuncios[id];
          if (!a) return { code: 404, body: { message: "not found", error: "not_found", status: 404 } };
          if (a.seller !== dono) {
            return { code: 403, body: { id, message: "access to the requested resource is forbidden", error: "access_denied", status: 403 } };
          }
          return { code: 200, body: { id, seller_id: Number(a.seller), title: `Anúncio ${id}`, price: a.price, category_id: a.category_id,
            listing_type_id: a.listing_type_id, status: "active", shipping: { logistic_type: a.logistic_type } } };
        }),
      };
    }
    if (p.startsWith("/sites/MLB/listing_prices")) {
      if (listing) return listing({ path: p, dono });
      return { ok: true, status: 200, data: [{ sale_fee_amount: 7.0, sale_fee_details: { percentage_fee: 14 } }] };
    }
    const fr = p.match(/^\/users\/(\d+)\/shipping_options\/free/);
    if (fr) {
      if (frete) return frete({ path: p, dono });
      if (fr[1] !== dono) return { ok: false, status: 403, data: { status: 403, error: "access_denied" } };
      return { ok: true, status: 200, data: { coverage: { all_country: { list_cost: 9.5 } } } };
    }
    return { ok: false, status: 404, data: null };
  }
  // preço vigente (sale_price) pela mesma regra de dono.
  async function resolverPrecosItem({ itemId, precoListaFallback, mlUserId }) {
    const a = anuncios[itemId];
    const dono = mlUserId ? String(mlUserId) : SELLER_1;
    chamadas.push({ path: `/items/${itemId}/sale_price`, dono });
    if (!a || a.seller !== dono) {
      return { precoCheio: precoListaFallback, precoPromocional: null, precoEfetivo: precoListaFallback, fonte: "fallback_lista" };
    }
    return { precoCheio: a.price, precoPromocional: null, precoEfetivo: a.price, fonte: "sale_price", promotionIdAtivo: null };
  }
  return { anuncios, chamadas, mlFetch, resolverPrecosItem };
}

function prepared(mlUserId, extra = {}) {
  return {
    now: NOW,
    cliente: { id: 7, nome: "Alianza Jeans", slug: "alianza_jeans" },
    base: { id: 900, slug: "base-alianza", nome: "Base" },
    mlUserId,
    custos: {
      index: buildCostIndex([
        { produto_id: "MLB201", custo_produto: 22, imposto_percentual: 0.1, taxa_fixa: 0, produto_nome: "Calça", updated_at: NOW },
        { produto_id: "MLB202", custo_produto: 30, imposto_percentual: 0.1, taxa_fixa: 0, produto_nome: "Short", updated_at: NOW },
        { produto_id: "MLB101", custo_produto: 25, imposto_percentual: 0.1, taxa_fixa: 0, produto_nome: "Saia", updated_at: NOW },
      ]),
      total: 3,
    },
    porMlb: new Map(), reembolsoPorMlb: new Map(), fallbackObservedAt: null,
    ...extra,
  };
}

function depsMundo(w) {
  return {
    buscarDetalhesItens: (args) => meliApi.buscarDetalhesItens(args, w.mlFetch),
    mlFetchFn: w.mlFetch,
    resolverPrecosItemFn: w.resolverPrecosItem,
  };
}

// ── 1. Duas contas ML, grants diferentes ────────────────────────────────────
cenario("conta SECUNDÁRIA: toda chamada ao ML sai com o seller da conta (nunca o grant principal)", async () => {
  const w = mundoMl();
  const r = await motorMargem.enrichBatch(prepared(SELLER_2), { itemIds: ["MLB201", "MLB202"] }, depsMundo(w));
  ok(w.chamadas.length > 0, "houve chamadas");
  ok(w.chamadas.every((c) => c.dono === SELLER_2), `chamada com outro grant: ${JSON.stringify(w.chamadas.filter((c) => c.dono !== SELLER_2))}`);
  ok(r.itens.length === 2 && r.errosDetalhe.length === 0, "os dois anúncios voltam");
  const i201 = r.itens.find((i) => i.identity.itemId === "MLB201");
  ok(i201.diagnostico.statusAnuncio === "active", "status do anúncio, não do erro");
  ok(i201.diagnostico.faltantesMeliApi.length === 0, "comissão, frete e preço presentes");
  // 50 − 5 (10%) − 7 (comissão) − 9,5 (frete) − 22 (custo) = 6,5 → 13%
  ok(Math.abs(i201.margin.projected.profit - 6.5) < 0.001, `lucro ${i201.margin.projected.profit}`);
  ok(i201.margin.projected.assumed.length === 0, "nada assumido como 0");
});

cenario("conta PRINCIPAL: usa só o próprio seller e não lê anúncios da secundária", async () => {
  const w = mundoMl();
  const r = await motorMargem.enrichBatch(prepared(SELLER_1), { itemIds: ["MLB101"] }, depsMundo(w));
  ok(w.chamadas.every((c) => c.dono === SELLER_1));
  ok(r.itens.length === 1 && r.itens[0].diagnostico.faltantesMeliApi.length === 0);
});

cenario("regressão do bug: multiget com o token principal → 403 por entrada vira ERRO, nunca anúncio com status 403", async () => {
  const w = mundoMl();
  const bodies = await meliApi.buscarDetalhesItens({ clienteId: 7, ids: ["MLB201", "MLB202"] }, w.mlFetch); // sem mlUserId = comportamento antigo
  ok(bodies.length === 0, "corpo de erro não é aceito como anúncio");
  ok(bodies.erros.length === 2 && bodies.erros.every((e) => e.status === 403 && e.id), JSON.stringify(bodies.erros));
  const comConta = await meliApi.buscarDetalhesItens({ clienteId: 7, ids: ["MLB201"], mlUserId: SELLER_2 }, w.mlFetch);
  ok(comConta.length === 1 && comConta[0].status === "active");
  // formato /items/bulk (status_code) também é entendido
  const bulk = await meliApi.buscarDetalhesItens({ clienteId: 7, ids: ["X"], mlUserId: SELLER_2 }, async () => ({
    ok: true, status: 200, data: [{ id: "MLB9", status_code: 200, body: { id: "MLB9", status: "active" } }, { id: "MLB8", status_code: 403, body: { status: 403 } }],
  }));
  ok(bulk.length === 1 && bulk.erros[0].id === "MLB8" && bulk.erros[0].status === 403);
});

cenario("sem mlUserId o Motor RECUSA ler (ML_USER_ID_AUSENTE) — não cai no grant da principal", async () => {
  const w = mundoMl();
  let erro = null;
  try { await motorMargem.enrichBatch(prepared(null), { itemIds: ["MLB201"] }, depsMundo(w)); } catch (e) { erro = e; }
  ok(erro && erro.code === "ML_USER_ID_AUSENTE", String(erro && erro.message));
  ok(w.chamadas.length === 0, "nenhuma chamada ao ML");
});

// ── 2. Cotação: cada falha com status e motivo; ausente nunca vira 0 ───────
const ARGS = { clienteId: 7, itemId: "MLB201", precoEfetivo: 50, listingTypeId: "gold_special", categoryId: "MLB1430", sellerId: SELLER_2, logisticType: "fulfillment", mlUserId: SELLER_2 };
const okListing = async () => ({ ok: true, status: 200, data: [{ sale_fee_amount: 7, sale_fee_details: { percentage_fee: 14 } }] });
const okFrete = async () => ({ ok: true, status: 200, data: { coverage: { all_country: { list_cost: 9.5 } } } });
function fetchCom(listing, frete, chamadas = []) {
  return async (cId, path, opts) => {
    chamadas.push({ path, opts });
    return String(path).includes("listing_prices") ? listing() : frete();
  };
}

cenario("cotação válida: valores + diagnóstico sem motivo; mlUserId nas DUAS chamadas", async () => {
  const chamadas = [];
  const r = await buscarComissaoEFrete(ARGS, fetchCom(okListing, okFrete, chamadas));
  ok(r.comissaoValor === 7 && r.fretePrevisto === 9.5);
  ok(r.diagnostico.comissao.motivo === null && r.diagnostico.frete.motivo === null);
  ok(r.diagnostico.comissao.status === 200 && r.diagnostico.frete.status === 200);
  ok(chamadas.length === 2 && chamadas.every((c) => c.opts && c.opts.mlUserId === SELLER_2), "listing_prices também com a conta");
});

const FALHAS = [
  ["HTTP 403", async () => ({ ok: false, status: 403, data: { status: 403 } }), "ml_sem_permissao", 403],
  ["HTTP 429", async () => ({ ok: false, status: 429, data: null }), "ml_rate_limit", 429],
  ["HTTP 503", async () => ({ ok: false, status: 503, data: null }), "ml_indisponivel", 503],
  ["timeout", async () => { throw new MlTimeoutError("ML_DEADLINE_EXCEEDED", "prazo", { enviado: true }); }, "ml_timeout", null],
  ["exceção de rede", async () => { throw Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }); }, "ml_indisponivel", null],
];
for (const [nome, resposta, motivo, status] of FALHAS) {
  cenario(`comissão com ${nome}: null (nunca 0) + motivo ${motivo}`, async () => {
    const r = await buscarComissaoEFrete(ARGS, fetchCom(resposta, okFrete));
    ok(r.comissaoValor === null && r.comissaoPercentual === null, "ausente fica null");
    ok(r.diagnostico.comissao.motivo === motivo, `${r.diagnostico.comissao.motivo} ≠ ${motivo}`);
    ok(r.diagnostico.comissao.status === status);
    ok(r.fretePrevisto === 9.5, "o frete que veio fica");
  });
  cenario(`frete com ${nome}: null (nunca 0) + motivo ${motivo}`, async () => {
    const r = await buscarComissaoEFrete(ARGS, fetchCom(okListing, resposta));
    ok(r.fretePrevisto === null && r.diagnostico.frete.motivo === motivo && r.diagnostico.frete.aplicavel === true);
  });
}

cenario("payload incompleto (200 sem sale_fee_amount / sem list_cost): ausente + ml_sem_tarifa / ml_sem_frete", async () => {
  const r = await buscarComissaoEFrete(ARGS, fetchCom(async () => ({ ok: true, status: 200, data: [{}] }), async () => ({ ok: true, status: 200, data: { coverage: {} } })));
  ok(r.comissaoValor === null && r.diagnostico.comissao.motivo === "ml_sem_tarifa" && r.diagnostico.comissao.status === 200);
  ok(r.fretePrevisto === null && r.diagnostico.frete.motivo === "ml_sem_frete");
});

cenario("logística combinável: frete NÃO consultado, não aplicável, sem motivo (ausência legítima)", async () => {
  const chamadas = [];
  const r = await buscarComissaoEFrete({ ...ARGS, logisticType: "not_specified" }, fetchCom(okListing, okFrete, chamadas));
  ok(chamadas.length === 1 && String(chamadas[0].path).includes("listing_prices"));
  ok(r.fretePrevisto === null && r.diagnostico.frete.aplicavel === false && r.diagnostico.frete.motivo === null);
});

cenario("anúncio sem categoria/tipo: comissão nem é consultada, motivo explícito", async () => {
  const chamadas = [];
  const r = await buscarComissaoEFrete({ ...ARGS, categoryId: null, listingTypeId: null }, fetchCom(okListing, okFrete, chamadas));
  ok(chamadas.length === 0);
  ok(r.diagnostico.comissao.motivo === "anuncio_sem_tipo_ou_categoria");
});

// ── 3. Margem incompleta nunca é "saudável" ────────────────────────────────
cenario("comissão e frete ausentes: margem (R$ 50 → 46%) é Dado suspeito, nunca Saudável, e o processor não grava", async () => {
  const w = mundoMl({ listing: async () => ({ ok: false, status: 403, data: null }), frete: async () => ({ ok: false, status: 403, data: null }) });
  const r = await motorMargem.enrichBatch(prepared(SELLER_2), { itemIds: ["MLB201"] }, depsMundo(w));
  const item = r.itens[0];
  ok(item.margin.projected.assumed.includes("commission") && item.margin.projected.assumed.includes("freight"));
  ok(item.quality.status !== "HEALTHY", `status ${item.quality.status}`);
  ok(item.quality.status === core.STATUS.SUSPECT_DATA, item.quality.status);
  ok(item.margin.projected.margin > 0.4, "o número inflado existe no núcleo (por isso não pode ser exibido/gravado)");
  ok(item.diagnostico.cotacao.comissao.motivo === "ml_sem_permissao" && item.diagnostico.cotacao.comissao.status === 403);
});

// ── 4. Processor: snapshot anterior preservado + motivo por item e no run ──
async function rodarProcessor(w, { sementes = [] } = {}) {
  const db = makeMarginSnapshotFakeDb();
  for (const s of sementes) await snapshotRepository.upsertProjectionSnapshot(s, db);
  let run = await runRepository.createRun({ clienteId: 7, clienteSlug: "alianza_jeans", clienteContaId: 87, marketplace: "meli", reason: "manual_refresh", db });
  run = await runRepository.updateRunStatus({ runId: run.id, status: "running", db });
  const cfg = { ...resolveMarginSnapshotConfig({}), batchPauseMs: 0, batchBackoffBaseMs: 1, batchBackoffMaxMs: 1 };
  const relogio = { t: 0 };
  const sleep = async (ms) => { relogio.t += ms; };
  let erro = null;
  try {
    await processMarginSnapshotRun(run, {
      db, logger: SILENCIOSO, config: cfg, sleep,
      rateLimiter: createRateLimiter({ minIntervalMs: 0, now: () => relogio.t, sleep }),
      prepareWorkspaceContext: async () => prepared(SELLER_2),
      listarIdsCatalogo: async () => ({ ids: ["MLB201", "MLB202"], total: 2, totalAtivos: 2, totalPausados: 0 }),
      ...depsMundo(w),
    });
  } catch (e) { erro = e; }
  const runFinal = await runRepository.getRunById({ runId: run.id, clienteContaId: 87, db });
  return { db, erro, run: runFinal };
}

function semente(itemId) {
  return {
    clienteId: 7, clienteSlug: "alianza_jeans", clienteContaId: 87, marketplace: "meli", itemId,
    titulo: "anterior", price: 50, profit: 3.1, margin: 0.062, marginPercent: 6.2, status: "LOW_MARGIN",
    confidenceLevel: "HIGH", quality: {}, missing: [], assumed: [], divergences: [], calculatedAt: new Date("2026-10-30T10:00:00Z"),
    sourceUpdatedAt: null, runId: null, refreshStatus: "fresh",
  };
}

cenario("listing_prices 403 em todos: run falha, snapshot anterior INTACTO, last_error e metadata com HTTP 403", async () => {
  const w = mundoMl({ listing: async () => ({ ok: false, status: 403, data: { status: 403 } }) });
  const { db, erro, run } = await rodarProcessor(w, { sementes: [semente("MLB201")] });
  ok(erro && erro.code === "MARGIN_SNAPSHOT_NENHUM_ITEM_CALCULADO", String(erro && (erro.code || erro.message)));
  const s = await snapshotRepository.getProjectionSnapshot({ clienteContaId: 87, itemId: "MLB201", db });
  ok(s.margin === 0.062 && s.profit === 3.1 && s.marginPercent === 6.2, `valores anteriores preservados: ${JSON.stringify({ m: s.margin, p: s.profit })}`);
  ok(s.refreshStatus === "failed", "identificado como não revalidado");
  ok(/comissão: o Mercado Livre recusou o acesso .* \(HTTP 403\)/.test(s.lastError), s.lastError);
  const motivos = run.metadata.processor.motivos;
  ok(motivos.comissao.ml_sem_permissao === 2, JSON.stringify(motivos));
});

cenario("multiget recusado (403) para os itens: last_error diz HTTP 403 na leitura do anúncio; nada gravado", async () => {
  const w = mundoMl();
  // simula o comportamento ANTIGO: detalhe sem a conta (principal) → 403 por entrada
  const deps = depsMundo(w);
  deps.buscarDetalhesItens = (args) => meliApi.buscarDetalhesItens({ ...args, mlUserId: null }, w.mlFetch);
  const db = makeMarginSnapshotFakeDb();
  await snapshotRepository.upsertProjectionSnapshot(semente("MLB201"), db);
  let run = await runRepository.createRun({ clienteId: 7, clienteSlug: "alianza_jeans", clienteContaId: 87, marketplace: "meli", reason: "manual_refresh", db });
  run = await runRepository.updateRunStatus({ runId: run.id, status: "running", db });
  const relogio = { t: 0 };
  const sleep = async (ms) => { relogio.t += ms; };
  let erro = null;
  try {
    await processMarginSnapshotRun(run, {
      db, logger: SILENCIOSO, config: { ...resolveMarginSnapshotConfig({}), batchPauseMs: 0 }, sleep,
      rateLimiter: createRateLimiter({ minIntervalMs: 0, now: () => relogio.t, sleep }),
      prepareWorkspaceContext: async () => prepared(SELLER_2),
      listarIdsCatalogo: async () => ({ ids: ["MLB201", "MLB202"], total: 2, totalAtivos: 2, totalPausados: 0 }),
      ...deps,
    });
  } catch (e) { erro = e; }
  ok(erro && erro.code === "MARGIN_SNAPSHOT_NENHUM_ITEM_CALCULADO");
  const s = await snapshotRepository.getProjectionSnapshot({ clienteContaId: 87, itemId: "MLB201", db });
  ok(s.margin === 0.062 && s.refreshStatus === "failed" && /HTTP 403/.test(s.lastError), s.lastError);
  const runFinal = await runRepository.getRunById({ runId: run.id, clienteContaId: 87, db });
  ok(runFinal.metadata.processor.motivos.detalhe["403"] === 2, JSON.stringify(runFinal.metadata.processor.motivos));
});

cenario("conta secundária com o código novo: run conclui e grava margem com comissão e frete reais", async () => {
  const w = mundoMl();
  const { db, erro } = await rodarProcessor(w, { sementes: [semente("MLB201")] });
  ok(!erro, String(erro && erro.message));
  const s = await snapshotRepository.getProjectionSnapshot({ clienteContaId: 87, itemId: "MLB201", db });
  ok(s.refreshStatus === "fresh" && Math.abs(s.profit - 6.5) < 0.001 && (s.assumed || []).length === 0, JSON.stringify({ p: s.profit, a: s.assumed }));
});

// ── 4b. Linhas antigas com comissão/frete assumidos 0 (o "45% em R$ 50") ──
cenario("Central: linha antiga inflada fica fora de comMargem e no FIM da ordenação por margem (asc e desc)", async () => {
  const db = makeMarginSnapshotFakeDb();
  const base = { clienteId: 7, clienteSlug: "alianza_jeans", clienteContaId: 87, marketplace: "meli", confidenceLevel: "HIGH",
    quality: {}, missing: [], divergences: [], calculatedAt: new Date("2026-10-30T10:00:00Z"), runId: null, refreshStatus: "fresh" };
  await snapshotRepository.upsertProjectionSnapshot({ ...base, itemId: "MLB1", price: 50, profit: 22.5, margin: 0.45, marginPercent: 45,
    status: "SUSPECT_DATA", assumed: ["commission", "freight"] }, db);
  await snapshotRepository.upsertProjectionSnapshot({ ...base, itemId: "MLB2", price: 80, profit: 8, margin: 0.1, marginPercent: 10,
    status: "HEALTHY", assumed: [] }, db);
  await snapshotRepository.upsertProjectionSnapshot({ ...base, itemId: "MLB3", price: 60, profit: 3, margin: 0.05, marginPercent: 5,
    status: "LOW_MARGIN", assumed: [] }, db);
  const filtro = snapshotRepository.montarFiltroSnapshots({ clienteId: 7, clienteContaId: 87 });
  const kpis = await snapshotRepository.summarizeProjectionSnapshots({ filtro, db });
  ok(kpis.comMargem === 2 && kpis.margemIncompleta === 1, JSON.stringify(kpis));
  for (const ordenacao of ["margem_desc", "margem_asc"]) {
    const { orderBy } = snapshotRepository.resolverOrdenacao({ ordenacao });
    const linhas = await snapshotRepository.queryProjectionSnapshotsPage({ filtro, orderBy, limit: 10, offset: 0, db });
    const ids = linhas.map((r) => r.itemId || r.item_id);
    ok(ids[ids.length - 1] === "MLB1", `${ordenacao}: ${ids}`);
  }
});

// ── 5. Cenário promocional bloqueado sem comissão/frete ────────────────────
cenario("promoção/simulação: comissão ausente bloqueia o cenário (nunca aprova)", async () => {
  const svc = require("../services/meliAnuncios/meliPromocoesRebateService");
  const r = svc.margemNoPreco({ preco: 45, custo: 22, aliquota: 0.1, cotacao: { comissao: null, frete: 9.5, frete_aplicavel: true, motivos: { comissao: "ml_sem_permissao" } } });
  ok(r.ok === false && r.motivo === "ml_sem_permissao", JSON.stringify(r));
  const r2 = svc.margemNoPreco({ preco: 45, custo: 22, aliquota: 0.1, cotacao: { comissao: 6.3, frete: null, frete_aplicavel: true, motivos: { frete: "ml_timeout" } } });
  ok(r2.ok === false, JSON.stringify(r2));
});

(async () => {
  let falhas = 0;
  for (const { nome, fn } of casos) {
    try { await fn(); console.log(`  ✓ ${nome}`); } catch (err) { falhas += 1; console.log(`  ✗ ${nome}\n    ${err && err.stack ? err.stack.split("\n").slice(0, 3).join("\n    ") : err}`); }
  }
  console.log(`\nmargemCotacaoConfiabilidade: ${casos.length - falhas}/${casos.length} cenários, ${checks} checks`);
  if (falhas) process.exit(1);
})();
