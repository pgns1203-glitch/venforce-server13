// server/services/motorMargem/precificacao/precificacaoOportunidadesService.js
// "Oportunidades de preço e promoção" da Central de Margem — SEM N+1.
//
// Nenhuma chamada ao Mercado Livre. Fontes persistidas, uma consulta cada,
// para a conta inteira:
//   1. PROMO SNAPSHOT da conta (promo_snapshot_itens do run atual, mantido
//      pelo Promo Snapshot Worker — docs/PROMO_SNAPSHOT_ACCOUNT_SYNC.md), já
//      casado numa única consulta com o Margin Snapshot DA MESMA CONTA
//      (custo, imposto, taxa fixa, taxa de comissão e frete projetados);
//   2. realizado da Central de Vendas no período (unidades/receita por MLB).
// Enquanto a conta nunca teve Promo Snapshot, cai no último diagnóstico
// concluído da tela antiga Promoções ML (compatibilidade, marcado como
// `diagnostico_legado`) — a Central não depende mais dessa tela.
//
// Abrir/paginar dispara o auto-trigger (ensureFreshPromoSnapshot): só
// enfileira em background, nunca espera o scan.
//
// A margem pós-promoção é recalculada com core/marginEngine.computeMargin e
// os insumos do snapshot de margem. Comissão vem da TAXA (listing_prices não
// é recotado aqui) e o frete é o atual — por isso toda linha sai marcada
// `estimado:true`; o drawer recota exato, ao vivo, só aquele MLB.
//
// Ordenação simples e explicável (sem elasticidade/forecast/score):
//   com retorno ML  >  mais unidades vendidas  >  maior margem pós-promoção.

const pool = require("../../../config/database");
const { computeMargin } = require("../core/marginEngine");

const STATUS_DISPONIVEIS = new Set(["candidate", "started", "active", "pending"]);
const FRESCO_MIN = 360; // 6h — mesmos limiares de promocoesDiagnosticoService
const ANTIGO_MIN = 1440; // 24h
const LIMITE_PADRAO = 20;
const LIMITE_MAX = 50;

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round2(v) {
  return v === null ? null : Math.round((v + Number.EPSILON) * 100) / 100;
}

function frescor(createdAt, agora) {
  const ts = new Date(createdAt).getTime();
  if (!Number.isFinite(ts)) return { idadeMinutos: null, frescor: null };
  const idadeMinutos = Math.floor((agora - ts) / 60000);
  return { idadeMinutos, frescor: idadeMinutos > ANTIGO_MIN ? "antigo" : idadeMinutos > FRESCO_MIN ? "atencao" : "atual" };
}

function defaults(deps = {}) {
  return {
    db: deps.db || pool,
    resolverContaDoCliente: deps.resolverContaDoCliente || require("../marginSnapshotApiService").resolverContaDoCliente,
    obterConta: deps.obterConta || require("../../clienteContas/clienteContaService").obterConta,
    carregarRealizada:
      deps.carregarRealizada || require("../marginSnapshotReadService").carregarRealizadaDoPeriodo,
    now: deps.now || (() => new Date()),
    // Promo Snapshot (injetável nos testes).
    promo: deps.promo || {
      estadoComAutoTrigger: (identidade, opts) =>
        require("../../promoSnapshot/promoSnapshotReadService").estadoComAutoTrigger(identidade, opts, deps),
      syncPublico: (e, g) => require("../../promoSnapshot/promoSnapshotReadService").syncPublico(e, g),
      listarBase: (args) =>
        (deps.repo || require("../../promoSnapshot/promoSnapshotRepository")).listarBaseOportunidades(args, deps.db || pool),
    },
  };
}

async function consultaOuVazio(db, sql, params) {
  try {
    return (await db.query(sql, params)).rows;
  } catch (err) {
    // Tabela do diagnóstico ainda não criada (nunca rodou nesta instalação).
    if (err && err.code === "42P01") return null;
    throw err;
  }
}

function motivoDa(linha) {
  const partes = [];
  if (linha.retornoMl) partes.push(`retorno ML de R$ ${linha.retornoMl.toFixed(2).replace(".", ",")}`);
  if (linha.unidades) partes.push(`${linha.unidades} un. vendidas no período`);
  if (linha.margemDepois !== null) partes.push(`margem pós-promoção ${(linha.margemDepois * 100).toFixed(1).replace(".", ",")}%`);
  return partes.join(" · ");
}

// Uma candidata a partir de (promoção, snapshot de margem) — mesma régua para
// as duas fontes. null = fora (sem margem calculável/positiva).
function montarCandidata({ itemId, promocao, precoPromo, retornoMl, snap, titulo, vendasPorMlb }) {
  const taxa = num(snap.commission_rate);
  const calc = computeMargin({
    price: precoPromo,
    cost: num(snap.cost),
    taxRate: num(snap.tax_rate),
    fixedFee: num(snap.fixed_fee),
    commission: taxa === null ? null : round2(precoPromo * taxa),
    freight: num(snap.freight),
    rebate: retornoMl,
  });
  if (!calc.computable || calc.margin === null || calc.margin <= 0 || taxa === null || num(snap.tax_rate) === null) return null;
  const vendas = vendasPorMlb.get(itemId) || null;
  const linha = {
    itemId,
    titulo: snap.titulo || titulo || itemId,
    imagem: snap.image_url || null,
    precoAtual: num(snap.price),
    margemAtual: num(snap.margin),
    promocao,
    precoPromocao: precoPromo,
    retornoMl: retornoMl || null,
    margemDepois: calc.margin,
    lucroDepois: calc.profit,
    unidades: vendas ? num(vendas.unidades) || 0 : 0,
    receita: vendas ? num(vendas.receita) : null,
    estimado: true,
  };
  linha.motivo = motivoDa(linha);
  return linha;
}

// Ordena, deixa 1 linha por anúncio (a melhor dele pela mesma régua) e pagina
// no servidor.
function ordenarDeduplicarPaginar(candidatas, { page, limit }) {
  candidatas.sort((a, b) =>
    (b.retornoMl ? 1 : 0) - (a.retornoMl ? 1 : 0) ||
    b.unidades - a.unidades ||
    b.margemDepois - a.margemDepois ||
    (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0)
  );
  const vistos = new Set();
  const unicas = [];
  for (const c of candidatas) {
    if (vistos.has(c.itemId)) continue;
    vistos.add(c.itemId);
    unicas.push(c);
  }
  const inicio = (page - 1) * limit;
  return { total: unicas.length, pagina: unicas.slice(inicio, inicio + limit), hasNext: inicio + limit < unicas.length };
}

async function carregarVendas(d, cliente, conta, params, deps) {
  try {
    const realizada = await d.carregarRealizada(
      { cliente: { id: cliente.id, slug: cliente.slug }, conta: { id: conta.id }, periodo: params.periodo || null },
      { ...deps, db: d.db }
    );
    return { vendasPorMlb: realizada.porMlb || new Map(), periodo: realizada.periodo || null };
  } catch (_) {
    return { vendasPorMlb: new Map(), periodo: null };
  }
}

function periodoPublico(periodo) {
  return periodo ? { dateFrom: periodo.dateFrom, dateTo: periodo.dateTo, rotulo: periodo.rotulo || null } : null;
}

const CRITERIO = "Promoção disponível com margem pós-promoção positiva; ordem: com retorno ML, mais unidades vendidas, maior margem.";

// ─── Fonte principal: Promo Snapshot ─────────────────────────────────────────
async function oportunidadesDoSnapshot({ d, cliente, conta, estado, sync, params, deps, pag }) {
  const rows = await d.promo.listarBase({ clienteContaId: conta.id, runId: estado.snapshotRunId });
  const { vendasPorMlb, periodo } = await carregarVendas(d, cliente, conta, params, deps);
  const candidatas = [];
  for (const r of rows) {
    const status = String(r.status || "").toLowerCase() || null;
    if (status && !STATUS_DISPONIVEIS.has(status)) continue;
    const precoPromo = num(r.preco_final);
    if (precoPromo === null || precoPromo <= 0) continue;
    const c = montarCandidata({
      itemId: String(r.item_id),
      promocao: {
        id: r.promotion_id || null,
        nome: r.nome || null,
        tipo: r.promotion_type || null,
        status,
        statusExibicao: r.status_exibicao || null,
        precoFonte: r.preco_final_fonte || null,
        fim: r.data_fim || null,
      },
      precoPromo,
      retornoMl: num(r.subsidio_ml) || 0,
      snap: r,
      titulo: null,
      vendasPorMlb,
    });
    if (c) candidatas.push(c);
  }
  const { total, pagina, hasNext } = ordenarDeduplicarPaginar(candidatas, pag);
  return {
    ok: true,
    disponivel: true,
    fonte: {
      tipo: "promo_snapshot",
      runId: estado.snapshotRunId,
      geradoEm: estado.snapshotAt,
      parcial: estado.partial === true,
      itensVarridos: num(estado.total),
      itensSemLeitura: estado.itemsWithoutRead || 0,
      ...frescor(estado.snapshotAt, d.now().getTime()),
    },
    sync,
    criterio: CRITERIO,
    periodo: periodoPublico(periodo),
    page: pag.page,
    limit: pag.limit,
    total,
    hasNext,
    oportunidades: pagina,
  };
}

// ─── Compatibilidade: diagnóstico da tela antiga ─────────────────────────────
async function oportunidadesDoLegado({ d, cliente, conta, sellerId, sync, params, deps, pag }) {
  const head = await consultaOuVazio(
    d.db,
    `SELECT id, created_at, parcial, itens_scaneados
       FROM promocoes_diagnosticos
      WHERE cliente_id = $1 AND seller_id = $2 AND status = 'concluido'
      ORDER BY created_at DESC, id DESC
      LIMIT 1`,
    [cliente.id, sellerId]
  );
  if (!head || !head.length) return null;
  const diag = head[0];

  const itens = await d.db.query(
    `SELECT item_id, titulo, campanha, campanha_id, tipo_promocao, preco_original, preco_promocao,
            desconto_total, seller_percentage, meli_percentage, retorno_ml, payload_raw
       FROM promocoes_diagnostico_itens
      WHERE diagnostico_id = $1 AND preco_promocao IS NOT NULL AND preco_promocao > 0`,
    [diag.id]
  );
  const linhasDiag = itens.rows || [];
  const ids = [...new Set(linhasDiag.map((r) => String(r.item_id || "")).filter(Boolean))];
  const base = {
    ok: true,
    disponivel: true,
    fonte: {
      tipo: "diagnostico_legado",
      diagnosticoId: Number(diag.id),
      geradoEm: diag.created_at,
      parcial: diag.parcial === true,
      itensVarridos: num(diag.itens_scaneados),
      ...frescor(diag.created_at, d.now().getTime()),
    },
    sync,
    criterio: CRITERIO,
    page: pag.page,
    limit: pag.limit,
  };
  if (!ids.length) return { ...base, periodo: null, total: 0, hasNext: false, oportunidades: [] };

  const snaps = await d.db.query(
    `SELECT item_id, titulo, image_url, price, cost, tax_rate, fixed_fee, commission_rate, freight, margin, status, quality_json
       FROM margin_projection_snapshots
      WHERE cliente_conta_id = $1 AND marketplace = 'meli' AND item_id = ANY($2::text[]) AND catalog_missing_since IS NULL`,
    [conta.id, ids]
  );
  const porItem = new Map((snaps.rows || []).map((r) => [String(r.item_id), r]));
  const { vendasPorMlb, periodo } = await carregarVendas(d, cliente, conta, params, deps);

  const candidatas = [];
  for (const r of linhasDiag) {
    const itemId = String(r.item_id || "");
    const snap = porItem.get(itemId);
    if (!snap) continue;
    const raw = r.payload_raw && typeof r.payload_raw === "object" ? r.payload_raw : {};
    const status = String(raw.status || raw.statusPromocao || "").toLowerCase() || null;
    if (status && !STATUS_DISPONIVEIS.has(status)) continue;
    const c = montarCandidata({
      itemId,
      promocao: { id: r.campanha_id || null, nome: r.campanha || null, tipo: r.tipo_promocao || null, status },
      precoPromo: num(r.preco_promocao),
      retornoMl: num(r.retorno_ml) || 0,
      snap,
      titulo: r.titulo,
      vendasPorMlb,
    });
    if (c) candidatas.push(c);
  }
  const { total, pagina, hasNext } = ordenarDeduplicarPaginar(candidatas, pag);
  return { ...base, periodo: periodoPublico(periodo), total, hasNext, oportunidades: pagina };
}

function mensagemSemFonte(estado) {
  if (!estado) return "Nenhuma promoção sincronizada para esta conta ainda.";
  if (estado.state === "syncing") {
    const prog = estado.total ? ` (${estado.processed || 0} de ${estado.total} anúncios)` : "";
    return `Primeira leitura das promoções desta conta em andamento${prog}. A lista aparece sozinha quando terminar.`;
  }
  if (estado.state === "failed") {
    return `A última leitura das promoções desta conta falhou${estado.errorCode ? ` (${estado.errorCode})` : ""}. O backend tenta de novo automaticamente.`;
  }
  if (!estado.workerEnabled) {
    return "A sincronização automática de promoções ainda não está ligada neste ambiente; nenhuma promoção foi lida para esta conta.";
  }
  return "Primeira leitura das promoções desta conta enfileirada. A lista aparece sozinha quando terminar.";
}

async function listarOportunidades(params = {}, deps = {}) {
  const d = defaults(deps);
  const { cliente, conta } = await d.resolverContaDoCliente(
    { clienteSlug: params.clienteSlug, clienteContaId: params.clienteContaId },
    deps
  );
  const contaCompleta = await d.obterConta(conta.id, d.db);
  const sellerId = contaCompleta && contaCompleta.external_account_id ? String(contaCompleta.external_account_id) : null;
  const pag = {
    page: Math.max(1, Math.trunc(Number(params.page)) || 1),
    limit: Math.min(Math.max(Math.trunc(Number(params.limit)) || LIMITE_PADRAO, 1), LIMITE_MAX),
  };

  if (!sellerId) {
    return { ok: true, disponivel: false, motivo: "CONTA_SEM_GRANT_ML", mensagem: "A conta não tem conexão do Mercado Livre vinculada.", page: pag.page, limit: pag.limit, total: 0, hasNext: false, oportunidades: [] };
  }

  // Estado do Promo Snapshot + auto-trigger (nunca bloqueia; falha aqui não
  // derruba a lista — cai no legado/indisponível).
  let estado = null;
  let sync = null;
  try {
    const r = await d.promo.estadoComAutoTrigger(
      { clienteId: cliente.id, clienteSlug: cliente.slug, clienteContaId: conta.id, marketplace: "meli", sellerId },
      { autoTrigger: params.autoTrigger !== false }
    );
    estado = r.estado;
    sync = d.promo.syncPublico(r.estado, r.gatilho);
  } catch (err) {
    if (!(err && err.code === "42P01")) throw err;
  }

  const ctx = { d, cliente, conta, sellerId, estado, sync, params, deps, pag };
  if (estado && estado.hasSnapshot) return oportunidadesDoSnapshot(ctx);

  const legado = await oportunidadesDoLegado(ctx);
  if (legado) return legado;

  return {
    ok: true,
    disponivel: false,
    motivo: "SEM_SNAPSHOT_PROMOCOES",
    mensagem: mensagemSemFonte(estado),
    sync,
    page: pag.page,
    limit: pag.limit,
    total: 0,
    hasNext: false,
    oportunidades: [],
  };
}

module.exports = { listarOportunidades, montarCandidata, ordenarDeduplicarPaginar };
