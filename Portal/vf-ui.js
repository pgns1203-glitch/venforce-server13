/* Portal/vf-ui.js — comportamento compartilhado das telas vanilla do Portal.
 *
 * O visual já existe na Fundação V2 (.vf-overlay/.vf-modal, .vf-toast); o que
 * faltava era UM jeito de usar, em vez de cada página ter o seu toast e de
 * várias ainda usarem o confirm()/alert() do navegador — que congela a página
 * inteira, não diz de qual registro se trata com destaque e não segue o
 * visual do Portal.
 *
 *   VF.confirm({ title, message, confirmLabel, cancelLabel, tone }) → Promise<boolean>
 *   VF.toast({ title, description, tone, duration })                → elemento
 *
 * Script clássico (não módulo): carregue com <script src="vf-ui.js"></script>
 * antes do script da página. Não depende de nada. Expõe em window.VF sem
 * apagar o que o vf-shell.js já colocou lá.
 *
 * Quem chama deve aceitar a ausência deste arquivo (página que ainda não o
 * carrega, teste em sandbox): `window.VF && VF.confirm ? VF.confirm(...) :
 * Promise.resolve(window.confirm(msg))`.
 */
(function (global) {
  "use strict";

  var doc = global.document;
  if (!doc) return;
  var VF = (global.VF = global.VF || {});

  var FOCAVEIS = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  var SAIDA_MS = 220; // um pouco acima de --vf-duration (0.18s)
  var seq = 0;

  function el(tag, cls, texto) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (texto != null) n.textContent = texto;
    return n;
  }

  function reduzMovimento() {
    try {
      return !!(global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches);
    } catch (e) {
      return false;
    }
  }

  /* ── Confirmação ─────────────────────────────────────────────────────── */

  /**
   * @param {string | {title?: string, message?: string, confirmLabel?: string, cancelLabel?: string, tone?: "primary" | "danger"}} opcoes
   * @returns {Promise<boolean>}
   */
  VF.confirm = function confirmar(opcoes) {
    var o = typeof opcoes === "string" ? { message: opcoes } : opcoes || {};
    var perigo = o.tone === "danger";
    var id = "vf-confirm-" + ++seq;

    return new Promise(function (resolver) {
      var origem = doc.activeElement;
      var overlay = el("div", "vf-overlay");
      overlay.setAttribute("role", "presentation");

      var modal = el("div", "vf-modal vf-modal--sm");
      modal.setAttribute("role", "alertdialog");
      modal.setAttribute("aria-modal", "true");
      modal.setAttribute("aria-labelledby", id + "-t");
      if (o.message) modal.setAttribute("aria-describedby", id + "-d");

      var cab = el("div", "vf-modal__header");
      var titulo = el("h2", "vf-modal__title", o.title || "Confirmar ação");
      titulo.id = id + "-t";
      cab.appendChild(titulo);

      var corpo = el("div", "vf-modal__body");
      if (o.message) {
        var msg = el("p", "vf-modal__message", o.message);
        msg.id = id + "-d";
        corpo.appendChild(msg);
      }

      var rodape = el("div", "vf-modal__footer");
      var cancelar = el("button", "vf-btn vf-btn--ghost", o.cancelLabel || "Cancelar");
      cancelar.type = "button";
      var confirmar = el("button", "vf-btn " + (perigo ? "vf-btn--danger" : "vf-btn--primary"), o.confirmLabel || "Confirmar");
      confirmar.type = "button";
      rodape.appendChild(cancelar);
      rodape.appendChild(confirmar);

      modal.appendChild(cab);
      modal.appendChild(corpo);
      modal.appendChild(rodape);
      overlay.appendChild(modal);
      doc.body.appendChild(overlay);
      doc.body.classList.add("vf-no-scroll");

      // Entrada: nasce fechado e abre no próximo quadro, para a transição da V2 rodar.
      void overlay.offsetWidth;
      overlay.classList.add("is-open");
      // Ação destrutiva começa no Cancelar: Enter por reflexo não apaga nada.
      (perigo ? cancelar : confirmar).focus();

      var encerrado = false;
      function encerrar(resposta) {
        if (encerrado) return;
        encerrado = true;
        doc.removeEventListener("keydown", aoTeclar, true);
        overlay.classList.remove("is-open");
        var remover = function () {
          if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
          if (!doc.querySelector(".vf-overlay.is-open")) doc.body.classList.remove("vf-no-scroll");
        };
        if (reduzMovimento()) remover();
        else global.setTimeout(remover, SAIDA_MS);
        if (origem && typeof origem.focus === "function" && doc.contains(origem)) origem.focus();
        resolver(resposta);
      }

      function aoTeclar(evento) {
        if (evento.key === "Escape") {
          evento.preventDefault();
          evento.stopPropagation();
          encerrar(false);
          return;
        }
        if (evento.key !== "Tab") return;
        var focaveis = Array.prototype.slice.call(modal.querySelectorAll(FOCAVEIS));
        if (!focaveis.length) return;
        var primeiro = focaveis[0];
        var ultimo = focaveis[focaveis.length - 1];
        if (evento.shiftKey && doc.activeElement === primeiro) {
          evento.preventDefault();
          ultimo.focus();
        } else if (!evento.shiftKey && doc.activeElement === ultimo) {
          evento.preventDefault();
          primeiro.focus();
        } else if (!modal.contains(doc.activeElement)) {
          evento.preventDefault();
          primeiro.focus();
        }
      }

      doc.addEventListener("keydown", aoTeclar, true);
      cancelar.addEventListener("click", function () { encerrar(false); });
      confirmar.addEventListener("click", function () { encerrar(true); });
      overlay.addEventListener("mousedown", function (evento) {
        if (evento.target === overlay) encerrar(false);
      });
    });
  };

  /* ── Toast ───────────────────────────────────────────────────────────── */

  function pilha() {
    var p = doc.getElementById("vf-toast-stack");
    if (!p) {
      p = el("div", "vf-toast-stack");
      p.id = "vf-toast-stack";
      p.setAttribute("aria-live", "polite");
      doc.body.appendChild(p);
    }
    return p;
  }

  /**
   * @param {string | {title?: string, description?: string, tone?: "info" | "success" | "warning" | "danger", duration?: number}} opcoes
   * @returns {HTMLElement}
   */
  VF.toast = function toast(opcoes) {
    var o = typeof opcoes === "string" ? { title: opcoes } : opcoes || {};
    var tom = o.tone || "info";
    var duracao = o.duration == null ? (tom === "danger" ? 7000 : 4500) : o.duration;

    var t = el("div", "vf-toast is-" + tom);
    t.setAttribute("role", tom === "danger" ? "alert" : "status");
    var conteudo = el("div", "vf-toast__content");
    if (o.title) conteudo.appendChild(el("p", "vf-toast__title", o.title));
    if (o.description) conteudo.appendChild(el("p", "vf-toast__description", o.description));
    var fechar = el("button", "vf-toast__close", "✕");
    fechar.type = "button";
    fechar.setAttribute("aria-label", "Fechar notificação");
    t.appendChild(conteudo);
    t.appendChild(fechar);

    var timer = null;
    function sair() {
      global.clearTimeout(timer);
      if (t.parentNode) t.parentNode.removeChild(t);
    }
    fechar.addEventListener("click", sair);
    pilha().appendChild(t);
    if (duracao > 0) timer = global.setTimeout(sair, duracao);
    return t;
  };
})(typeof window !== "undefined" ? window : this);
