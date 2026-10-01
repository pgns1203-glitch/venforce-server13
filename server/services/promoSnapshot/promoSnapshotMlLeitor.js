// server/services/promoSnapshot/promoSnapshotMlLeitor.js
// Promo Snapshot — ÚNICO ponto de acesso ao Mercado Livre do worker.
//
// SOMENTE LEITURA, por construção:
//   - só monta GET (nenhum method/body é aceito do chamador);
//   - só caminhos de uma lista fechada de prefixos de leitura;
//   - sempre com o token DA CONTA do run (mlUserId = seller do run) e timeout
//     real (mlFetch com timeoutMs);
//   - resposta não-ok vira erro com `mlStatus`/`retryAfter` para a política
//     de retry (marginSnapshotRetry) decidir.
// Este módulo não importa nenhum serviço de escrita (meliPrecoService,
// meliPromocoesEscritaService) — há teste travando isso.

const { mlFetch: mlFetchPadrao } = require("../../utils/mlClient");

const PREFIXOS_LEITURA = [
  /^\/users\/[^/]+\/items\/search\?/,
  /^\/seller-promotions\/items\/[^/?]+\?app_version=v2$/,
  /^\/seller-promotions\/promotions\/[^/?]+\?/,
  /^\/items\/[^/?]+\/sale_price\?/,
];

class PromoSnapshotLeituraError extends Error {
  constructor(message, { mlStatus = null, retryAfter = null, code = "PROMO_SNAPSHOT_ML_ERRO", statusCode = null } = {}) {
    super(message);
    this.name = "PromoSnapshotLeituraError";
    this.code = code;
    this.mlStatus = mlStatus;
    this.retryAfter = retryAfter;
    // Para a política de retry: recusa local (caminho/seller) = 400, nunca
    // retentada; resposta malformada = 502, retentada.
    this.statusCode = statusCode;
  }
}

function criarLeitorMl({ clienteId, sellerId, timeoutMs, mlFetch = mlFetchPadrao }) {
  if (!clienteId || !sellerId) throw new Error("criarLeitorMl: clienteId e sellerId são obrigatórios.");

  async function get(path) {
    if (typeof path !== "string" || !PREFIXOS_LEITURA.some((re) => re.test(path))) {
      throw new PromoSnapshotLeituraError(`Caminho fora da lista de leitura do Promo Snapshot: ${String(path).slice(0, 120)}`, {
        code: "PROMO_SNAPSHOT_CAMINHO_NAO_PERMITIDO", statusCode: 400,
      });
    }
    // A listagem do catálogo só pode ser a do seller DESTE run.
    if (path.startsWith("/users/") && !path.startsWith(`/users/${encodeURIComponent(String(sellerId))}/`)) {
      throw new PromoSnapshotLeituraError("Listagem de catálogo de outro seller recusada.", {
        code: "PROMO_SNAPSHOT_SELLER_DIVERGENTE", statusCode: 400,
      });
    }
    // Objeto de opções montado AQUI: nunca method/body vindos de fora.
    const resp = await mlFetch(clienteId, path, { method: "GET", mlUserId: String(sellerId), timeoutMs });
    return resp || { ok: false, status: null, data: null };
  }

  // Lança em não-ok (exceto os status tratados como "vazio" pelo chamador).
  async function getOuErro(path, { vazioEm = [] } = {}) {
    const resp = await get(path);
    if (resp.ok) return resp;
    if (vazioEm.includes(resp.status)) return { ...resp, vazio: true };
    throw new PromoSnapshotLeituraError(
      `Mercado Livre respondeu HTTP ${resp.status ?? "?"} em ${path.split("?")[0]}`,
      { mlStatus: resp.status ?? null, retryAfter: resp.retryAfter ?? null }
    );
  }

  return { get, getOuErro };
}

module.exports = { criarLeitorMl, PromoSnapshotLeituraError, PREFIXOS_LEITURA };
