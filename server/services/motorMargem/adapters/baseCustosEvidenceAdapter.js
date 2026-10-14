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

// Convenção de `custos`: imposto trafega como DECIMAL (0.12 = 12%). Valor fora
// de [0, 1] NÃO é convertido (nem "12 → 0.12") nem descartado em silêncio: vira
// insumo INVÁLIDO com motivo `aliquota_fora_da_faixa` e o item cai em
// UNVALIDATED (ver createEvidenceBag().invalid e classifyStatus). A escala
// errada se corrige na Base, não aqui.
const MOTIVO_ALIQUOTA_FORA_DA_FAIXA = "aliquota_fora_da_faixa";

/** Alíquota válida ([0, 1]) ou null. Não converte escala. */
function normalizarAliquota(value) {
  const n = numOrNull(value);
  return n !== null && n >= 0 && n <= 1 ? n : null;
}

/** true quando HÁ valor mas ele está fora de [0, 1]. */
function aliquotaInvalida(value) {
  const n = numOrNull(value);
  return n !== null && (n < 0 || n > 1);
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
      // Valor bruto da Base quando fora de [0, 1] (senão null).
      taxRateInvalido: aliquotaInvalida(row.imposto_percentual) ? numOrNull(row.imposto_percentual) : null,
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
  if (entry.taxRateInvalido !== null && entry.taxRateInvalido !== undefined && typeof bag.invalid === "function") {
    bag.invalid(FIELDS.TAX_RATE, {
      code: MOTIVO_ALIQUOTA_FORA_DA_FAIXA,
      source: SOURCES.VENFORCE_BASE,
      raw: entry.taxRateInvalido,
      observedAt: entry.observedAt,
      reason: `Alíquota de imposto da Base fora da faixa [0 a 1] (valor ${entry.taxRateInvalido}, ${MOTIVO_ALIQUOTA_FORA_DA_FAIXA}): corrija a Base antes de calcular a margem.`,
    });
  }

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
  aliquotaInvalida,
  MOTIVO_ALIQUOTA_FORA_DA_FAIXA,
  marketplaceSuportado,
};
