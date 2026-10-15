/*
 * Central de Margem — linha de FONTE das promoções, igual na aba Promoções e
 * na Bancada.
 *
 * O servidor devolve o mesmo `fontePromocoes` nas duas respostas
 * (listarOportunidades e POST /simular). Este módulo só o transforma em texto:
 * nenhuma tela decide estado por conta própria, então nunca divergem.
 * Nenhuma regra financeira vive aqui.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.VFCentralMargemPromoFonte = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  var DATA_DESCONHECIDA = "data desconhecida";

  function dataTexto(valor, formatDate) {
    var texto = typeof formatDate === "function" && valor ? formatDate(valor) : null;
    // Sem data (ou data que o formatador recusa) diz "data desconhecida" — nunca "—".
    return texto && texto !== "—" ? texto : DATA_DESCONHECIDA;
  }

  /**
   * "<origem · data>[ · parcial][ · N com leitura anterior][ · <rótulo do estado>]".
   * Só com origem de dados há data; os estados sem dado mostram só o rótulo.
   * `opts.formatDate` é o formatador de data da tela.
   */
  function linha(fonte, opts) {
    if (!fonte) return "";
    var formatDate = opts && opts.formatDate;
    var partes = [];
    if (fonte.legado) {
      partes.push("diagnóstico legado · " + dataTexto(fonte.legado.geradoEm, formatDate));
      if (fonte.legado.parcial) partes.push("parcial");
    } else if (fonte.ultimoBom) {
      partes.push("Promo Snapshot · " + dataTexto(fonte.ultimoBom.geradoEm, formatDate));
      if (fonte.ultimoBom.parcial) partes.push("parcial");
      if (fonte.ultimoBom.itensHerdados) partes.push(fonte.ultimoBom.itensHerdados + " com leitura anterior");
    }
    if (fonte.rotulo) {
      var p = fonte.progresso;
      partes.push(fonte.rotulo + (p && p.total ? " (" + (p.processados || 0) + "/" + p.total + ")" : ""));
    }
    return partes.join(" · ");
  }

  /** Promoção que veio do diagnóstico legado: estimativa — sem leitura de hoje no ML. */
  function estimativa(promocao) {
    return Boolean(promocao && (promocao.estimativa === true || promocao.fonte === "diagnostico_legado"));
  }

  /**
   * A lista deve ser relida (polling)? Sincronizando agora, ou primeira
   * sincronização que o servidor acabou de enfileirar nesta resposta.
   */
  function sincronizando(fonte, autoTrigger) {
    if (!fonte) return false;
    return fonte.estado === "sincronizando" || (fonte.estado === "primeira_sincronizacao_pendente" && autoTrigger === "enfileirado");
  }

  return { linha: linha, estimativa: estimativa, sincronizando: sincronizando, DATA_DESCONHECIDA: DATA_DESCONHECIDA };
});
