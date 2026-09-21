// server/services/meliAnuncios/meliVariacoesLegadoService.js
// -----------------------------------------------------------------------------
// Módulo: Anúncios Meli — leitura das VARIAÇÕES do modelo LEGADO do Mercado
// Livre (item_id -> variations[]), para expandir um anúncio sem family_id que
// mesmo assim tem cor/tamanho reais no ML (achado da auditoria MLB2652739620,
// ver meliSyncService.mapearItem — variations_count).
//
// Só LEITURA. Nenhuma escrita fica aqui: editar estoque/preço de uma variação
// legada exige um PUT /items/{id} com a propriedade `variations` inteira, e o
// ML documenta que omitir uma variação existente desse array a REMOVE
// (documentacao_api_meli/variacoes.md, "Remover variações" e "Outra forma de
// remover variações") — não existe um PUT dedicado a uma variação isolada.
// Implementar a edição sem confirmar esse contrato arriscaria apagar
// variações de verdade em produção, então a ação de editar fica de fora desta
// entrega — mesmo motivo que barra qualquer heurística nesta tela.
//
// Fonte: documentacao_api_meli/variacoes.md — GET /items/{id}/variations
// devolve, por variação: id, attribute_combinations[{id,name,value_id,
// value_name}], price, available_quantity, sold_quantity, picture_ids.
//
// image_url (visual, não persistido): picture_ids[0] é o MESMO id usado em
// item.pictures[].id (confirmado no exemplo de criação da doc — o id que
// entra no POST volta idêntico no GET). Por isso buscarVariacoesLegado faz
// uma segunda chamada, só de leitura, GET /items/{id}?attributes=pictures,
// para montar esse relacionamento — ver construirMapaImagensDoItem.
// -----------------------------------------------------------------------------

const { mlFetch } = require("../../utils/mlClient");
const { motivoDoErroMl, codigoDoErroMl } = require("./meliConteudoService");

function falha(codigo, motivo) {
  return { ok: false, codigo, motivo };
}

// Rótulo de um atributo da combinação: usa `name` (o que o comprador vê,
// inclusive em característica personalizada — variacoes.md, "Característica
// personalizada") e cai para `id` só quando `name` não veio. `value_name` é o
// valor legível; sem ele (nunca deveria faltar, mas o ML é quem garante, não
// este código) o atributo fica de fora em vez de mostrar um valor inventado.
function mapearAtributoCombinacao(ac) {
  if (!ac) return null;
  const nome = ac.name || ac.id;
  if (!nome || ac.value_name == null) return null;
  return { nome: String(nome), valor: String(ac.value_name) };
}

// Relação DOCUMENTADA (não inventada): variation.picture_ids[i] é o MESMO id
// usado em item.pictures[].id (variacoes.md — o id enviado em pictures:[{id}]
// no POST volta idêntico em variations[].picture_ids no GET). Não existe flag
// oficial de "imagem principal" nem no item nem na variação — a única
// convenção observável na doc é ORDEM: o primeiro id é sempre o usado nos
// exemplos, a mesma convenção já adotada neste projeto para a capa da família
// (item.pictures[0], ver "Capa dinâmica da família"). Por isso: só o PRIMEIRO
// picture_id da variação é considerado — se ele não tiver match, cai para a
// imagem principal do item (pictures[0]), nunca tenta os ids seguintes (isso
// seria inventar uma associação que o ML não garante).
function construirMapaImagensDoItem(item) {
  const pictures = Array.isArray(item && item.pictures) ? item.pictures : [];
  const pictureUrlById = {};
  for (const p of pictures) {
    if (p && p.id) pictureUrlById[p.id] = p.secure_url || p.url || null;
  }
  const imagemPrincipalItem = pictures.length ? (pictures[0].secure_url || pictures[0].url || null) : null;
  return { pictureUrlById, imagemPrincipalItem };
}

function resolverImagemVariacao(v, imagens) {
  const pictureUrlById = (imagens && imagens.pictureUrlById) || {};
  const picIds = Array.isArray(v.picture_ids) ? v.picture_ids : [];
  if (picIds.length > 0) {
    const url = pictureUrlById[picIds[0]];
    if (url) return url;
  }
  return (imagens && imagens.imagemPrincipalItem) || null;
}

// Uma variação crua do ML -> forma que a listagem consome. `estoque`, `preco`
// e `vendidos` refletem exatamente o que o ML devolveu (0 é valor válido);
// ausência vira null, nunca 0 fabricado. `imagens` é opcional (ver
// construirMapaImagensDoItem) — sem ele, image_url é sempre null.
function mapearVariacaoLegado(v, imagens) {
  const atributos = (Array.isArray(v.attribute_combinations) ? v.attribute_combinations : [])
    .map(mapearAtributoCombinacao)
    .filter(Boolean);
  return {
    id: v.id,
    atributos,
    preco: typeof v.price === "number" ? v.price : null,
    estoque: typeof v.available_quantity === "number" ? v.available_quantity : null,
    vendidos: typeof v.sold_quantity === "number" ? v.sold_quantity : null,
    image_url: resolverImagemVariacao(v, imagens),
  };
}

// GET /items/{itemId}?attributes=pictures — só para relacionar picture_ids
// com item.pictures. Falha aqui NUNCA derruba a leitura das variações: imagem
// é melhoria visual, não dado crítico. Degrada para "sem imagem" (null em
// todas), nunca bloqueia a expansão do painel.
async function resolverImagensDoItem({ clienteId, itemId, mlUserId }) {
  try {
    const resp = await mlFetch(clienteId, `/items/${encodeURIComponent(itemId)}?attributes=pictures`, {
      mlUserId,
    });
    if (!resp || !resp.ok) return { pictureUrlById: {}, imagemPrincipalItem: null };
    return construirMapaImagensDoItem(resp.data);
  } catch (_) {
    return { pictureUrlById: {}, imagemPrincipalItem: null };
  }
}

// GET /items/{itemId}/variations — a MESMA lista que a VIP oficial do ML usa
// para exibir cor/tamanho. Chamada sob demanda (primeira expansão), nunca na
// sincronização em massa: nenhuma dessas colunas é persistida em meli_anuncios.
async function buscarVariacoesLegado({ clienteId, itemId, mlUserId }) {
  const resp = await mlFetch(clienteId, `/items/${encodeURIComponent(itemId)}/variations`, {
    mlUserId,
  });

  if (!resp || !resp.ok) {
    return falha(
      codigoDoErroMl(resp && resp.data, resp && resp.status),
      motivoDoErroMl(resp && resp.data, resp && resp.status)
    );
  }

  const lista = Array.isArray(resp.data) ? resp.data : [];
  const imagens = await resolverImagensDoItem({ clienteId, itemId, mlUserId });
  return { ok: true, variacoes: lista.map((v) => mapearVariacaoLegado(v, imagens)) };
}

module.exports = {
  mapearVariacaoLegado,
  buscarVariacoesLegado,
  construirMapaImagensDoItem,
};
