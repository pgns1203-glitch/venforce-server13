// server/services/motorMargem/adapters/baseCustosEvidenceAdapter.js
// Fonte VENFORCE_BASE — custo, imposto e taxa fixa vindos da tabela `custos`.
//
// ⚠️ LIMITE ABSOLUTO DESTA RODADA: **somente leitura**. Este adapter faz um
// único SELECT. Nenhum INSERT/UPDATE/DELETE, nenhuma alteração de schema,
// índice, vínculo ou normalização de ID. `/importar-base` não é tocado.
// Ver MOTOR_MARGEM_FONTES_E_GAPS §BLOQUEADO_POR_BASES.
//
// Identidade de custo por marketplace (documentada em
// BASES_ARQUITETURA_E_DEPENDENCIAS §7) — esta rodada cobre **MELI**:
//   MELI   → chave `produto_id` (MLB…)                    ✔ suportado
//   Shopee → `produto_id` + `id_model` (variação)          ✖ BLOQUEADO_POR_BASES
//   TikTok → `sku_id` é a chave autoritativa               ✖ fora de escopo
// A restrição é a mesma que a Central de Vendas já aplica hoje.

const pool = require("../../../config/database");
const { normalizeId } = require("../../../utils/textUtils");
const { SOURCES, EVIDENCE_KINDS, EVIDENCE_QUALITY } = require("../core/marginSources");
const { FIELDS } = require("../core/marginEvidence");

const MARKETPLACES_SUPORTADOS = ["meli"];

function numOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// Convenção herdada de `custos`: imposto trafega como DECIMAL (0.12 = 12%),
// mas linhas antigas podem ter sido gravadas em escala 0–100. A mesma defesa
// existe em precificacaoService e centralVendasSyncService; replicada aqui para
// não depender da ordem de importação da base.
function normalizarAliquota(value) {
  const n = numOrNull(value);
  if (n === null || n < 0) return null;
  return n > 1 ? n / 100 : n;
}

/**
 * Índice de custos da base, com as 3 variantes de chave MLB já usadas pelo
 * restante do backend (id completo, sem prefixo, com prefixo).
 */
function buildCostIndex(rows) {
  const index = new Map();

  for (const row of rows || []) {
    const id = normalizeId(row.produto_id);
    if (!id) continue;

    const entry = {
      produtoId: id,
      cost: numOrNull(row.custo_produto),
      taxRate: normalizarAliquota(row.imposto_percentual),
      fixedFee: numOrNull(row.taxa_fixa),
      produtoNome: row.produto_nome || null,
      observedAt: row.updated_at || null,
    };

    const noPrefix = id.replace(/^MLB/i, "");
    if (!index.has(id)) index.set(id, entry);
    if (noPrefix && !index.has(noPrefix)) index.set(noPrefix, entry);
    if (noPrefix && !index.has(`MLB${noPrefix}`)) index.set(`MLB${noPrefix}`, entry);
  }

  return index;
}

function lookupCost(index, itemId) {
  const id = normalizeId(itemId);
  if (!id) return null;
  const noPrefix = id.replace(/^MLB/i, "");
  return index.get(id) || index.get(noPrefix) || index.get(`MLB${noPrefix}`) || null;
}

/**
 * Lê os custos de uma base. SELECT puro — nenhuma escrita.
 * @returns {Promise<{index: Map, total: number}>}
 */
async function carregarCustosDaBase({ baseId }, db = pool) {
  if (!baseId) return { index: new Map(), total: 0 };

  const result = await db.query(
    `SELECT produto_id, custo_produto, imposto_percentual, taxa_fixa, produto_nome, updated_at
       FROM custos
      WHERE base_id = $1`,
    [baseId]
  );

  return { index: buildCostIndex(result.rows), total: result.rows.length };
}

/**
 * Registra custo/imposto/taxa fixa de UM item no bag de evidências.
 * Item sem linha na base não gera evidência: a ausência é detectada depois
 * pelo motor (`UNVALIDATED`), nunca preenchida com zero.
 *
 * @returns {boolean} true quando havia custo na base
 */
function aplicarEvidenciasDeCusto(bag, { itemId, index, baseSlug }) {
  const entry = lookupCost(index, itemId);
  if (!entry) return false;

  const comum = {
    source: SOURCES.VENFORCE_BASE,
    kind: EVIDENCE_KINDS.PROJECTED,
    // A Base é uma DECLARAÇÃO (planilha importada), não uma medição.
    quality: EVIDENCE_QUALITY.DECLARED,
    observedAt: entry.observedAt,
    note: baseSlug ? `base ${baseSlug} · produto_id ${entry.produtoId}` : null,
  };

  bag.add(FIELDS.COST, { ...comum, value: entry.cost });
  bag.add(FIELDS.TAX_RATE, { ...comum, value: entry.taxRate });
  bag.add(FIELDS.FIXED_FEE, { ...comum, value: entry.fixedFee });

  return true;
}

function marketplaceSuportado(marketplace) {
  return MARKETPLACES_SUPORTADOS.includes(String(marketplace || "").trim().toLowerCase());
}

module.exports = {
  MARKETPLACES_SUPORTADOS,
  carregarCustosDaBase,
  buildCostIndex,
  lookupCost,
  aplicarEvidenciasDeCusto,
  normalizarAliquota,
  marketplaceSuportado,
};
