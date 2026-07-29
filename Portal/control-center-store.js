/*
 * Control Center — estado, sincronização com a query string, ponte com o
 * coletor local e utilitários de formatação/escape.
 *
 * O estado vive aqui para que renderers sejam funções puras de (state) → HTML.
 */
(function () {
  "use strict";

  var VIEWS = ["overview", "requests", "errors", "browser", "health", "routes", "tools"];
  var WINDOWS = ["15m", "1h", "6h", "24h", "7d"];
  var MARKS_KEY = "vf-cc-marcacoes";
  var PREFS_KEY = "vf-cc-prefs";

  var state = {
    view: "overview",
    window: "1h",
    autoRefresh: true,
    refreshMs: 7000,
    pausadoPorAba: false,

    carregando: {},
    falhas: {},

    resumo: null,
    requests: { linhas: [], total: 0, page: 1, totalPages: 1, slowMs: 1000 },
    filtros: {
      search: "",
      method: "",
      status: "",
      source: "",
      route: "",
      screen: "",
      user: "",
      sessionId: "",
      onlyErrors: false,
      onlySlow: false,
      sortBy: "created_at",
      sortDir: "desc",
      limit: 50,
      page: 1
    },
    erros: { grupos: [], total: 0 },
    saude: null,
    testesSaude: null,
    rotas: null,
    rotasStats: [],
    sessoes: [],

    local: { eventos: [], stats: null, runtime: null, disponivel: false },

    selecionado: null,
    abaDetalhe: "resumo",
    detalheCarregando: false,
    detalheErro: null,

    backendOk: null,
    backendErro: null,
    ultimaAtualizacao: null,
    aviso: null,
    ferramentas: { testes: null, relatorio: null, sessao: null }
  };

  var ouvintes = [];

  function subscribe(fn) {
    if (typeof fn !== "function") return function () {};
    ouvintes.push(fn);
    return function () {
      var i = ouvintes.indexOf(fn);
      if (i !== -1) ouvintes.splice(i, 1);
    };
  }

  function emit() {
    for (var i = 0; i < ouvintes.length; i++) {
      try { ouvintes[i](state); } catch (e) { console.warn("[control-center] listener falhou", e); }
    }
  }

  function set(patch) {
    Object.assign(state, patch || {});
    emit();
  }

  function setFiltros(patch, opcoes) {
    Object.assign(state.filtros, patch || {});
    if (!opcoes || opcoes.mantemPagina !== true) state.filtros.page = 1;
    emit();
  }

  function marcarCarregando(chave, ativo) {
    state.carregando[chave] = !!ativo;
    emit();
  }

  function marcarFalha(chave, falha) {
    if (falha) state.falhas[chave] = falha;
    else delete state.falhas[chave];
    emit();
  }

  /* ============================================================
   * QUERY STRING
   * ============================================================ */

  var CAMPOS_URL = ["search", "method", "status", "source", "route", "screen", "user", "sessionId", "sortBy", "sortDir", "limit", "page"];

  function lerUrl() {
    var params = new URLSearchParams(window.location.search || "");
    var view = params.get("view");
    if (VIEWS.indexOf(view) !== -1) state.view = view;

    var janela = params.get("window");
    if (WINDOWS.indexOf(janela) !== -1) state.window = janela;

    CAMPOS_URL.forEach(function (campo) {
      var valor = params.get(campo);
      if (valor === null) return;
      if (campo === "limit" || campo === "page") {
        var numero = parseInt(valor, 10);
        if (Number.isFinite(numero) && numero > 0) state.filtros[campo] = numero;
        return;
      }
      state.filtros[campo] = valor;
    });

    state.filtros.onlyErrors = params.get("onlyErrors") === "1";
    state.filtros.onlySlow = params.get("onlySlow") === "1";

    var req = params.get("requestId");
    if (req) state.selecionado = { requestId: req, detalhe: null };

    var prefs = lerPrefs();
    if (typeof prefs.autoRefresh === "boolean") state.autoRefresh = prefs.autoRefresh;
    if (typeof prefs.refreshMs === "number") state.refreshMs = prefs.refreshMs;
  }

  function escreverUrl(substituir) {
    var params = new URLSearchParams();
    params.set("view", state.view);
    params.set("window", state.window);

    CAMPOS_URL.forEach(function (campo) {
      var valor = state.filtros[campo];
      if (valor === "" || valor === null || valor === undefined) return;
      if (campo === "page" && valor === 1) return;
      if (campo === "limit" && valor === 50) return;
      if (campo === "sortBy" && valor === "created_at") return;
      if (campo === "sortDir" && valor === "desc") return;
      params.set(campo, String(valor));
    });

    if (state.filtros.onlyErrors) params.set("onlyErrors", "1");
    if (state.filtros.onlySlow) params.set("onlySlow", "1");
    if (state.selecionado && state.selecionado.requestId) params.set("requestId", state.selecionado.requestId);

    var url = window.location.pathname + "?" + params.toString();
    try {
      if (substituir) window.history.replaceState({}, "", url);
      else window.history.pushState({}, "", url);
    } catch (e) { /* history bloqueado */ }
  }

  function lerPrefs() {
    try { return JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") || {}; } catch (e) { return {}; }
  }

  function salvarPrefs(patch) {
    var atual = lerPrefs();
    Object.assign(atual, patch || {});
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(atual)); } catch (e) { /* quota */ }
  }

  /* ============================================================
   * MARCAÇÕES LOCAIS DE ERRO (investigando / ignorado / resolvido)
   * Só no navegador do admin — não vira workflow no servidor.
   * ============================================================ */

  function lerMarcacoes() {
    try { return JSON.parse(localStorage.getItem(MARKS_KEY) || "{}") || {}; } catch (e) { return {}; }
  }

  function marcarErro(assinatura, situacao) {
    var marcas = lerMarcacoes();
    if (!situacao || situacao === "aberto") delete marcas[assinatura];
    else marcas[assinatura] = { situacao: situacao, em: new Date().toISOString() };
    try { localStorage.setItem(MARKS_KEY, JSON.stringify(marcas)); } catch (e) { /* quota */ }
    emit();
    return marcas;
  }

  /* ============================================================
   * PONTE COM O COLETOR LOCAL
   * ============================================================ */

  function coletor() {
    return window.VFDebugClient || null;
  }

  function carregarLocal() {
    var cliente = coletor();
    if (!cliente) {
      state.local = { eventos: [], stats: null, runtime: null, disponivel: false };
      emit();
      return Promise.resolve(state.local);
    }

    return Promise.all([
      cliente.getEvents({ limit: 300 }),
      cliente.getStats()
    ]).then(function (resultados) {
      state.local = {
        eventos: resultados[0] || [],
        stats: resultados[1] || null,
        runtime: cliente.getRuntimeInfo(),
        disponivel: true
      };
      emit();
      return state.local;
    }).catch(function (erro) {
      state.local = {
        eventos: [],
        stats: null,
        runtime: cliente.getRuntimeInfo ? cliente.getRuntimeInfo() : null,
        disponivel: false,
        erro: erro && erro.message ? erro.message : "falha ao ler o armazenamento local"
      };
      emit();
      return state.local;
    });
  }

  /* ============================================================
   * FORMATAÇÃO E ESCAPE
   * ============================================================ */

  function escapeHtml(valor) {
    return String(valor === null || valor === undefined ? "" : valor)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function attr(valor) {
    return escapeHtml(valor);
  }

  function formatarHora(valor) {
    if (!valor) return "—";
    var data = new Date(valor);
    if (Number.isNaN(data.getTime())) return "—";
    return [
      String(data.getHours()).padStart(2, "0"),
      String(data.getMinutes()).padStart(2, "0"),
      String(data.getSeconds()).padStart(2, "0")
    ].join(":");
  }

  function formatarDataHora(valor) {
    if (!valor) return "—";
    var data = new Date(valor);
    if (Number.isNaN(data.getTime())) return "—";
    return data.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "medium" });
  }

  function formatarRelativo(valor) {
    if (!valor) return "—";
    var data = new Date(valor);
    if (Number.isNaN(data.getTime())) return "—";
    var segundos = Math.round((Date.now() - data.getTime()) / 1000);
    if (segundos < 5) return "agora";
    if (segundos < 60) return "há " + segundos + "s";
    if (segundos < 3600) return "há " + Math.round(segundos / 60) + "min";
    if (segundos < 86400) return "há " + Math.round(segundos / 3600) + "h";
    return "há " + Math.round(segundos / 86400) + "d";
  }

  function formatarDuracao(ms) {
    if (ms === null || ms === undefined || ms === "") return "—";
    var numero = Number(ms);
    if (!Number.isFinite(numero)) return "—";
    if (numero < 1000) return Math.round(numero) + "ms";
    return (numero / 1000).toFixed(numero < 10000 ? 2 : 1) + "s";
  }

  function formatarNumero(valor) {
    if (valor === null || valor === undefined || valor === "") return "—";
    var numero = Number(valor);
    if (!Number.isFinite(numero)) return "—";
    return numero.toLocaleString("pt-BR");
  }

  function formatarBytes(valor) {
    var numero = Number(valor);
    if (!Number.isFinite(numero) || numero <= 0) return "—";
    if (numero < 1024) return numero + " B";
    if (numero < 1048576) return (numero / 1024).toFixed(1) + " KB";
    return (numero / 1048576).toFixed(2) + " MB";
  }

  function classeStatus(status) {
    var numero = Number(status);
    if (!numero) return "is-network";
    if (numero >= 500) return "is-danger";
    if (numero >= 400) return "is-warning";
    if (numero >= 300) return "is-info";
    return "is-success";
  }

  function rotuloStatus(status) {
    var numero = Number(status);
    return numero ? String(numero) : "NET";
  }

  function formatarJson(valor) {
    try {
      return JSON.stringify(valor, null, 2);
    } catch (e) {
      return String(valor);
    }
  }

  function copiar(texto) {
    var conteudo = String(texto === null || texto === undefined ? "" : texto);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(conteudo).then(function () { return true; })
        .catch(function () { return copiarFallback(conteudo); });
    }
    return Promise.resolve(copiarFallback(conteudo));
  }

  function copiarFallback(conteudo) {
    try {
      var area = document.createElement("textarea");
      area.value = conteudo;
      area.setAttribute("readonly", "readonly");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      var ok = document.execCommand("copy");
      document.body.removeChild(area);
      return ok;
    } catch (e) {
      return false;
    }
  }

  /** curl sanitizado: nunca imprime o Authorization real. */
  function montarCurl(detalhe) {
    if (!detalhe) return "";
    var servidor = detalhe.servidor || {};
    var evento = detalhe.eventoPrincipal || {};
    var metodo = servidor.method || evento.method || "GET";
    var caminho = (servidor.metadata && servidor.metadata.url) || evento.endpoint || servidor.path || "/";
    var base = (window.VFCApi && window.VFCApi.apiBase()) || "";
    var url = /^https?:/i.test(caminho) ? caminho : base + caminho;
    return [
      "curl -X " + metodo + " '" + url + "' \\",
      "  -H 'Authorization: Bearer $VF_TOKEN' \\",
      "  -H 'Content-Type: application/json' \\",
      "  -H 'X-Request-Id: " + (detalhe.requestId || "") + "'",
      "# $VF_TOKEN não é impresso pelo Control Center — exporte a variável você mesmo."
    ].join("\n");
  }

  function decodificarJwt() {
    var jwt = window.VFCApi ? window.VFCApi.token() : "";
    if (!jwt) return { presente: false };
    var partes = jwt.split(".");
    if (partes.length !== 3) return { presente: true, decodificavel: false };
    try {
      var payload = JSON.parse(atob(partes[1].replace(/-/g, "+").replace(/_/g, "/")));
      return {
        presente: true,
        decodificavel: true,
        // Nem o token nem a assinatura são expostos — só as claims de controle.
        expiraEm: payload.exp ? new Date(payload.exp * 1000).toISOString() : null,
        emitidoEm: payload.iat ? new Date(payload.iat * 1000).toISOString() : null,
        expirado: payload.exp ? payload.exp * 1000 < Date.now() : null,
        id: payload.id !== undefined ? payload.id : null
      };
    } catch (e) {
      return { presente: true, decodificavel: false };
    }
  }

  window.VFCStore = {
    VIEWS: VIEWS,
    WINDOWS: WINDOWS,
    state: state,
    subscribe: subscribe,
    emit: emit,
    set: set,
    setFiltros: setFiltros,
    marcarCarregando: marcarCarregando,
    marcarFalha: marcarFalha,
    lerUrl: lerUrl,
    escreverUrl: escreverUrl,
    lerPrefs: lerPrefs,
    salvarPrefs: salvarPrefs,
    lerMarcacoes: lerMarcacoes,
    marcarErro: marcarErro,
    coletor: coletor,
    carregarLocal: carregarLocal,
    escapeHtml: escapeHtml,
    attr: attr,
    formatarHora: formatarHora,
    formatarDataHora: formatarDataHora,
    formatarRelativo: formatarRelativo,
    formatarDuracao: formatarDuracao,
    formatarNumero: formatarNumero,
    formatarBytes: formatarBytes,
    classeStatus: classeStatus,
    rotuloStatus: rotuloStatus,
    formatarJson: formatarJson,
    copiar: copiar,
    montarCurl: montarCurl,
    decodificarJwt: decodificarJwt
  };
})();
