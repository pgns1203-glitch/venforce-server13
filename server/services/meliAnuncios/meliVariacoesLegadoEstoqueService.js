// server/services/meliAnuncios/meliVariacoesLegadoEstoqueService.js
// -----------------------------------------------------------------------------
// Módulo: Anúncios Meli — edição de ESTOQUE de uma VARIAÇÃO do modelo LEGADO
// (item_id -> variations[]).
//
// Não existe PUT dedicado a uma variação isolada: o único caminho é
// PUT /items/{id} reenviando a propriedade `variations` INTEIRA — e o ML
// documenta que omitir uma variação existente desse array a REMOVE
// (documentacao_api_meli/variacoes.md, "Remover variações" e "Modificar
// estoque"). Este módulo existe só para tornar essa escrita segura:
//
//   1. a fonte autoritativa é SEMPRE um GET fresco, feito aqui dentro, nunca
//      a tela/cache que chamou esta função;
//   2. o PUT reenvia TODOS os ids que esse GET fresco acabou de devolver,
//      mudando `available_quantity` só da variação alvo;
//   3. depois do PUT, um NOVO GET confirma o estado — só existe sucesso se a
//      variação alvo ainda existe, o valor bate e a contagem não caiu;
//   4. contagem menor depois do PUT do que antes é tratada como falha
//      CRÍTICA (indício de variação apagada): nunca sucesso, nunca retry
//      automático, sempre log de alta severidade para conferência manual.
//
// Não há versionamento documentado para PUT /items/{id} (sem x-version, sem
// 409), ao contrário dos endpoints de estoque por User Product — este código
// não inventa proteção que a API não oferece; a mitigação é o par
// GET-fresco→PUT→GET-de-confirmação acima, o mais próximo de atômico que dá
// para chegar sem suporte nativo do ML.
// -----------------------------------------------------------------------------

const { mlFetch } = require("../../utils/mlClient");
const { motivoDoErroMl, codigoDoErroMl } = require("./meliConteudoService");
const { normalizarQuantidade } = require("./meliEstoqueService");
const {
  mapearVariacaoLegado,
  construirMapaImagensDoItem,
  avaliarBloqueioEdicaoVariacaoLegado,
} = require("./meliVariacoesLegadoService");

function falha(codigo, motivo) {
  return { ok: false, codigo, motivo };
}

// Falha crítica: perda de variação é séria demais para um log comum — vira
// evento estruturado (mesmo padrão de mlClient.js) para caçar em produção.
function falhaCritica(codigo, motivo, contexto) {
  console.error(JSON.stringify({ event: "meli_variacao_legado_perda_critica", codigo, ...contexto }));
  return { ok: false, codigo, motivo, critico: true };
}

async function atualizarEstoqueVariacaoLegado({ clienteId, itemId, variationId, estoque, mlUserId }) {
  if (variationId === null || variationId === undefined || variationId === "") {
    return falha("VARIACAO_ID_AUSENTE", "Informe a variação a editar.");
  }

  const quantidade = normalizarQuantidade(estoque);
  if (!quantidade.ok) return falha(quantidade.codigo, quantidade.motivo);

  // 1) Item ao vivo — nunca o snapshot local. Precisa saber, no instante da
  // escrita, se o item ainda é legado (sem user_product_id) e se não está
  // num contexto onde o estoque é gerenciado externamente (Full).
  const itemResp = await mlFetch(clienteId, `/items/${encodeURIComponent(itemId)}`, { mlUserId });
  if (!itemResp || !itemResp.ok) {
    if (itemResp && itemResp.status === 404) {
      return falha("ITEM_NAO_ENCONTRADO", "Anúncio não encontrado no Mercado Livre.");
    }
    return falha(
      codigoDoErroMl(itemResp && itemResp.data, itemResp && itemResp.status),
      motivoDoErroMl(itemResp && itemResp.data, itemResp && itemResp.status)
    );
  }
  const item = itemResp.data || {};
  // item.pictures já veio de graça neste GET (resposta padrão, sem filtro de
  // attributes) — usado só na resposta final (image_url), zero chamada extra.
  const imagens = construirMapaImagensDoItem(item);
  if (item.user_product_id) {
    return falha(
      "USER_PRODUCT_MIGRADO",
      "Este anúncio já está no modelo novo (User Product) — a edição por variação legada não se aplica mais."
    );
  }
  // Mesma regra usada pela LEITURA (buscarVariacoesLegado) para sinalizar
  // podeEditarEstoque — mas aqui, fresca, é quem decide de verdade: a leitura
  // pode estar desatualizada, esta checagem nunca confia nela sozinha.
  const bloqueioItem = avaliarBloqueioEdicaoVariacaoLegado(item, null);
  if (!bloqueioItem.podeEditar) {
    return falha("FULL_INCOMPATIVEL", bloqueioItem.motivoTexto);
  }

  // 2) Variações ao vivo — a fonte autoritativa para montar o PUT. Chamada
  // imediatamente antes do PUT (nenhuma outra chamada de rede entre as duas):
  // é exatamente a proteção contra reenviar um array desatualizado.
  const antes = await mlFetch(clienteId, `/items/${encodeURIComponent(itemId)}/variations`, { mlUserId });
  if (!antes || !antes.ok) {
    return falha(
      codigoDoErroMl(antes && antes.data, antes && antes.status),
      motivoDoErroMl(antes && antes.data, antes && antes.status)
    );
  }
  const listaAntes = Array.isArray(antes.data) ? antes.data : [];

  if (listaAntes.some((v) => v.id === undefined || v.id === null)) {
    return falha(
      "VARIACAO_SEM_ID",
      "O Mercado Livre devolveu uma variação sem id — a edição foi bloqueada para não arriscar apagar variações."
    );
  }

  const alvo = listaAntes.find((v) => String(v.id) === String(variationId));
  if (!alvo) {
    return falha("VARIACAO_INEXISTENTE", "Esta variação não existe mais no Mercado Livre.");
  }
  const bloqueioVariacao = avaliarBloqueioEdicaoVariacaoLegado(item, alvo);
  if (!bloqueioVariacao.podeEditar) {
    return falha("VARIACAO_GERENCIADA_EXTERNAMENTE", bloqueioVariacao.motivoTexto);
  }

  const nAntes = listaAntes.length;

  // Payload mínimo documentado (variacoes.md, "Modificar estoque"): só id e
  // available_quantity por variação — nunca price/attribute_combinations/
  // picture_ids reconstruídos aqui, e nunca a variação alvo com outro campo
  // além do estoque alterado.
  const payload = listaAntes.map((v) => ({
    id: v.id,
    available_quantity: String(v.id) === String(variationId) ? quantidade.quantidade : v.available_quantity,
  }));

  const put = await mlFetch(clienteId, `/items/${encodeURIComponent(itemId)}`, {
    method: "PUT",
    body: JSON.stringify({ variations: payload }),
    mlUserId,
  });
  if (!put || !put.ok) {
    return falha(
      codigoDoErroMl(put && put.data, put && put.status),
      motivoDoErroMl(put && put.data, put && put.status)
    );
  }

  // 3) Confirmação — outro GET fresco. Nunca a resposta do PUT (o ML nem
  // sempre a devolve completa) e nunca o array que acabamos de montar.
  const depois = await mlFetch(clienteId, `/items/${encodeURIComponent(itemId)}/variations`, { mlUserId });
  if (!depois || !depois.ok) {
    return falha(
      "CONFIRMACAO_FALHOU",
      "O Mercado Livre aceitou a alteração, mas não foi possível confirmar o novo estado. Verifique manualmente antes de repetir a operação."
    );
  }
  const listaDepois = Array.isArray(depois.data) ? depois.data : [];
  const nDepois = listaDepois.length;
  const alvoDepois = listaDepois.find((v) => String(v.id) === String(variationId));

  if (nDepois < nAntes || !alvoDepois) {
    return falhaCritica(
      "PERDA_DE_VARIACAO",
      "ATENÇÃO: uma ou mais variações deste anúncio podem ter sido removidas pelo Mercado Livre durante esta operação. Confira manualmente no Mercado Livre antes de repetir qualquer edição.",
      { clienteId, itemId, variationId, nAntes, nDepois }
    );
  }
  if (alvoDepois.available_quantity !== quantidade.quantidade) {
    return falha(
      "CONFIRMACAO_DIVERGENTE",
      "O Mercado Livre confirmou um valor diferente do enviado — a tela não pode assumir sucesso."
    );
  }

  return { ok: true, variacoes: listaDepois.map((v) => mapearVariacaoLegado(v, imagens, item)) };
}

module.exports = {
  atualizarEstoqueVariacaoLegado,
};
