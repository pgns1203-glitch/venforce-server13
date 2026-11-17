// server/services/sentinel/sentinelRecalculoBase.js
//
// Recálculo de pedidos do Sentinel quando a BASE DE CUSTOS/IMPOSTOS muda — sem depender de o ML atualizar o pedido.
//
// Por que não `custos.updated_at > calculado_em`: toda edição manual e todo reimport gravam updated_at = CURRENT_TIMESTAMP
// incondicionalmente, mesmo com valores iguais (baseCustosService.js:303,322; baseImportService.js:39,52), e DELETE
// (meliCustosLoteService.js:117) não deixa rastro algum. A detecção aqui é por CONTEÚDO: cada linha do Sentinel já guarda,
// por item, o custo e o imposto que usou (itens[].custo_unitario, imposto_percentual, estado_custo). Resolve-se de novo na
// base ATUAL (o mesmo resolverCustoItem do cálculo) e compara-se. Divergiu ⇒ a linha está defasada; igual ⇒ nada a fazer.
// Propriedades: idempotente (recalculada, deixa de divergir), retomável após falha/reinício (estado = a própria divergência),
// sem reação a reimport idêntico, e cobre remoção de custo.
//
// O recálculo reaproveita o fluxo existente do worker (GET /orders/{id} + processarPedido) dentro do orçamento, do lock e do
// protocolo de exceções. Este módulo só decide O QUE reprocessar e registra o marcador `recalculo_base`.
//
// VIGÊNCIA (regra de negócio explícita): a base não tem data de vigência. Decisão financeira de 17/11/2026: uma mudança de imposto
// vale só para vendas A PARTIR da vigência. Padrão DESLIGADO e, mesmo ligado, SENTINEL_RECALC_DESDE é OBRIGATÓRIO: sem ela nada roda.
// Só pedidos com data_pedido >= DESDE (e dentro de SENTINEL_RECALC_JANELA_DIAS, padrão 30 = janela de detecção de incidentes).
//
// A margem recalculada é a do mesmo motor com a base ATUAL — NÃO é resultado realizado nem conciliado.

const fs = require("fs");
const path = require("path");
const { resolverCustoItem, carregarIndiceCusto } = require("./sentinelCusto");

const DIA_MS = 86400000;
const MIGRATION = "20261118_sentinel_recalculo_base.sql";
const LOCK_KEY = "vf:schema:sentinel_recalculo_base";

function inteiroPositivo(v, padrao) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : padrao;
}

function configRecalculo(env = process.env) {
  const desdeMs = Date.parse(env?.SENTINEL_RECALC_DESDE);
  return {
    habilitado: /^(true|1|on|yes)$/i.test(String(env?.SENTINEL_RECALC_BASE_ENABLED ?? "").trim()),
    janelaDias: inteiroPositivo(env?.SENTINEL_RECALC_JANELA_DIAS, 30),
    maxPorCiclo: inteiroPositivo(env?.SENTINEL_RECALC_MAX_POR_CICLO, 25),
    varreduraMax: inteiroPositivo(env?.SENTINEL_RECALC_VARREDURA_MAX, 5000),
    desde: Number.isFinite(desdeMs) ? new Date(desdeMs).toISOString() : null,
  };
}

const recalculoAtivo = (env = process.env) => configRecalculo(env).habilitado;

// Pedidos com data_pedido ANTERIOR a este instante não são reescritos.
function corteRetroativo(cfg, agoraMs = Date.now()) {
  const janela = agoraMs - (cfg.janelaDias ?? 30) * DIA_MS;
  const desde = cfg.desde ? Date.parse(cfg.desde) : null;
  return new Date(desde !== null && Number.isFinite(desde) ? Math.max(janela, desde) : janela).toISOString();
}

// ───────────────────────── divergência por conteúdo ─────────────────────────
const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const igual = (a, b) => (a === null || b === null ? a === b : Math.abs(a - b) < 1e-9);

function divergenciaDeItens(itens, indiceCusto) {
  const out = { divergente: false, itens: [] };
  if (!Array.isArray(itens)) return out;
  itens.forEach((it, idx) => {
    if (!it || typeof it !== "object") return;
    const r = resolverCustoItem(indiceCusto, { item: { id: it.item_id, variation_id: it.variation_id, seller_sku: it.sku } });
    const de = { custo: num(it.custo_unitario), imposto: num(it.imposto_percentual), estado: it.estado_custo ?? null };
    const para = { custo: r.estado === "ok" ? num(r.cost) : null, imposto: r.estado === "ok" ? num(r.taxPercent) : null, estado: r.estado };
    const campos = [];
    if (de.estado !== para.estado) campos.push("estado");
    if (!igual(de.custo, para.custo)) campos.push("custo");
    if (!igual(de.imposto, para.imposto)) campos.push("imposto");
    // `origem_custo` mudar sem mudar valores não é financeiramente relevante.
    if (campos.length) out.itens.push({ idx, item_id: it.item_id ?? null, campos, de, para });
  });
  out.divergente = out.itens.length > 0;
  return out;
}

// ───────────────────────── assinatura da base (gate barato) ─────────────────────────
// Mesma projeção do carregarIndiceCusto (sku_id = ''), só com campos que afetam o cálculo. NÃO usa updated_at.
const ASSINATURA_SQL = `
SELECT COUNT(*)::int AS n,
       COALESCE(md5(string_agg(concat_ws('|', produto_id, COALESCE(id_model, ''), COALESCE(sku, ''), custo_produto::text, imposto_percentual::text),
                               ';' ORDER BY produto_id, COALESCE(sku, ''), COALESCE(id_model, ''), id)), '') AS h
  FROM custos
 WHERE base_id = $1 AND sku_id = ''`;

async function assinaturaBase(db, baseId) {
  if (!baseId) return null;
  const r = await db.query(ASSINATURA_SQL, [baseId]);
  const row = r.rows[0] || {};
  return { n: Number(row.n) || 0, hash: row.h || "" };
}

// Estado EM MEMÓRIA por conta: perdê-lo (reinício) só custa UMA varredura extra — a divergência é o estado real.
function novoEstadoRecalculo() {
  const mapa = new Map();
  return { mapa, registrar(conta, ass, { pendente = false } = {}) { mapa.set(Number(conta), { n: ass.n, hash: ass.hash, pendente: !!pendente }); }, obter: (conta) => mapa.get(Number(conta)) || null };
}

function deveVarrer(estado, contaId, assinatura) {
  if (!assinatura) return false;
  const e = estado.mapa.get(Number(contaId));
  if (!e || e.pendente) return true;
  return e.hash !== assinatura.hash || e.n !== assinatura.n;
}

// ───────────────────────── seleção ─────────────────────────
const SELECIONAR_SQL = `
SELECT pedido_id, itens, estado_margem, data_pedido, custo::float AS custo, imposto::float AS imposto, margem_valor::float AS margem_valor
  FROM sentinel_pedidos
 WHERE cliente_conta_id = $1
   AND estado_margem IN ('confirmada', 'sem_custo', 'custo_ambiguo')
   AND status_ml IN ('paid', 'partially_refunded')
   AND data_pedido >= $2
 ORDER BY data_pedido DESC
 LIMIT $3`;

async function selecionarDefasadas(db, contaId, indiceCusto, cfg, agoraMs = Date.now()) {
  const corte = corteRetroativo(cfg, agoraMs);
  const rows = (await db.query(SELECIONAR_SQL, [contaId, corte, cfg.varreduraMax ?? 5000])).rows;
  const defasadas = new Map();
  for (const r of rows) {
    let itens = r.itens;
    if (typeof itens === "string") { try { itens = JSON.parse(itens); } catch (_) { itens = null; } }
    const d = divergenciaDeItens(itens, indiceCusto);
    if (!d.divergente) continue;
    defasadas.set(String(r.pedido_id), { itens: d.itens, de: { custo: r.custo, imposto: r.imposto, margem: r.margem_valor, estado: r.estado_margem }, data_pedido: r.data_pedido });
  }
  const todas = [...defasadas.keys()];
  const ids = todas.slice(0, cfg.maxPorCiclo ?? 25);
  return { ids, defasadas, varridos: rows.length, divergentes: todas.length, pendente: todas.length > ids.length, corte };
}

// ───────────────────────── marcador persistido ─────────────────────────
// recalculo_base JSONB: quando e com que base a margem foi recalculada, e o que havia antes. Não entra no payload_hash.
function montarMarcador({ defasada, assinatura, agoraIso }) {
  return {
    em: agoraIso,
    motivo: "base_de_custos_alterada",
    base: assinatura ? { n: assinatura.n, hash: String(assinatura.hash).slice(0, 12) } : null,
    antes: defasada ? { custo: defasada.de.custo, imposto: defasada.de.imposto, margem: defasada.de.margem, estado: defasada.de.estado } : null,
    natureza: "recalculado_com_base_atual", // NÃO é resultado realizado nem conciliado
  };
}

const MARCAR_SQL = `UPDATE sentinel_pedidos SET recalculo_base = $3::jsonb WHERE cliente_conta_id = $1 AND pedido_id = $2`;
async function gravarMarcador(dbEscrita, contaId, pedidoId, marcador) {
  const r = await dbEscrita.query(MARCAR_SQL, [contaId, String(pedidoId), JSON.stringify(marcador)]);
  return r.rowCount > 0;
}

// ───────────────────────── orquestração (usada pelo worker) ─────────────────────────
// Estado padrão do PROCESSO (injetável em teste). Perdê-lo (reinício) custa uma varredura, nunca correção.
const estadoPadrao = novoEstadoRecalculo();
let avisouSemSchema = false;
let avisouSemVigencia = false;

/**
 * Decide o que recalcular nesta conta neste ciclo. Devolve null quando não há nada a decidir (desligado, sem base, schema do
 * marcador ausente, ou base idêntica à última varredura sem trabalho pendente). Caso contrário devolve o plano; o chamador
 * reprocessa `plano.ids` pelo fluxo existente e chama `plano.concluir(...)`.
 */
async function planejarRecalculo({ db, ctx, cfg, estado = estadoPadrao, cacheCusto = null, nowMs = Date.now() }) {
  if (!cfg || !cfg.habilitado || !ctx || !ctx.baseId) return null;
  // VIGÊNCIA OBRIGATÓRIA: a base não tem data de vigência e uma mudança (ex.: imposto 13% → 10%) vale só para vendas a partir dela.
  // Sem uma data explícita, "corrigir" reescreveria vendas anteriores com a alíquota nova — por isso NÃO roda, mesmo ligado.
  // A cada nova mudança de base a data deve ser AVANÇADA para o início da nova vigência (senão vendas entre as mudanças seriam
  // recalculadas com a alíquota mais nova).
  if (!cfg.desde) {
    if (!avisouSemVigencia) { avisouSemVigencia = true; console.warn("[sentinel] recálculo por base de custos LIGADO, mas SENTINEL_RECALC_DESDE (início da vigência da mudança) não está definido: recálculo suspenso para não reescrever vendas anteriores à vigência."); }
    return null;
  }
  if (!(await recalculoSchemaPronto(db))) {
    if (!avisouSemSchema) { avisouSemSchema = true; console.warn("[sentinel] recálculo por base de custos LIGADO, mas a coluna recalculo_base não existe (migration 20261118 não aplicada): recálculo suspenso; a coleta segue normalmente."); }
    return null;
  }
  const assinatura = await assinaturaBase(db, ctx.baseId);
  if (!deveVarrer(estado, ctx.clienteContaId, assinatura)) return null;
  const indice = await carregarIndiceCusto(ctx.baseId, db, cacheCusto);
  const sel = await selecionarDefasadas(db, ctx.clienteContaId, indice, cfg, nowMs);
  return {
    ...sel,
    assinatura,
    // interrompido: o ciclo parou (orçamento/prazo/token) antes de terminar; falhas: pedidos que deram erro.
    concluir({ interrompido = false, falhas = 0 } = {}) {
      estado.registrar(ctx.clienteContaId, assinatura, { pendente: sel.pendente || interrompido || falhas > 0 });
    },
  };
}

// Marca como recalculados os pedidos cujo custo/imposto/estado MUDOU em relação ao que a seleção viu (inclui irmãos de pack
// regravados em grupo pelo processarPedido). Idempotente: sem mudança, não escreve.
async function marcarRecalculadas({ db, dbEscrita, contaId, plano, agoraIso, verificarLock = null }) {
  const ids = [...plano.defasadas.keys()];
  if (!ids.length) return 0;
  const rows = (await db.query(
    "SELECT pedido_id, custo::float AS custo, imposto::float AS imposto, estado_margem FROM sentinel_pedidos WHERE cliente_conta_id = $1 AND pedido_id = ANY($2::text[])",
    [contaId, ids])).rows;
  let marcados = 0;
  for (const r of rows) {
    const d = plano.defasadas.get(String(r.pedido_id));
    if (!d) continue;
    const mudou = !igual(num(r.custo), num(d.de.custo)) || !igual(num(r.imposto), num(d.de.imposto)) || r.estado_margem !== d.de.estado;
    if (!mudou) continue;
    if (verificarLock) await verificarLock();
    if (await gravarMarcador(dbEscrita, contaId, r.pedido_id, montarMarcador({ defasada: d, assinatura: plano.assinatura, agoraIso }))) marcados += 1;
  }
  return marcados;
}

// ───────────────────────── schema (migration só em arquivo; verificação somente leitura) ─────────────────────────
// SEM cache: é uma consulta mínima por conta e por ciclo (e por condição encerrada). Cachear "presente" deixaria o worker trabalhar
// (GETs ao ML) e só depois falhar na marcação se a coluna fosse removida com o processo no ar; cachear "ausente" atrasaria a retomada.
async function recalculoSchemaPronto(db) {
  if (!db || typeof db.query !== "function") return false;
  try {
    const r = await db.query(
      "SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sentinel_pedidos' AND column_name = 'recalculo_base'");
    return r.rows.length > 0;
  } catch (err) {
    console.warn(`[sentinel] verificação do schema de recálculo falhou (${String(err?.message || err).slice(0, 120)}); recálculo suspenso neste ciclo.`);
    return false;
  }
}

async function ensureRecalculoSchema(db) {
  const { aplicarMigrationSerializada, migrationsDir } = require("../schema/schemaEnsure");
  await aplicarMigrationSerializada(db, fs.readFileSync(path.join(migrationsDir, MIGRATION), "utf8"), LOCK_KEY);
}

module.exports = {
  configRecalculo, recalculoAtivo, corteRetroativo, divergenciaDeItens, assinaturaBase, novoEstadoRecalculo, deveVarrer,
  selecionarDefasadas, planejarRecalculo, marcarRecalculadas, estadoPadrao, montarMarcador, gravarMarcador, recalculoSchemaPronto, ensureRecalculoSchema,
  ASSINATURA_SQL, SELECIONAR_SQL, MARCAR_SQL, MIGRATION,
};
