// server/services/meliAnuncios/meliPrecoAoVivoService.js
//
// Preço AO VIVO (vigente + cheio) de vários anúncios, SEM rodar o Motor de
// Margem. Existe para a linha da família riscar a promoção antes de ser
// expandida: o snapshot sincronizado (`preco`/`preco_original`, de GET
// /items) não enxerga promoção que só existe no sale_price (campanhas,
// automação de preço). Até aqui a linha-mãe só via o preço ao vivo depois de
// expandir, quando o Motor responde pelos filhos (`margem[id].precoAtual/
// precoOriginal`). O Motor faz muito mais do que isso (comissão, frete,
// vendas) — rodá-lo para filhos ocultos só pelo preço seria caro e arriscaria
// 429 do ML. Aqui é UMA leitura por anúncio: GET /items/{id}/sale_price, via
// o mesmo resolverPrecosItem que o Motor e as promoções já usam.
//
// Só responde por anúncios do próprio cliente (e da conta, quando houver):
// um item_id de fora vira ausência, nunca uma leitura no ML com token alheio.
// ------------------------------------------------------------------------------

const _dbModule = require("../../config/database");
const db =
  _dbModule && typeof _dbModule.query === "function"
    ? _dbModule
    : _dbModule.pool || _dbModule.default || _dbModule;
const { resolverPrecosItem } = require("../automacoes/precoItemService");
const { mapWithConcurrency } = require("../motorMargem/motorMargemService");

const PRECO_AO_VIVO_MAX_ITENS = 60;
const PRECO_AO_VIVO_CONCORRENCIA = 4;

function numOuNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// itemIds -> { [itemId]: { precoAtual, precoOriginal } }. `precoOriginal` só
// vem quando há promoção de verdade (cheio > vigente); `null` caso contrário,
// nunca uma cópia do vigente. Anúncio cuja leitura falhou fica de fora do
// mapa (o front mantém o snapshot para ele).
async function precosAoVivo({ clienteId, contaId = null, includeLegacy = true, mlUserId = null, itemIds = [] }) {
  const ids = Array.from(new Set((itemIds || []).map((s) => String(s || "").trim()).filter(Boolean)))
    .slice(0, PRECO_AO_VIVO_MAX_ITENS);
  if (!ids.length) return {};

  const params = [clienteId, ids];
  let contaSql = "";
  if (contaId != null) {
    params.push(contaId);
    contaSql = includeLegacy
      ? ` AND (cliente_conta_id = $3 OR cliente_conta_id IS NULL)`
      : ` AND cliente_conta_id = $3`;
  }
  const { rows } = await db.query(
    `SELECT item_id, preco, ml_user_id
       FROM meli_anuncios
      WHERE cliente_id = $1 AND item_id = ANY($2::text[])${contaSql}`,
    params
  );

  const resultado = {};
  await mapWithConcurrency(rows, PRECO_AO_VIVO_CONCORRENCIA, async (r) => {
    try {
      const cot = await resolverPrecosItem({
        clienteId,
        itemId: r.item_id,
        precoListaFallback: numOuNull(r.preco),
        mlUserId: r.ml_user_id || mlUserId || null,
      });
      const atual = numOuNull(cot && cot.precoEfetivo);
      if (atual === null) return;
      const cheio = numOuNull(cot.precoCheio);
      resultado[r.item_id] = {
        precoAtual: atual,
        precoOriginal: cot.precoPromocional != null && cheio !== null && cheio > atual ? cheio : null,
      };
    } catch (_) {
      // leitura individual falhou: fica de fora, nunca derruba o lote
    }
  });
  return resultado;
}

module.exports = { precosAoVivo, PRECO_AO_VIVO_MAX_ITENS };
