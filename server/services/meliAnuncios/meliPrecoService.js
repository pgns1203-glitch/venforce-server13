// server/services/meliAnuncios/meliPrecoService.js
// -----------------------------------------------------------------------------
// Módulo: Anúncios Meli — edição real de PREÇO do anúncio no Mercado Livre.
//
// Mesmo contrato dos irmãos (meliConteudoService, meliEstoqueService): escreve
// no ANÚNCIO REAL, e o snapshot local só é atualizado depois do ML CONFIRMAR.
//
// Por que NÃO é um PUT /items/{id} { price }:
// desde 18/03/2026 o ML rejeita (400, "item.price.not_modifiable") um PUT que
// altera SÓ o preço quando o item tem automatização de preço (dynamic
// pricing) ativa — e se o preço vier junto de outros campos, o valor de
// price é silenciosamente IGNORADO com um warning. Nenhum dos dois
// comportamentos serve para uma tela que promete escrever o preço real.
// O caminho correto é a API dedicada de Preços:
//
//   GET  /items/{id}/prices           -> localizar o preço "standard" atual
//   POST /items/{id}/prices/standard  -> gravar o novo valor nesse MESMO id
//   GET  /items/{id}/prices           -> reler o que o ML confirmou
//
// A releitura final NUNCA é pulada: o valor exibido é sempre o CONFIRMADO,
// nunca o que foi enviado — mesmo quando o POST responde 200.
//
// Itens com variações nativas do ML têm preço por variação, fluxo que esta
// tela não implementa — bloqueado ANTES de qualquer chamada de preço, com
// mensagem explicando o motivo, em vez de arriscar alterar o item errado.
// -----------------------------------------------------------------------------

const { mlFetch } = require("../../utils/mlClient");
const { motivoDoErroMl, codigoDoErroMl } = require("./meliConteudoService");

function falha(codigo, motivo) {
  return { ok: false, codigo, motivo };
}

function normalizarPreco(bruto) {
  if (bruto === null || bruto === undefined || bruto === "") {
    return { ok: false, codigo: "PRECO_AUSENTE", motivo: "Informe o novo preço." };
  }
  const n = Number(bruto);
  if (!Number.isFinite(n) || n <= 0) {
    return { ok: false, codigo: "PRECO_INVALIDO", motivo: "O preço precisa ser um número maior que zero." };
  }
  return { ok: true, valor: Math.round((n + Number.EPSILON) * 100) / 100 };
}

// O preço "standard" é o preço-base sem restrição de canal/quantidade mínima
// (faixas de atacado e outros contextos têm `conditions` preenchido — ver
// meliCriacaoService.obterPrecoStandardBase, mesma leitura).
function obterPrecoStandard(data) {
  const prices = Array.isArray(data && data.prices) ? data.prices : [];
  return (
    prices.find((price) => {
      if (!price || price.type !== "standard" || !price.id) return false;
      const conditions = price.conditions || {};
      const contexts = Array.isArray(conditions.context_restrictions)
        ? conditions.context_restrictions
        : [];
      return (
        contexts.length === 0 &&
        (conditions.min_purchase_unit == null || conditions.min_purchase_unit === "")
      );
    }) || null
  );
}

const MOTIVO_VARIACAO =
  "Este anúncio tem variações — a edição de preço por variação ainda não está disponível nesta tela.";

const MOTIVO_AUTOMACAO =
  "Este anúncio tem automatização de preço (preço dinâmico) ativa no Mercado Livre — a alteração manual de preço não é permitida enquanto ela estiver ligada.";

// Falha de rede/token na CHECAGEM de variação não pode travar a tela inteira
// por um motivo que não é o dela: se algo estiver errado com a conta, a
// tentativa de escrita adiante vai falhar do mesmo jeito, com o erro real.
async function temVariacao(clienteId, itemId, mlUserId) {
  const resp = await mlFetch(
    clienteId,
    `/items/${encodeURIComponent(itemId)}?attributes=id,variations`,
    { mlUserId }
  );
  if (!resp || !resp.ok) return false;
  return Array.isArray(resp.data && resp.data.variations) && resp.data.variations.length > 0;
}

async function atualizarPreco({ clienteId, itemId, novoPreco, mlUserId }) {
  const v = normalizarPreco(novoPreco);
  if (!v.ok) return falha(v.codigo, v.motivo);

  const id = String(itemId || "").trim();
  if (!id) return falha("ITEM_ID_AUSENTE", "Item sem identificador do Mercado Livre.");

  if (await temVariacao(clienteId, id, mlUserId)) {
    return falha("PRECO_ITEM_COM_VARIACAO", MOTIVO_VARIACAO);
  }

  const precosResp = await mlFetch(clienteId, `/items/${encodeURIComponent(id)}/prices`, {
    headers: { "show-all-prices": "true" },
    mlUserId,
  });
  if (!precosResp || !precosResp.ok) {
    return falha(
      codigoDoErroMl(precosResp && precosResp.data, precosResp && precosResp.status),
      motivoDoErroMl(precosResp && precosResp.data, precosResp && precosResp.status)
    );
  }
  const standard = obterPrecoStandard(precosResp.data);
  if (!standard) {
    return falha("PRECO_STANDARD_NAO_ENCONTRADO", "O preço padrão deste anúncio não foi encontrado.");
  }

  const writeResp = await mlFetch(clienteId, `/items/${encodeURIComponent(id)}/prices/standard`, {
    method: "POST",
    body: JSON.stringify({
      prices: [{ id: String(standard.id), amount: v.valor, currency_id: standard.currency_id }],
    }),
    mlUserId,
  });
  if (!writeResp || !writeResp.ok) {
    const codigo = codigoDoErroMl(writeResp && writeResp.data, writeResp && writeResp.status);
    if (/not_modifiable/i.test(codigo)) return falha(codigo, MOTIVO_AUTOMACAO);
    return falha(codigo, motivoDoErroMl(writeResp && writeResp.data, writeResp && writeResp.status));
  }

  // Regra que não pode ser pulada: nunca assumir o valor enviado.
  const confirmResp = await mlFetch(clienteId, `/items/${encodeURIComponent(id)}/prices`, {
    headers: { "show-all-prices": "true" },
    mlUserId,
  });
  const confirmado = confirmResp && confirmResp.ok ? obterPrecoStandard(confirmResp.data) : null;
  if (!confirmado || !Number.isFinite(Number(confirmado.amount))) {
    return falha(
      "PRECO_CONFIRMACAO_FALHOU",
      "O preço pode ter sido alterado, mas não foi possível confirmar o valor com o Mercado Livre."
    );
  }

  return { ok: true, preco: Number(confirmado.amount), moeda: confirmado.currency_id || null };
}

module.exports = {
  atualizarPreco,
  normalizarPreco,
  obterPrecoStandard,
  MOTIVO_VARIACAO,
  MOTIVO_AUTOMACAO,
};
