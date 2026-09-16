// server/services/meliAnuncios/meliEstoqueService.js
// -----------------------------------------------------------------------------
// Módulo: Anúncios Meli — edição real de ESTOQUE do anúncio no Mercado Livre.
//
// Mesmo contrato do meliConteudoService: escreve no ANÚNCIO REAL, devolve um
// resultado legível e nunca atualiza o snapshot local antes do ML confirmar.
//
//   Portal → controller → ClienteConta/ml_user_id → grant/token → API do ML
//          → confirmação → atualização do snapshot local → UI
//
// Mapa campo → API do Mercado Livre:
//   estoque → PUT /items/{id}   { available_quantity }
//
// ┌─ Por que o PUT é em /items e não em /user-products ────────────────────────┐
// │ A doc do ML tem três caminhos de estoque, e só UM deles é o desta tela:   │
// │                                                                          │
// │   sem multi origem ............. PUT /items/{id} { available_quantity }   │
// │   Full/Flex com distribuído .... PUT /user-products/stock/type/           │
// │                                      selling_address                      │
// │   multi origem (warehouse_      PUT /user-products/{up}/stock/type/       │
// │   management) .................      seller_warehouse                     │
// │                                                                          │
// │ Os dois últimos exigem o header x-version (400 sem ele, 409 se vier      │
// │ velho) e pressupõem depósitos/localizações que esta tela não conhece —    │
// │ ela não lê /user-products/{up}/stock nem guarda network_node_id. Então o  │
// │ caminho implementado é o primeiro, que é o documentado para vendedor sem  │
// │ multi origem. Fonte: documentacao_api_meli/estoque-distribuido.md,        │
// │ seção "Gerir estoque".                                                    │
// └──────────────────────────────────────────────────────────────────────────┘
//
// ┌─ A regra que NÃO pode ser inventada: estoque é do UP, não do item ───────┐
// │ "A modificação dos itens através do PUT ao recurso /items será replicada  │
// │  pelo Mercado Livre de forma assíncrona em todos os itens associados ao   │
// │  mesmo User Product. Os campos sincronizados são: […] available_quantity" │
// │  — documentacao_api_meli/user-products.md                                 │
// │                                                                          │
// │ Consequências que este módulo respeita:                                   │
// │  · a edição PODE partir de qualquer MLB da variação — o ML não tem        │
// │    "estoque do anúncio", tem estoque do User Product;                     │
// │  · depois de confirmado, o valor vale para TODOS os irmãos do mesmo       │
// │    user_product_id. Quem propaga isso no snapshot é o controller, e é     │
// │    propagação do que o ML já garantiu, não palpite;                       │
// │  · a réplica é ASSÍNCRONA no lado do ML: reler o irmão logo depois pode   │
// │    devolver o valor antigo por alguns instantes. Por isso o snapshot      │
// │    local recebe o valor CONFIRMADO para o item editado e o mesmo valor    │
// │    para os irmãos — nunca uma segunda leitura de cada irmão, que às       │
// │    vezes traria o número velho e gastaria uma chamada por irmão.          │
// └──────────────────────────────────────────────────────────────────────────┘
//
// O efeito colateral de status é do ML e vem LIDO da resposta, nunca deduzido:
// available_quantity = 0 pausa o anúncio (sub_status out_of_stock) e um valor
// acima de 0 reativa o que estava out_of_stock. Fonte:
// documentacao_api_meli/produto-sincronizacao-de-publicacoes.md, "Atualização
// do estoque".
// -----------------------------------------------------------------------------

const { mlFetch } = require("../../utils/mlClient");
const { motivoDoErroMl, codigoDoErroMl } = require("./meliConteudoService");

// Teto de sanidade do campo, não regra de negócio do ML: existe para uma
// digitação acidental ("1000000") não virar uma escrita real no anúncio. O ML
// tem os seus próprios limites por categoria e continua sendo a autoridade —
// se ele recusar, a recusa dele é que aparece na tela.
const ESTOQUE_MAX = 999999;

function falha(codigo, motivo) {
  return { ok: false, codigo, motivo };
}

// Aceita número ou string de dígitos e recusa o resto. `0` é valor VÁLIDO (e
// significativo: pausa o anúncio), então a validação nunca pode ser `!valor`.
function normalizarQuantidade(bruto) {
  if (bruto === null || bruto === undefined || bruto === "") {
    return { ok: false, codigo: "ESTOQUE_AUSENTE", motivo: "Informe a quantidade em estoque." };
  }
  const texto = String(bruto).trim();
  if (!/^\d+$/.test(texto)) {
    return {
      ok: false,
      codigo: "ESTOQUE_INVALIDO",
      motivo: "O estoque precisa ser um número inteiro igual ou maior que zero.",
    };
  }
  const n = Number(texto);
  if (!Number.isSafeInteger(n) || n > ESTOQUE_MAX) {
    return {
      ok: false,
      codigo: "ESTOQUE_ALTO",
      motivo: `O estoque não pode passar de ${ESTOQUE_MAX} unidades.`,
    };
  }
  return { ok: true, quantidade: n };
}

// ---------------------------------------------------------------------------
// PUT /items/{id} { available_quantity }
//
// Devolve o que o ML CONFIRMOU. `available_quantity` sai da resposta quando
// ela vem (é o valor que a UI deve exibir, não o que o operador digitou); se o
// ML responder 200 sem corpo, cai no valor enviado — que ele acabou de aceitar.
// `status`/`sub_status` só voltam quando a resposta os traz: ausentes, o
// chamador não mexe no status do snapshot em vez de supor uma transição.
// ---------------------------------------------------------------------------
async function atualizarEstoque({ clienteId, itemId, estoque, mlUserId }) {
  const v = normalizarQuantidade(estoque);
  if (!v.ok) return falha(v.codigo, v.motivo);

  const resp = await mlFetch(clienteId, `/items/${encodeURIComponent(itemId)}`, {
    method: "PUT",
    body: JSON.stringify({ available_quantity: v.quantidade }),
    mlUserId,
  });

  if (!resp || !resp.ok) {
    return falha(
      codigoDoErroMl(resp && resp.data, resp && resp.status),
      motivoDoErroMl(resp && resp.data, resp && resp.status)
    );
  }

  const data = resp.data || {};
  const confirmado =
    typeof data.available_quantity === "number" ? data.available_quantity : v.quantidade;

  return {
    ok: true,
    estoque: confirmado,
    status: data.status || null,
    // Lista vazia é ausência de sub_status, e ausência se grava NULL, não "":
    // a coluna é TEXT e o resto do módulo testa `sub_status` por verdade, então
    // string vazia seria um valor que não quer dizer nada.
    subStatus:
      (Array.isArray(data.sub_status) ? data.sub_status.join(",") : data.sub_status) || null,
    // O ML nem sempre devolve sub_status quando ele fica vazio. "Veio a chave"
    // e "veio vazia" são coisas diferentes: sem esta marca, um anúncio que
    // SAIU de out_of_stock manteria o sub_status velho no snapshot.
    temSubStatus: Object.prototype.hasOwnProperty.call(data, "sub_status"),
  };
}

module.exports = {
  atualizarEstoque,
  normalizarQuantidade,
  ESTOQUE_MAX,
};
