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

// Uma variação crua do ML -> forma que a listagem consome. `estoque`, `preco`
// e `vendidos` refletem exatamente o que o ML devolveu (0 é valor válido);
// ausência vira null, nunca 0 fabricado.
function mapearVariacaoLegado(v) {
  const atributos = (Array.isArray(v.attribute_combinations) ? v.attribute_combinations : [])
    .map(mapearAtributoCombinacao)
    .filter(Boolean);
  return {
    id: v.id,
    atributos,
    preco: typeof v.price === "number" ? v.price : null,
    estoque: typeof v.available_quantity === "number" ? v.available_quantity : null,
    vendidos: typeof v.sold_quantity === "number" ? v.sold_quantity : null,
  };
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
  return { ok: true, variacoes: lista.map(mapearVariacaoLegado) };
}

module.exports = {
  mapearVariacaoLegado,
  buscarVariacoesLegado,
};
