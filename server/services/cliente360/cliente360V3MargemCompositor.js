// server/services/cliente360/cliente360V3MargemCompositor.js
//
// FASE 3 (Projeto_cliente360) — cruzamento Produtos (Central de Vendas/Ponte,
// já account-scoped desde a Fase 0) × Motor de Margem (status/evidência,
// server/services/motorMargem/).
//
// ACHADO DESTA FASE, registrado no relatório: motorMargemService NUNCA recebe
// `clienteContaId` — resolve tudo por `clienteSlug` via contextoPrecificacaoService
// (modelo anterior à fundação de ClienteConta). Para um cliente com 2+ contas
// MELI ativas, integrar isso à Cliente 360 V3 sem qualificação repetiria
// exatamente o bug que a Fase 0 existiu para corrigir — só que num motor
// diferente, nunca auditado para isso.
//
// Gate desta unidade: só chama o Motor de Margem quando o cliente tem
// EXATAMENTE 1 conta MELI ativa (nesse caso a resolução por slug do Motor é,
// por construção, a mesma conta que está em contexto — nenhuma ambiguidade
// possível). Com 2+ contas MELI ativas, ou marketplace != meli, o bloco
// inteiro vira indisponível com o motivo real. NUNCA soma/mistura contas.
//
// Identidade: MLB é a MESMA chave nos dois lados (Central de Vendas usa MLB;
// Motor de Margem usa `identity.itemId`, que É o MLB para MELI) — junção
// exata por essa chave, nunca por título. MLB pedido e não encontrado no
// catálogo do Motor de Margem (anúncio pausado/removido, por exemplo) marca
// `identidade: "missing"`, nunca inventa status.

const motorMargemService = require("../motorMargem/motorMargemService");
const { listarContasDoCliente } = require("../clienteContas/clienteContaService");

async function avaliarAplicabilidade({ clienteId, marketplace }, deps = {}) {
  if (marketplace !== "meli") {
    return {
      aplicavel: false,
      motivo: `Motor de Margem só cobre o marketplace Mercado Livre (esta conta é ${marketplace}).`,
      codigo: "MARKETPLACE_NAO_SUPORTADO",
    };
  }

  const contas = await (deps.listarContasDoCliente || listarContasDoCliente)({
    clienteId,
    marketplace: "meli",
    incluirInativas: false,
  });

  if (contas.length !== 1) {
    return {
      aplicavel: false,
      motivo: contas.length === 0
        ? "Nenhuma conta Mercado Livre ativa encontrada para este cliente."
        : `Motor de Margem ainda não é multiconta-aware (este cliente tem ${contas.length} contas Mercado Livre ativas) — não integrado aqui para não misturar contas.`,
      codigo: contas.length === 0 ? "SEM_CONTA_MELI_ATIVA" : "MOTOR_MARGEM_MULTICONTA_NAO_SUPORTADO",
    };
  }

  return { aplicavel: true, motivo: null, codigo: null };
}

// Extrai a margem "que vale mostrar" do item do Motor de Margem: realizada
// quando computável, projetada como fallback — NUNCA confundidas em silêncio
// (master prompt Fase 3: "Distinguir margem realizada de margem projetada").
function margemExibivel(item) {
  if (item.margin.realized.computable) {
    return { tipo: "realizada", margemPercent: item.margin.realized.marginPercent };
  }
  return { tipo: "projetada", margemPercent: item.margin.projected.marginPercent };
}

/**
 * Cruza os MLBs informados (tipicamente os já visíveis em `resultado.dados.
 * produtos` da Fase 1/2) com o catálogo do Motor de Margem. Só chama a API
 * real do Mercado Livre quando `avaliarAplicabilidade` autoriza.
 */
async function comporMargemPorMlb({ clienteId, clienteSlug, marketplace, mlbs, dateFrom, dateTo }, deps = {}) {
  const aplicabilidade = await avaliarAplicabilidade({ clienteId, marketplace }, deps);
  if (!aplicabilidade.aplicavel) {
    return { aplicavel: false, motivo: aplicabilidade.motivo, codigo: aplicabilidade.codigo, porMlb: {} };
  }

  const mlbsUnicos = [...new Set((mlbs || []).filter(Boolean).map((m) => String(m).toUpperCase()))];
  if (mlbsUnicos.length === 0) {
    return { aplicavel: true, motivo: null, codigo: null, porMlb: {} };
  }

  // dateFrom/dateTo: MESMA competência que a 360 está mostrando — sem isso,
  // o Motor de Margem cairia no próprio default (últimos 30 dias corridos),
  // e a evidência de "vendas realizadas" descreveria um período DIFERENTE do
  // que o usuário está olhando na tela (mesmo risco de "universo incompatível"
  // que a Fase 0 tratou para Resultado/Ponte).
  const montado = await (deps.listarItens || motorMargemService.listarItens)({
    clienteSlug,
    itemIds: mlbsUnicos,
    dateFrom,
    dateTo,
  }, deps.motorMargemDeps || {});

  const encontrados = new Map(montado.itens.map((item) => [String(item.identity.itemId).toUpperCase(), item]));

  const porMlb = {};
  for (const mlb of mlbsUnicos) {
    const item = encontrados.get(mlb);
    if (!item) {
      porMlb[mlb] = { identidade: "missing", motivo: "Anúncio não encontrado no catálogo atual do Mercado Livre (pausado ou removido, por exemplo)." };
      continue;
    }
    const margem = margemExibivel(item);
    porMlb[mlb] = {
      identidade: "matched",
      status: item.quality.status,
      statusLabel: item.quality.statusLabel,
      confidence: item.quality.confidence,
      problemaPrincipal: item.quality.statusReasons?.[0] || null,
      margemTipo: margem.tipo,
      margemPercent: margem.margemPercent,
    };
  }

  return { aplicavel: true, motivo: null, codigo: null, porMlb };
}

module.exports = { avaliarAplicabilidade, comporMargemPorMlb, margemExibivel };
