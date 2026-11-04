/*
 * Central de Margem — barra de ATUALIZAÇÃO das promoções (aba Promoções).
 *
 * Transforma a resposta de GET .../promocoes/status (Promo Snapshot da CONTA
 * ativa) no que a barra mostra: estado, texto, progresso real do run e o
 * botão Atualizar. Quem decide se a atualização está disponível é o servidor
 * (`atualizacao`: worker ligado, allowlist do piloto, run em andamento,
 * cooldown) — este módulo só renderiza. Nenhuma regra financeira vive aqui e
 * nada aqui chama o Mercado Livre.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.VFCentralMargemPromoSync = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  function num(v) {
    var n = Number(v);
    return v === null || v === undefined || v === "" || !Number.isFinite(n) ? null : n;
  }

  function inteiro(n) {
    return Number(n).toLocaleString("pt-BR");
  }

  function idadeTexto(minutos) {
    var m = num(minutos);
    if (m === null) return null;
    if (m < 1) return "agora há pouco";
    if (m < 60) return "há " + Math.round(m) + " min";
    var h = m / 60;
    if (h < 48) return "há " + Math.round(h) + " h";
    return "há " + Math.round(h / 24) + " dias";
  }

  function dataTexto(valor, formatDate) {
    var t = valor && typeof formatDate === "function" ? formatDate(valor) : null;
    return t && t !== "—" ? t : "data desconhecida";
  }

  /** Progresso REAL do run ativo (o que o worker já gravou no banco). */
  function progressoDoRun(sync) {
    var run = sync && sync.activeRun;
    if (!run) return null;
    var total = num(run.itensTotal);
    if (total === null) total = num(sync.total);
    var feitos = num(run.itensProcessados);
    if (feitos === null) feitos = num(sync.processed) || 0;
    var pct = total ? Math.max(0, Math.min(100, Math.floor((feitos / total) * 100))) : null;
    return {
      status: run.status || null,
      processados: feitos,
      total: total,
      pct: pct,
      rateLimits: num(run.rateLimits) || 0,
      erros: num(run.erros) || 0,
    };
  }

  function textoDoProgresso(p) {
    if (!p) return "";
    if (p.status === "queued") return "Na fila: aguardando o worker iniciar a leitura.";
    if (p.total === null) return "Listando os anúncios da conta…";
    var partes = [inteiro(p.processados) + " de " + inteiro(p.total) + " anúncios lidos" + (p.pct !== null ? " (" + p.pct + "%)" : "")];
    if (p.rateLimits) partes.push(p.rateLimits + (p.rateLimits === 1 ? " pausa" : " pausas") + " por limite do Mercado Livre (429)");
    if (p.erros) partes.push(inteiro(p.erros) + (p.erros === 1 ? " anúncio sem leitura" : " anúncios sem leitura"));
    return partes.join(" · ");
  }

  function textoDaFalha(u) {
    if (!u) return "motivo não informado";
    var partes = [u.erroMotivo || u.erroCodigo || "motivo não informado"];
    if (u.erroMensagem && u.erroMensagem !== u.erroMotivo) partes.push(u.erroMensagem);
    if (u.rateLimits) partes.push(u.rateLimits + " respostas 429 do Mercado Livre");
    return partes.join(" — ");
  }

  /** Resultado do último run terminado, em uma linha (para "concluída"). */
  function textoDoResultado(u) {
    if (!u) return "";
    var partes = [];
    if (num(u.itensTotal) !== null) partes.push(inteiro(u.itensTotal) + " anúncios lidos");
    if (num(u.promocoes) !== null) partes.push(inteiro(u.promocoes) + " promoções");
    if (u.erros) partes.push(inteiro(u.erros) + " sem leitura");
    if (u.duracaoSegundos !== null && u.duracaoSegundos !== undefined) {
      var s = Number(u.duracaoSegundos);
      partes.push("em " + (s < 90 ? s + " s" : Math.round(s / 60) + " min"));
    }
    return partes.join(" · ");
  }

  /**
   * @param {object|null} status  resposta de /promocoes/status (ok:true)
   * @param {object} [opts]       { formatDate, erro (texto, falha ao ler o status) }
   * @returns {{ estado, tom, titulo, detalhe, conta, progresso, botao, acompanhar }}
   */
  function modelo(status, opts) {
    opts = opts || {};
    var formatDate = opts.formatDate;
    if (opts.erro || !status) {
      return {
        estado: "erro_status", tom: "danger",
        titulo: "Não foi possível ler o estado das promoções desta conta.",
        detalhe: opts.erro || "", conta: "", progresso: null, acompanhar: false,
        botao: { visivel: true, habilitado: false, rotulo: "Atualizar promoções", titulo: "Estado indisponível" },
      };
    }
    var at = status.atualizacao || { disponivel: false, motivo: null, mensagem: null };
    var sync = status.sync;
    var u = status.ultimaTentativa || null;
    var conta = (status.contaNome ? status.contaNome + " · " : "") + "conta " + status.clienteContaId +
      (status.sellerId ? " · seller " + status.sellerId : "");
    var botao = {
      visivel: true,
      habilitado: at.disponivel === true,
      rotulo: "Atualizar promoções",
      titulo: at.disponivel ? "Lê agora as promoções desta conta no Mercado Livre (somente leitura)." : (at.mensagem || ""),
    };
    // Aviso de disponibilidade (worker desligado, fora do piloto, cooldown):
    // aparece em qualquer estado, nunca "finge" que iniciou.
    var aviso = !at.disponivel && at.motivo && at.motivo !== "EM_ANDAMENTO"
      ? at.mensagem + (at.cooldownRestanteMinutos ? " (" + at.cooldownRestanteMinutos + " min)" : "")
      : "";

    if (!sync) {
      return { estado: "sem_conta_ml", tom: "danger", titulo: at.mensagem || "A conta não tem conexão do Mercado Livre vinculada.",
        detalhe: "", conta: conta, progresso: null, acompanhar: false, botao: botao };
    }

    var snapshotTxt = sync.hasSnapshot
      ? "Leitura de " + dataTexto(sync.snapshotAt, formatDate) + (idadeTexto(sync.ageMinutes) ? " (" + idadeTexto(sync.ageMinutes) + ")" : "")
      : "";

    if (sync.activeRun) {
      var p = progressoDoRun(sync);
      botao.habilitado = false;
      botao.rotulo = "Atualizando…";
      botao.titulo = "Atualização desta conta em andamento.";
      return {
        estado: "sincronizando", tom: "info",
        titulo: "Atualizando as promoções desta conta",
        detalhe: [textoDoProgresso(p), sync.hasSnapshot ? snapshotTxt + " continua exibida até terminar." : ""].filter(Boolean).join(" · "),
        conta: conta, progresso: p, acompanhar: true, botao: botao,
      };
    }

    if (sync.state === "failed") {
      if (botao.habilitado) botao.rotulo = "Tentar de novo";
      return {
        estado: "falhou", tom: "danger",
        titulo: "A última atualização falhou: " + textoDaFalha(u),
        detalhe: [sync.hasSnapshot
          ? snapshotTxt + " — dados ANTIGOS: a lista abaixo é a última leitura válida, não a de agora."
          : "Nenhuma leitura válida desta conta ainda.", aviso].filter(Boolean).join(" · "),
        conta: conta, progresso: null, acompanhar: false, botao: botao,
      };
    }

    if (!sync.hasSnapshot) {
      if (botao.habilitado) botao.rotulo = "Buscar promoções";
      return {
        estado: "sem_leitura", tom: "warning",
        titulo: "Ainda não existe leitura de promoções desta conta.",
        detalhe: aviso, conta: conta, progresso: null, acompanhar: false, botao: botao,
      };
    }

    var partes = [];
    if (sync.partial) partes.push("parcial" + (sync.itemsWithoutRead ? ": " + inteiro(sync.itemsWithoutRead) + " anúncios sem leitura" : "") +
      (sync.itemsInherited ? " (" + inteiro(sync.itemsInherited) + " com a leitura anterior)" : ""));
    if (u && u.status !== "failed" && textoDoResultado(u)) partes.push(textoDoResultado(u));
    if (aviso) partes.push(aviso);

    if (sync.snapshotState === "stale") {
      return {
        estado: "desatualizado", tom: "warning",
        titulo: snapshotTxt + " — desatualizada",
        detalhe: partes.join(" · "), conta: conta, progresso: null, acompanhar: false, botao: botao,
      };
    }
    return {
      estado: "atualizado", tom: "ok",
      titulo: "Atualizada · " + snapshotTxt,
      detalhe: partes.join(" · "), conta: conta, progresso: null, acompanhar: false, botao: botao,
    };
  }

  /** Mensagem da resposta do POST /promocoes/sync (o que aconteceu com o pedido). */
  function resultadoDoPedido(r) {
    if (!r) return { iniciou: false, texto: "Não foi possível pedir a atualização." };
    if (r.ok === false) return { iniciou: false, texto: r.error || "Não foi possível pedir a atualização." };
    if (r.enfileirado) return { iniciou: true, texto: "Atualização pedida. Acompanhe o progresso aqui." };
    if (r.reaproveitado) return { iniciou: true, texto: "Já havia uma atualização desta conta em andamento; acompanhando a mesma." };
    return { iniciou: false, texto: (r.mensagem || "Atualização não iniciada.") + (r.cooldownRestanteMinutos ? " (" + r.cooldownRestanteMinutos + " min)" : "") };
  }

  /**
   * O run que a barra acompanhava terminou? (havia run ativo e agora não há.)
   * Usado para recarregar a lista e os indicadores da conta.
   */
  function terminou(anterior, atual) {
    var antes = anterior && anterior.sync && anterior.sync.activeRun;
    var agora = atual && atual.sync && atual.sync.activeRun;
    return Boolean(antes && !agora);
  }

  return {
    modelo: modelo,
    resultadoDoPedido: resultadoDoPedido,
    terminou: terminou,
    progressoDoRun: progressoDoRun,
    idadeTexto: idadeTexto,
  };
});
