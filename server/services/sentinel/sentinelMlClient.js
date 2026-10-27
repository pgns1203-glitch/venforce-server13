// server/services/sentinel/sentinelMlClient.js
// mlFetch do Sentinel: SEMPRE { noRefresh: true } (utils/mlClient.js — grant
// expirado lança ML_TOKEN_EXPIRED em vez de renovar o token) e com o mesmo prazo
// por chamada da Central (comPrazoPadrao "mlMs"). O Sentinel nunca renova token,
// nunca tenta outro grant e nunca faz fallback: token indisponível vira
// SENTINEL_TOKEN_INDISPONIVEL na conta.
//
// Cada chamada passa por um "escopo" (contagem de chamadas da conta + sinal de
// token indisponível) para o orçamento (G) e para o frete, cujo serviço da
// Central engole exceções (por isso, no caminho do frete, token indisponível
// vira { ok:false, status:401 } — não retentável — e o sinal é lido pela conta).

const { mlFetch } = require("../../utils/mlClient");
const { comPrazoPadrao } = require("../centralVendas/centralVendasPrazos");

function criarErro(code, mensagem, extra = {}) {
  const err = new Error(mensagem);
  err.code = code;
  Object.assign(err, extra);
  return err;
}

// escopo: { chamadas, maxChamadas, tokenIndisponivel, motivoToken, orcamentoEsgotado }
function criarEscopoMl({ maxChamadas = Infinity } = {}) {
  return { chamadas: 0, maxChamadas, tokenIndisponivel: false, motivoToken: null, orcamentoEsgotado: false };
}

// base: mlFetch-compatível (injetável em teste). modoFrete: não lança em token.
function criarMlFetchSentinel({ base = mlFetch, escopo = criarEscopoMl(), modoFrete = false } = {}) {
  const comNoRefresh = (clienteId, path, options = {}) => base(clienteId, path, { ...options, noRefresh: true });
  const comPrazo = comPrazoPadrao(comNoRefresh, "mlMs");

  return async function mlFetchSentinel(clienteId, path, options = {}) {
    if (escopo.tokenIndisponivel) {
      if (modoFrete) return { ok: false, status: 401, data: null, retryAfter: null };
      throw criarErro("SENTINEL_TOKEN_INDISPONIVEL", escopo.motivoToken || "Token Mercado Livre indisponível.");
    }
    if (escopo.chamadas >= escopo.maxChamadas) {
      escopo.orcamentoEsgotado = true;
      // Frete: o serviço da Central engole exceções e retenta com backoff; status 0
      // não é retentável (vira "ausente", pedido provisório — honesto).
      if (modoFrete) return { ok: false, status: 0, data: null, retryAfter: null };
      throw criarErro("SENTINEL_ORCAMENTO_CHAMADAS", `Orçamento de ${escopo.maxChamadas} chamada(s) ao ML por conta esgotado.`);
    }
    escopo.chamadas += 1;
    let resp;
    try {
      resp = await comPrazo(clienteId, path, options);
    } catch (err) {
      if (err && err.code === "ML_TOKEN_EXPIRED") {
        escopo.tokenIndisponivel = true;
        escopo.motivoToken = "Token Mercado Livre expirado (Sentinel não renova token).";
        if (modoFrete) return { ok: false, status: 401, data: null, retryAfter: null };
        throw criarErro("SENTINEL_TOKEN_INDISPONIVEL", escopo.motivoToken);
      }
      throw err;
    }
    if (resp && resp.status === 401) {
      escopo.tokenIndisponivel = true;
      escopo.motivoToken = "Mercado Livre respondeu 401 (Sentinel não renova token nem tenta fallback).";
      if (!modoFrete) throw criarErro("SENTINEL_TOKEN_INDISPONIVEL", escopo.motivoToken);
    }
    return resp;
  };
}

module.exports = { criarMlFetchSentinel, criarEscopoMl, criarErro };
