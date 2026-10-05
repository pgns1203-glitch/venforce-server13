// Prazo para uma promessa que pode ficar pendurada (rede/banco sem resposta).
// A promessa original NÃO é cancelada (JS não cancela): quem precisa liberar o
// recurso (abortar o fetch, descartar a conexão) faz isso em `onTimeout`.
// A promessa abandonada ganha um catch para nunca virar unhandledRejection.
class PrazoExcedidoError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = "PrazoExcedidoError";
    this.code = code;
    Object.assign(this, extra);
  }
}

function comPrazo(promessa, ms, { code = "PRAZO_EXCEDIDO", message = null, onTimeout = null } = {}) {
  if (!(Number(ms) > 0)) return promessa;
  Promise.resolve(promessa).catch(() => {});
  let timer;
  const expirou = new Promise((_, rejeitar) => {
    timer = setTimeout(() => {
      const err = new PrazoExcedidoError(code, message || `Sem resposta em ${Math.round(ms)} ms.`, { prazoMs: Number(ms) });
      if (typeof onTimeout === "function") {
        try { onTimeout(err); } catch (_) { /* o prazo vence mesmo se a limpeza falhar */ }
      }
      rejeitar(err);
    }, Number(ms));
  });
  return Promise.race([promessa, expirou]).finally(() => clearTimeout(timer));
}

// Cancelamento COOPERATIVO: o trabalho que o prazo abandonou (ex.: uma unidade de sync) não é interrompível
// à força; ele checa o sinal nos pontos seguros (antes de cada etapa/gravação) e para sozinho, em vez de
// continuar gravando depois que o chamador já o deu por perdido.
function assertNaoCancelado(signal, etapa = "") {
  if (signal && signal.aborted) {
    throw new PrazoExcedidoError("UNIDADE_CANCELADA", `Execução cancelada por prazo${etapa ? ` (antes de: ${etapa})` : ""}.`, { cancelado: true });
  }
}

module.exports = { comPrazo, PrazoExcedidoError, assertNaoCancelado };
