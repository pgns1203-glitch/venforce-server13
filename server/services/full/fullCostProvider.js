"use strict";

// server/services/full/fullCostProvider.js
//
// Custo do produto para a Central do Full: a MESMA Base de Custos da conta
// que alimenta Anuncios ML e o Motor de Margem (resolvida no servidor por
// cliente + conta, nunca a de outra conta). Uma leitura em lote por coleta,
// nunca uma por inventory.
//
// Contrato de falha: `fetchCosts` NUNCA rejeita. Sem Base (ou qualquer erro)
// vira `status="unavailable"` com motivo — o snapshot operacional segue
// inteiro, so sem os valores em R$ (que aparecem como "—", nunca zero).

function unavailable(reason, message = null) {
  return { status: "unavailable", reason, message, base: null, costsByItemId: new Map() };
}

/**
 * `lerCustos({ clienteSlug, clienteContaId, itemIds })`
 *   -> Promise<{ base: {slug,nome}|null, motivo, mensagem, custos: { [MLB]: number|null } }>
 *   (forma de meliCustosLoteService.lerCustosDaConta)
 */
function createFullCostProvider({ lerCustos } = {}) {
  async function fetchCosts({ clienteSlug, clienteContaId, itemIds }) {
    if (typeof lerCustos !== "function") return unavailable("cost_source_absent");
    if (!clienteSlug) return unavailable("cliente_slug_ausente");
    if (!Array.isArray(itemIds) || itemIds.length === 0) {
      return { status: "ok", reason: null, message: null, base: null, costsByItemId: new Map() };
    }

    try {
      const result = await lerCustos({ clienteSlug, clienteContaId, itemIds });
      if (!result || !result.base) {
        return unavailable((result && result.motivo) || "base_nao_vinculada", (result && result.mensagem) || null);
      }
      const costsByItemId = new Map();
      for (const [itemId, custo] of Object.entries(result.custos || {})) {
        if (typeof custo === "number" && Number.isFinite(custo)) costsByItemId.set(itemId, custo);
      }
      return { status: "ok", reason: null, message: null, base: { slug: result.base.slug, nome: result.base.nome }, costsByItemId };
    } catch (err) {
      return unavailable("cost_source_error");
    }
  }

  return { fetchCosts };
}

module.exports = { createFullCostProvider };
