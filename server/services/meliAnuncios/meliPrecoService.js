// server/services/meliAnuncios/meliPrecoService.js
// -----------------------------------------------------------------------------
// Módulo: Anúncios Meli — edição real de PREÇO do anúncio no Mercado Livre.
//
// Mesmo contrato dos irmãos (meliConteudoService, meliEstoqueService): escreve
// no ANÚNCIO REAL, e o snapshot local só é atualizado depois do ML CONFIRMAR.
//
// Por que é PUT /items/{id} { price } (e não a API dedicada de Preços):
// documentacao_api_meli/api-de-precos.md, seção "Editar preços tipo standard",
// é explícita: "Esta API ainda não está disponível. Em breve substituirá o
// PUT de itens para editar preços." — POST /items/{id}/prices/standard é uma
// rota documentada mas que o Mercado Livre ainda não serve (404 em produção,
// achado desta rodada). Até ela existir, o próprio doc orienta continuar
// usando /items para editar preço.
//
// Isso implica dois bloqueios ANTES do PUT, cada um por um motivo diferente:
//
//   1. Automação de preço ativa (dynamic pricing) — desde 18/03/2026 (doc
//      automatizacoes-de-precos.md) um PUT que só altera "price" é rejeitado
//      com 400 "item.price.not_modifiable". Tratado reativamente: tentamos o
//      PUT e traduzimos o erro, em vez de gastar uma chamada extra de
//      pré-checagem.
//
//   2. Promoção ativa (GET /items/{id}/sale_price: regular_amount > amount,
//      doc api-de-precos.md) — o valor EXIBIDO nesta tela (item.pricing.current
//      no Motor de Margem) é o preço EFETIVO, que nesse caso é o promocional,
//      não o standard. PUT /items altera o preço STANDARD. Editar sem
//      bloquear faria a tela mostrar um valor e gravar outro — bloqueado
//      ANTES do PUT, com mensagem explicando o motivo.
//
// O valor confirmado após sucesso é sempre o que vem na RESPOSTA do PUT (a
// representação do item que o próprio Mercado Livre devolve), nunca o valor
// bruto enviado — mesmo contrato de atualizarTitulo/atualizarModelo em
// meliConteudoService.enviarItem.
//
// Itens com variações nativas do ML têm preço por variação, fluxo que esta
// tela não implementa — bloqueado ANTES de qualquer chamada de preço, com
// mensagem explicando o motivo, em vez de arriscar alterar o item errado.
// -----------------------------------------------------------------------------

const { mlFetch } = require("../../utils/mlClient");
const { motivoDoErroMl, codigoDoErroMl } = require("./meliConteudoService");
const { resolverPrecosItem } = require("../automacoes/precoItemService");

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

const MOTIVO_VARIACAO =
  "Este anúncio tem variações — a edição de preço por variação ainda não está disponível nesta tela.";

const MOTIVO_AUTOMACAO =
  "Este anúncio tem automatização de preço (preço dinâmico) ativa no Mercado Livre — a alteração manual de preço não é permitida enquanto ela estiver ligada.";

const MOTIVO_PROMOCAO =
  "Este anúncio está com uma promoção ativa no Mercado Livre — o valor mostrado é o preço promocional vigente, que esta tela ainda não edita. Ajuste a promoção diretamente no Mercado Livre.";

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

// Mesma leitura de preço que o Motor de Margem usa para "item.pricing.current"
// (GET /items/{id}/sale_price) — reaproveitada aqui só para decidir se há
// promoção ativa, nunca para calcular nada.
async function temPromocaoAtiva(clienteId, itemId, mlUserId) {
  const cotacao = await resolverPrecosItem({ clienteId, itemId, mlUserId });
  return cotacao.precoPromocional != null;
}

async function atualizarPreco({ clienteId, itemId, novoPreco, mlUserId }) {
  const v = normalizarPreco(novoPreco);
  if (!v.ok) return falha(v.codigo, v.motivo);

  const id = String(itemId || "").trim();
  if (!id) return falha("ITEM_ID_AUSENTE", "Item sem identificador do Mercado Livre.");

  if (await temVariacao(clienteId, id, mlUserId)) {
    return falha("PRECO_ITEM_COM_VARIACAO", MOTIVO_VARIACAO);
  }

  if (await temPromocaoAtiva(clienteId, id, mlUserId)) {
    return falha("PRECO_ITEM_COM_PROMOCAO", MOTIVO_PROMOCAO);
  }

  const writeResp = await mlFetch(clienteId, `/items/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify({ price: v.valor }),
    mlUserId,
  });
  if (!writeResp || !writeResp.ok) {
    const codigo = codigoDoErroMl(writeResp && writeResp.data, writeResp && writeResp.status);
    if (/not_modifiable/i.test(codigo)) return falha(codigo, MOTIVO_AUTOMACAO);
    return falha(codigo, motivoDoErroMl(writeResp && writeResp.data, writeResp && writeResp.status));
  }

  // Regra que não pode ser pulada: nunca assumir o valor enviado — o
  // confirmado é sempre o que a RESPOSTA do PUT devolve.
  const confirmado = Number(writeResp.data && writeResp.data.price);
  if (!Number.isFinite(confirmado)) {
    return falha(
      "PRECO_CONFIRMACAO_FALHOU",
      "O preço pode ter sido alterado, mas não foi possível confirmar o valor com o Mercado Livre."
    );
  }

  return { ok: true, preco: confirmado, moeda: (writeResp.data && writeResp.data.currency_id) || null };
}

module.exports = {
  atualizarPreco,
  normalizarPreco,
  MOTIVO_VARIACAO,
  MOTIVO_AUTOMACAO,
  MOTIVO_PROMOCAO,
};
