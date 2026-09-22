// server/services/meliAnuncios/meliPromocoesEscritaService.js
// -----------------------------------------------------------------------------
// Módulo: Anúncios Meli — ESCRITA real de participação/alteração em promoção.
//
// Escopo desta v1 (decisão de produto, ver auditoria de
// documentacao_api_meli/{gerenciar-ofertas,campanhas-tradicionais,
// campanhas-do-vendedor,desconto-individua,ofertas-do-dia,ofertas-relampago,
// campanha-com-co-participacao,campanhas-smart-price-matching,
// desconto-pre-acordado-por-item,campanhas-de-desconto-por-quantidade}.md):
// só DEAL e SELLER_CAMPAIGN têm um contrato de escrita SIMÉTRICO — POST
// participa / PUT altera — com um preço escolhido pelo vendedor, compatível
// com a célula "Preço final" que já existe no bloco "Promoções disponíveis".
//
// Todos os outros tipos ficam de fora desta v1, cada um por um motivo
// diferente:
//   - PRICE_DISCOUNT: POST cria, mas não existe PUT — a doc manda excluir e
//     recriar, e exige start_date/finish_date que esta tela não coleta;
//   - DOD/LIGHTNING: só POST, sem "alterar" documentado, e uma vez ativas não
//     podem ser removidas nem alteradas (LIGHTNING ainda exige `stock`, que
//     também não coletamos);
//   - MARKETPLACE_CAMPAIGN/VOLUME/SMART/PRICE_MATCHING/PRE_NEGOTIATED/
//     UNHEALTHY_STOCK: o vendedor só ACEITA — o corpo do POST não leva preço
//     nenhum (ou leva um offer_id que hoje não capturamos), então não há
//     "preço final editável" nenhum pra mandar.
//
// Sempre relê o estado AO VIVO da promoção (GET /seller-promotions/items/{id},
// via listarPromocoesDoItem) antes de decidir POST x PUT — nunca confia no
// status que o frontend guardou em cache, porque pode ter mudado entre a
// simulação e o clique em "Confirmar" (mesmo espírito do "GET fresco -> PUT"
// de meliVariacoesLegadoEstoqueService).
// -----------------------------------------------------------------------------

const { mlFetch } = require("../../utils/mlClient");
const { motivoDoErroMl, codigoDoErroMl } = require("./meliConteudoService");
const { listarPromocoesDoItem } = require("./meliPromocoesService");

const TIPOS_COM_ESCRITA = new Set(["DEAL", "SELLER_CAMPAIGN"]);

// Status BRUTOS do ML que podem virar PUT (alteração de preço de uma
// participação em andamento). `pending` é DELIBERADAMENTE excluído daqui:
// uma promoção agendada nunca é a que define o preço atual do anúncio — o
// próprio normalizador (meliPromocoesService) sempre marca pending como
// statusExibicao "PROGRAMADA", nunca "ATIVA" — então "alterar" algo que
// ainda não começou não faz sentido de produto (regra: PROGRAMADA → só
// Simular, nunca Alterar). Separado de propósito da classificação de status
// bruto que outros módulos usam pra rótulo/exibição (ver STATUS_LABEL em
// meliPromocoesService.js, que inclui pending como "AGENDADA") — aqui é
// estritamente "pode isto virar uma escrita real", não "como isto aparece
// na tela". Excluir pending do Set torna o bloqueio estrutural: mesmo que
// um bug futuro fizesse o normalizador marcar um pending como "ATIVA" por
// engano, este Set continuaria impedindo o PUT, porque a decisão não
// depende só de statusExibicao.
const STATUS_ALTERAVEL = new Set(["started", "active"]);

function falha(codigo, motivo) {
  return { ok: false, codigo, motivo };
}

function normalizarPrecoPromocao(bruto) {
  if (bruto === null || bruto === undefined || bruto === "") {
    return { ok: false, codigo: "PRECO_INVALIDO", motivo: "Informe o novo preço." };
  }
  const n = Number(bruto);
  if (!Number.isFinite(n) || n <= 0) {
    return { ok: false, codigo: "PRECO_INVALIDO", motivo: "O preço precisa ser um número maior que zero." };
  }
  return { ok: true, valor: Math.round((n + Number.EPSILON) * 100) / 100 };
}

async function aplicarPromocao({ clienteId, itemId, mlUserId, promotionId, precoNovo }) {
  const v = normalizarPrecoPromocao(precoNovo);
  if (!v.ok) return falha(v.codigo, v.motivo);

  const id = String(itemId || "").trim();
  if (!id) return falha("ITEM_ID_AUSENTE", "Item sem identificador do Mercado Livre.");

  // Releitura ao vivo — nunca confia no status/tipo que o frontend guardou.
  const lista = await listarPromocoesDoItem({ clienteId, itemId: id, mlUserId });
  const promo = lista.find((p) => String(p.id) === String(promotionId));
  if (!promo) {
    return falha(
      "PROMOCAO_NAO_ENCONTRADA",
      "Esta promoção não está mais disponível para este anúncio. Atualize a tela e tente novamente."
    );
  }
  if (!TIPOS_COM_ESCRITA.has(promo.tipo)) {
    return falha(
      "TIPO_SEM_ESCRITA",
      "Este tipo de promoção ainda não tem participação/alteração automática nesta tela — use o Mercado Livre diretamente."
    );
  }

  // Decisão de escrita — regra final por statusExibicao (ver auditoria):
  //   ATIVA        → PUT  (só quem está started/active E é a que o ML aponta
  //                        via sale_price.metadata.promotion_id como a que
  //                        define o preço atual)
  //   ELEGÍVEL     → POST (candidate — participação nova)
  //   NÃO APLICADA → bloqueado (started/active que não é a vencedora)
  //   PROGRAMADA   → bloqueado (pending — nem começou; nunca fica ATIVA)
  // `promo.statusExibicao` já vem calculado por listarPromocoesDoItem (mesma
  // releitura ao vivo de cima, não uma segunda chamada). `podeAlterar` exige
  // as DUAS condições (status bruto em STATUS_ALTERAVEL E statusExibicao
  // ATIVA) — nunca confia só numa das duas — para que nem um bug futuro no
  // normalizador nem uma reclassificação de status bruto sozinhos consigam
  // liberar um PUT indevido. Defesa em profundidade: o frontend já bloqueia
  // isso na UI, mas este endpoint pode ser chamado por qualquer cliente HTTP.
  const podeAlterar = STATUS_ALTERAVEL.has(promo.status) && promo.statusExibicao === "ATIVA";
  const podeParticipar = promo.status === "candidate";

  if (!podeAlterar && !podeParticipar) {
    const motivo =
      promo.status === "pending"
        ? "Esta promoção ainda não começou no Mercado Livre — ainda não é possível alterá-la."
        : "Esta promoção existe no Mercado Livre, mas não é a que está definindo o preço atual do anúncio — atualize a tela e confira qual promoção está realmente aplicada.";
    return falha("PROMOCAO_NAO_APLICADA", motivo);
  }

  const metodo = podeAlterar ? "PUT" : "POST";

  const writeResp = await mlFetch(
    clienteId,
    `/seller-promotions/items/${encodeURIComponent(id)}?app_version=v2`,
    {
      method: metodo,
      body: JSON.stringify({
        promotion_id: promotionId,
        promotion_type: promo.tipo,
        deal_price: v.valor,
      }),
      mlUserId,
    }
  );

  if (!writeResp || !writeResp.ok) {
    return falha(
      codigoDoErroMl(writeResp && writeResp.data, writeResp && writeResp.status),
      motivoDoErroMl(writeResp && writeResp.data, writeResp && writeResp.status)
    );
  }

  // Nunca assumir o valor enviado — o confirmado é sempre o que a RESPOSTA
  // do POST/PUT devolve (mesma garantia de meliPrecoService.atualizarPreco).
  const precoConfirmado = Number(writeResp.data && writeResp.data.price);
  const precoOriginal = Number(writeResp.data && writeResp.data.original_price);

  return {
    ok: true,
    metodo,
    promotionId,
    tipo: promo.tipo,
    precoConfirmado: Number.isFinite(precoConfirmado) ? precoConfirmado : null,
    precoOriginal: Number.isFinite(precoOriginal) ? precoOriginal : null,
  };
}

module.exports = {
  aplicarPromocao,
  normalizarPrecoPromocao,
  TIPOS_COM_ESCRITA,
};
