// server/services/motorMargem/precificacao/precificacaoOportunidadesService.js
// "Oportunidades de preço e promoção" da Central de Margem — SEM N+1.
//
// Nenhuma chamada ao Mercado Livre. Três fontes persistidas, uma consulta
// cada, para a conta inteira:
//   1. último diagnóstico de promoções CONCLUÍDO da conta
//      (promocoes_diagnosticos.seller_id = conta ML — job assíncrono da tela
//      Promoções ML; é a única fonte bulk confiável de promoções por item);
//   2. Margin Snapshot da conta (custo, imposto, taxa fixa, taxa de comissão
//      e frete projetados);
//   3. realizado da Central de Vendas no período (unidades/receita por MLB).
//
// A margem gravada no diagnóstico (fórmula "de planilha" da tela de
// Promoções) NÃO é usada: a margem pós-promoção é recalculada com
// core/marginEngine.computeMargin e os insumos do snapshot. Comissão vem da
// TAXA (listing_prices não é recotado aqui) e o frete é o atual — por isso
// toda linha sai marcada `estimado:true`; o drawer recota exato.
//
// Ordenação simples e explicável (sem elasticidade/forecast):
//   com retorno ML  >  mais unidades vendidas  >  maior margem pós-promoção.

const pool = require("../../../config/database");
const { computeMargin } = require("../core/marginEngine");

const STATUS_DISPONIVEIS = new Set(["candidate", "started", "active", "pending"]);
const FRESCO_MIN = 360; // 6h — mesmos limiares de promocoesDiagnosticoService
const ANTIGO_MIN = 1440; // 24h
const LIMITE_PADRAO = 20;

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

async function listarOportunidades(params = {}, deps = {}) {
  const d = defaults(deps);
  const { cliente, conta } = await d.resolverContaDoCliente(
    { clienteSlug: params.clienteSlug, clienteContaId: params.clienteContaId },
    deps
  );
  const contaCompleta = await d.obterConta(conta.id, d.db);
  const sellerId = contaCompleta && contaCompleta.external_account_id ? String(contaCompleta.external_account_id) : null;
  const limite = Math.min(Math.max(Number(params.limit) || LIMITE_PADRAO, 1), 50);

  if (!sellerId) {
    return { ok: true, disponivel: false, motivo: "CONTA_SEM_GRANT_ML", mensagem: "A conta não tem conexão do Mercado Livre vinculada.", oportunidades: [] };
  }

  const head = await consultaOuVazio(
    d.db,
    `SELECT id, created_at, parcial, itens_scaneados
       FROM promocoes_diagnosticos
      WHERE cliente_id = $1 AND seller_id = $2 AND status = 'concluido'
      ORDER BY created_at DESC, id DESC
      LIMIT 1`,
    [cliente.id, sellerId]
  );
  if (!head || !head.length) {
    return {
      ok: true,
      disponivel: false,
      motivo: "SEM_DIAGNOSTICO_PROMOCOES",
      mensagem: "Nenhum diagnóstico de promoções concluído para esta conta. A lista global depende dessa varredura (tela Promoções ML); a Central não consulta promoções anúncio a anúncio.",
      oportunidades: [],
    };
  }
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
      diagnosticoId: Number(diag.id),
      geradoEm: diag.created_at,
      parcial: diag.parcial === true,
      itensVarridos: num(diag.itens_scaneados),
      ...frescor(diag.created_at, d.now().getTime()),
    },
    criterio: "Promoção disponível com margem pós-promoção positiva; ordem: com retorno ML, mais unidades vendidas, maior margem.",
  };
  if (!ids.length) return { ...base, oportunidades: [] };

  const snaps = await d.db.query(
    `SELECT item_id, titulo, image_url, price, cost, tax_rate, fixed_fee, commission_rate, freight, margin, status, quality_json
       FROM margin_projection_snapshots
      WHERE cliente_conta_id = $1 AND marketplace = 'meli' AND item_id = ANY($2::text[]) AND catalog_missing_since IS NULL`,
    [conta.id, ids]
  );
  const porItem = new Map((snaps.rows || []).map((r) => [String(r.item_id), r]));

  let vendasPorMlb = new Map();
  let periodo = null;
  try {
    const realizada = await d.carregarRealizada(
      { cliente: { id: cliente.id, slug: cliente.slug }, conta: { id: conta.id }, periodo: params.periodo || null },
      { ...deps, db: d.db }
    );
    vendasPorMlb = realizada.porMlb || new Map();
    periodo = realizada.periodo || null;
  } catch (_) {
    vendasPorMlb = new Map();
  }

  const candidatas = [];
  for (const r of linhasDiag) {
    const itemId = String(r.item_id || "");
    const snap = porItem.get(itemId);
    if (!snap) continue;
    const raw = r.payload_raw && typeof r.payload_raw === "object" ? r.payload_raw : {};
    const status = String(raw.status || raw.statusPromocao || "").toLowerCase() || null;
    if (status && !STATUS_DISPONIVEIS.has(status)) continue;

    const precoPromo = num(r.preco_promocao);
    const taxa = num(snap.commission_rate);
    const retornoMl = num(r.retorno_ml) || 0;
    const calc = computeMargin({
      price: precoPromo,
      cost: num(snap.cost),
      taxRate: num(snap.tax_rate),
      fixedFee: num(snap.fixed_fee),
      commission: taxa === null ? null : round2(precoPromo * taxa),
      freight: num(snap.freight),
      rebate: retornoMl,
    });
    if (!calc.computable || calc.margin === null || calc.margin <= 0 || taxa === null || num(snap.tax_rate) === null) continue;

    const vendas = vendasPorMlb.get(itemId) || null;
    const linha = {
      itemId,
      titulo: snap.titulo || r.titulo || itemId,
      imagem: snap.image_url || null,
      precoAtual: num(snap.price),
      margemAtual: num(snap.margin),
      promocao: {
        id: r.campanha_id || null,
        nome: r.campanha || null,
        tipo: r.tipo_promocao || null,
        status,
      },
      precoPromocao: precoPromo,
      retornoMl: retornoMl || null,
      margemDepois: calc.margin,
      lucroDepois: calc.profit,
      unidades: vendas ? num(vendas.unidades) || 0 : 0,
      receita: vendas ? num(vendas.receita) : null,
      estimado: true,
    };
    linha.motivo = motivoDa(linha);
    candidatas.push(linha);
  }

  candidatas.sort((a, b) =>
    (b.retornoMl ? 1 : 0) - (a.retornoMl ? 1 : 0) ||
    b.unidades - a.unidades ||
    b.margemDepois - a.margemDepois
  );

  // Uma linha por anúncio (a melhor promoção dele pela mesma régua).
  const vistos = new Set();
  const oportunidades = [];
  for (const c of candidatas) {
    if (vistos.has(c.itemId)) continue;
    vistos.add(c.itemId);
    oportunidades.push(c);
    if (oportunidades.length >= limite) break;
  }

  return {
    ...base,
    periodo: periodo ? { dateFrom: periodo.dateFrom, dateTo: periodo.dateTo, rotulo: periodo.rotulo || null } : null,
    total: candidatas.length,
    oportunidades,
  };
}

module.exports = { listarOportunidades };
