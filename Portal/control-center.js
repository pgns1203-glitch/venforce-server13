/*
 * Control Center — orquestração: rotas internas por query string, carregamento
 * com AbortController, auto refresh pausável e delegação de eventos.
 *
 * Nenhum dado exibido aqui é inventado: quando o servidor não responde, a tela
 * diz exatamente o que faltou em vez de preencher com mock.
 */
(function () {
  "use strict";

  var S = window.VFCStore;
  var R = window.VFCRenderers;
  var API = window.VFCApi;

  if (typeof window.initLayout === "function") window.initLayout();

  var els = {};
  var controllers = {};
  var refreshTimer = null;
  var buscaTimer = null;
  var localTimer = null;
  var ultimoGatilho = null;
  var desinscreverColetor = null;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  function init() {
    els.statusbar = document.getElementById("cc-statusbar");
    els.aviso = document.getElementById("cc-aviso");
    els.abas = document.getElementById("cc-abas");
    els.janela = document.getElementById("cc-janela");
    els.view = document.getElementById("cc-view");
    els.drawer = document.getElementById("cc-drawer");
    els.backdrop = document.getElementById("cc-drawer-backdrop");
    els.modalPurge = document.getElementById("cc-modal-purge");
    els.toasts = document.getElementById("cc-toasts");

    if (!els.view) return;

    S.lerUrl();
    S.subscribe(render);
    ligarEventos();
    ligarColetor();
    S.escreverUrl(true);

    render();
    atualizar("inicial");
    iniciarAutoRefresh();

    if (S.state.selecionado && S.state.selecionado.requestId) {
      abrirDetalhe(S.state.selecionado.requestId);
    }
  }

  /* ============================================================
   * RENDER
   * ============================================================ */

  var renderAgendado = false;

  function render() {
    if (renderAgendado) return;
    renderAgendado = true;
    requestAnimationFrame(function () {
      renderAgendado = false;
      renderAgora();
    });
  }

  function renderAgora() {
    var state = S.state;

    els.statusbar.innerHTML = R.statusBar(state);
    els.abas.innerHTML = R.abas(state);
    els.janela.innerHTML = R.seletorJanela(state);
    els.aviso.innerHTML = state.aviso || "";

    var focoAntes = document.activeElement;
    var seletorFoco = focoAntes && focoAntes.dataset && focoAntes.dataset.ccInput
      ? '[data-cc-input="' + focoAntes.dataset.ccInput + '"]'
      : null;
    var selecaoAntes = seletorFoco && focoAntes.selectionStart !== undefined
      ? focoAntes.selectionStart : null;

    els.view.setAttribute("aria-busy", state.carregando[state.view] ? "true" : "false");
    els.view.innerHTML = conteudoDaView(state);

    if (seletorFoco) {
      var novoFoco = els.view.querySelector(seletorFoco);
      if (novoFoco) {
        novoFoco.focus();
        if (selecaoAntes !== null && novoFoco.setSelectionRange) {
          try { novoFoco.setSelectionRange(selecaoAntes, selecaoAntes); } catch (e) { /* input sem seleção */ }
        }
      }
    }

    renderDrawer();
  }

  function conteudoDaView(state) {
    if (!API.isAdmin()) {
      return R.falha({
        tipo: "sem-permissao",
        erro: "Esta área é restrita a administradores."
      }, "acesso");
    }
    switch (state.view) {
      case "requests": return R.requests(state);
      case "errors": return R.errors(state);
      case "browser": return R.browser(state);
      case "health": return R.health(state);
      case "routes": return R.routes(state);
      case "tools": return R.tools(state);
      default: return R.overview(state);
    }
  }

  function renderDrawer() {
    var aberto = !!S.state.selecionado;
    els.drawer.hidden = !aberto;
    els.backdrop.hidden = !aberto;
    els.drawer.classList.toggle("is-open", aberto);
    els.backdrop.classList.toggle("is-open", aberto);
    els.drawer.setAttribute("aria-modal", aberto ? "true" : "false");
    els.drawer.innerHTML = aberto ? R.drawer(S.state) : "";
  }

  /* ============================================================
   * CARREGAMENTO
   * ============================================================ */

  function novoSinal(chave) {
    if (controllers[chave]) controllers[chave].abort();
    controllers[chave] = new AbortController();
    return controllers[chave].signal;
  }

  function tratar(chave, resposta) {
    if (resposta.abortado) return null;
    if (resposta.ok) {
      S.state.backendOk = true;
      S.state.backendErro = null;
      S.marcarFalha(chave, null);
      return resposta.dados;
    }
    if (resposta.tipo === "offline" || resposta.tipo === "banco-indisponivel") {
      S.state.backendOk = false;
      S.state.backendErro = resposta.erro;
    } else {
      S.state.backendOk = true;
    }
    S.marcarFalha(chave, resposta);
    return null;
  }

  function carregarResumo() {
    S.marcarCarregando("resumo", true);
    return API.summary({ window: S.state.window }, novoSinal("resumo")).then(function (resposta) {
      var dados = tratar("resumo", resposta);
      if (dados) S.state.resumo = dados.resumo;
      S.marcarCarregando("resumo", false);
    });
  }

  function carregarRequests() {
    var f = S.state.filtros;
    S.marcarCarregando("requests", true);
    return API.requests({
      window: S.state.window,
      search: f.search,
      method: f.method,
      status: f.status,
      source: f.source,
      route: f.route,
      screen: f.screen,
      user: f.user,
      sessionId: f.sessionId,
      onlyErrors: f.onlyErrors ? "1" : "",
      onlySlow: f.onlySlow ? "1" : "",
      sortBy: f.sortBy,
      sortDir: f.sortDir,
      limit: f.limit,
      page: f.page
    }, novoSinal("requests")).then(function (resposta) {
      var dados = tratar("requests", resposta);
      if (dados) {
        S.state.requests = {
          linhas: dados.requests || [],
          total: dados.total || 0,
          page: dados.page || 1,
          totalPages: dados.totalPages || 1,
          slowMs: dados.slowMs || 1000
        };
      }
      S.marcarCarregando("requests", false);
    });
  }

  function carregarErros() {
    S.marcarCarregando("erros", true);
    return API.errors({ window: S.state.window }, novoSinal("erros")).then(function (resposta) {
      var dados = tratar("erros", resposta);
      if (dados) S.state.erros = { grupos: dados.grupos || [], total: dados.total || 0 };
      S.marcarCarregando("erros", false);
    });
  }

  function carregarSaude() {
    S.marcarCarregando("saude", true);
    return API.health(novoSinal("saude")).then(function (resposta) {
      var dados = tratar("saude", resposta);
      if (dados) S.state.saude = dados.saude;
      S.marcarCarregando("saude", false);
    });
  }

  function carregarRotas() {
    S.marcarCarregando("rotas", true);
    return API.routes(novoSinal("rotas")).then(function (resposta) {
      if (resposta.abortado) return;
      // O endpoint devolve ok:false quando a introspecção falha — isso é um
      // resultado legítimo, não um erro de transporte.
      if (resposta.dados && resposta.dados.rotas !== undefined) {
        S.state.rotas = resposta.dados;
        S.marcarFalha("rotas", null);
        S.state.backendOk = true;
      } else {
        tratar("rotas", resposta);
      }
      S.marcarCarregando("rotas", false);
    });
  }

  function carregarRotasStats() {
    return API.routeStats({ window: S.state.window }, novoSinal("rotasStats")).then(function (resposta) {
      if (resposta.ok) S.state.rotasStats = resposta.dados.estatisticas || [];
      S.emit();
    });
  }

  function carregarSessoes() {
    return API.sessions({ window: S.state.window }, novoSinal("sessoes")).then(function (resposta) {
      if (resposta.ok) S.state.sessoes = resposta.dados.sessoes || [];
      S.emit();
    });
  }

  /**
   * @param {"inicial"|"manual"|"auto"|"view"} motivo
   */
  function atualizar(motivo) {
    if (!API.isAdmin()) {
      render();
      return Promise.resolve();
    }

    var view = S.state.view;
    var tarefas = [];

    var precisaSaude = motivo === "inicial" || motivo === "manual" || view === "health" || view === "tools" || !S.state.saude;
    if (precisaSaude) tarefas.push(carregarSaude());

    if (view === "overview") tarefas.push(carregarResumo(), carregarErros());
    if (view === "requests") tarefas.push(carregarRequests());
    if (view === "errors") tarefas.push(carregarErros());
    if (view === "browser") tarefas.push(S.carregarLocal(), carregarSessoes());
    if (view === "routes") {
      if (!S.state.rotas || motivo === "manual") tarefas.push(carregarRotas());
      tarefas.push(carregarRotasStats());
    }
    if (view === "tools" || view === "overview") tarefas.push(S.carregarLocal());

    if (!tarefas.length) tarefas.push(Promise.resolve());

    return Promise.all(tarefas).then(function () {
      S.set({ ultimaAtualizacao: new Date().toISOString() });
    });
  }

  function iniciarAutoRefresh() {
    pararAutoRefresh();
    refreshTimer = setInterval(function () {
      if (!S.state.autoRefresh) return;
      if (document.hidden) {
        if (!S.state.pausadoPorAba) S.set({ pausadoPorAba: true });
        return;
      }
      if (S.state.pausadoPorAba) S.set({ pausadoPorAba: false });
      atualizar("auto");
    }, S.state.refreshMs);
  }

  function pararAutoRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = null;
  }

  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && S.state.autoRefresh) {
      S.set({ pausadoPorAba: false });
      atualizar("auto");
    }
  });

  /* ============================================================
   * COLETOR LOCAL
   * ============================================================ */

  function ligarColetor() {
    var cliente = S.coletor();
    if (!cliente) return;

    S.carregarLocal();

    if (desinscreverColetor) desinscreverColetor();
    desinscreverColetor = cliente.subscribe(function () {
      // Eventos podem chegar em rajada (uma tela dispara várias requests).
      if (localTimer) clearTimeout(localTimer);
      localTimer = setTimeout(function () {
        localTimer = null;
        S.carregarLocal();
      }, 250);
    });
  }

  /* ============================================================
   * EVENTOS
   * ============================================================ */

  function ligarEventos() {
    document.addEventListener("click", aoClicar);
    document.addEventListener("input", aoDigitar);
    document.addEventListener("change", aoMudar);
    document.addEventListener("keydown", aoTeclar);
    window.addEventListener("popstate", function () {
      S.lerUrl();
      render();
      atualizar("view");
    });
  }

  function aoClicar(evento) {
    if (!evento.target || typeof evento.target.closest !== "function") return;
    var alvo = evento.target.closest("[data-cc-view],[data-cc-window],[data-cc-status],[data-cc-toggle],[data-cc-sort],[data-cc-page],[data-cc-request],[data-cc-detail-tab],[data-cc-mark],[data-cc-health-check],[data-cc-action]");
    if (!alvo) {
      if (evento.target === els.backdrop) fecharDetalhe();
      return;
    }
    if (alvo.tagName === "A") return;

    var d = alvo.dataset;

    if (d.ccView) {
      evento.preventDefault();
      trocarView(d.ccView);
      return;
    }
    if (d.ccWindow) {
      S.set({ window: d.ccWindow });
      S.escreverUrl(true);
      atualizar("view");
      return;
    }
    if (d.ccStatus !== undefined && !d.ccAction) {
      S.setFiltros({ status: d.ccStatus });
      S.escreverUrl(true);
      carregarRequests();
      return;
    }
    if (d.ccToggle) {
      var patch = {};
      patch[d.ccToggle] = !S.state.filtros[d.ccToggle];
      S.setFiltros(patch);
      S.escreverUrl(true);
      carregarRequests();
      return;
    }
    if (d.ccSort) {
      var mesmaColuna = S.state.filtros.sortBy === d.ccSort;
      S.setFiltros({
        sortBy: d.ccSort,
        sortDir: mesmaColuna && S.state.filtros.sortDir === "desc" ? "asc" : "desc"
      });
      S.escreverUrl(true);
      carregarRequests();
      return;
    }
    if (d.ccPage) {
      var pagina = parseInt(d.ccPage, 10);
      if (!Number.isFinite(pagina) || pagina < 1 || pagina > S.state.requests.totalPages) return;
      S.setFiltros({ page: pagina }, { mantemPagina: true });
      S.escreverUrl(true);
      carregarRequests();
      return;
    }
    if (d.ccRequest) {
      ultimoGatilho = alvo;
      abrirDetalhe(d.ccRequest);
      return;
    }
    if (d.ccDetailTab) {
      S.set({ abaDetalhe: d.ccDetailTab });
      return;
    }
    if (d.ccMark) {
      var marcas = S.lerMarcacoes();
      var atual = marcas[d.ccMark];
      S.marcarErro(d.ccMark, atual && atual.situacao === d.ccMarkState ? null : d.ccMarkState);
      return;
    }
    if (d.ccHealthCheck) {
      rodarTesteSaude(d.ccHealthCheck);
      return;
    }
    if (d.ccAction) {
      executarAcao(d.ccAction, d.ccValue, alvo);
    }
  }

  function aoDigitar(evento) {
    if (!evento.target || typeof evento.target.closest !== "function") return;
    var campo = evento.target.closest("[data-cc-input]");
    if (!campo) return;
    var nome = campo.dataset.ccInput;
    if (nome !== "search" && nome !== "route" && nome !== "user") return;

    var valor = campo.value;
    if (buscaTimer) clearTimeout(buscaTimer);
    buscaTimer = setTimeout(function () {
      buscaTimer = null;
      var patch = {};
      patch[nome] = valor;
      S.setFiltros(patch);
      S.escreverUrl(true);
      if (S.state.view === "requests") carregarRequests();
    }, 320);
  }

  function aoMudar(evento) {
    if (!evento.target || typeof evento.target.closest !== "function") return;
    var campo = evento.target.closest("[data-cc-input]");
    if (!campo) return;
    var nome = campo.dataset.ccInput;
    var valor = campo.value;
    var patch = {};
    patch[nome] = nome === "limit" ? parseInt(valor, 10) || 50 : valor;
    S.setFiltros(patch);
    S.escreverUrl(true);
    if (S.state.view === "requests") carregarRequests();
  }

  function aoTeclar(evento) {
    if (evento.key === "Escape") {
      if (!els.modalPurge.hidden) return fecharPurge();
      if (S.state.selecionado) fecharDetalhe();
      return;
    }
    if (evento.key === "Enter" || evento.key === " ") {
      if (!evento.target || typeof evento.target.closest !== "function") return;
      var linha = evento.target.closest("tr[data-cc-request]");
      if (linha) {
        evento.preventDefault();
        ultimoGatilho = linha;
        abrirDetalhe(linha.dataset.ccRequest);
      }
    }
  }

  function trocarView(view) {
    if (S.VIEWS.indexOf(view) === -1) return;
    S.set({ view: view });
    S.escreverUrl(false);
    atualizar("view");
    if (els.view) els.view.focus();
  }

  /* ============================================================
   * DETALHE
   * ============================================================ */

  function abrirDetalhe(requestId) {
    if (!requestId) return;
    S.set({
      selecionado: { requestId: requestId, detalhe: null },
      abaDetalhe: "resumo",
      detalheCarregando: true,
      detalheErro: null
    });
    S.escreverUrl(true);

    API.requestDetail(requestId, novoSinal("detalhe")).then(function (resposta) {
      if (resposta.abortado) return;
      if (!resposta.ok) {
        S.set({ detalheCarregando: false, detalheErro: resposta });
        return;
      }
      S.set({
        selecionado: { requestId: requestId, detalhe: resposta.dados.detalhe },
        detalheCarregando: false,
        detalheErro: null
      });
      if (els.drawer) els.drawer.focus();
    });
  }

  function fecharDetalhe() {
    S.set({ selecionado: null, detalhe: null, detalheErro: null });
    S.escreverUrl(true);
    if (ultimoGatilho && document.contains(ultimoGatilho)) ultimoGatilho.focus();
  }

  /* ============================================================
   * AÇÕES
   * ============================================================ */

  function executarAcao(acao, valor, alvo) {
    var cliente = S.coletor();

    switch (acao) {
      case "reload":
        atualizar("manual").then(function () { toast("Dados atualizados."); });
        return;

      case "toggle-auto":
        S.set({ autoRefresh: !S.state.autoRefresh });
        S.salvarPrefs({ autoRefresh: S.state.autoRefresh });
        if (alvo) alvo.textContent = S.state.autoRefresh ? "Pausar auto refresh" : "Retomar auto refresh";
        toast(S.state.autoRefresh ? "Auto refresh ligado." : "Auto refresh pausado.");
        return;

      case "toggle-debug":
        if (!cliente) return toast("Coletor não carregado nesta página.", "erro");
        if (cliente.isActive()) {
          cliente.disable();
          toast("Debug do navegador desligado. Os eventos já gravados continuam disponíveis.");
        } else if (cliente.enable()) {
          toast("Debug do navegador ligado. Navegue pelo Portal para capturar requests.");
        } else {
          toast("Debug exige sessão de admin com token válido.", "erro");
        }
        S.carregarLocal();
        return;

      case "export":
        toast("Preparando exportação…");
        API.download({
          format: valor === "csv" ? "csv" : "json",
          window: S.state.window,
          search: S.state.filtros.search,
          status: S.state.filtros.status,
          source: S.state.filtros.source,
          route: S.state.filtros.route,
          onlyErrors: S.state.filtros.onlyErrors ? "1" : "",
          onlySlow: S.state.filtros.onlySlow ? "1" : "",
          limit: 5000
        }).then(function (resultado) {
          toast(resultado.ok ? "Exportação sanitizada baixada." : "Falha ao exportar: " + resultado.erro,
            resultado.ok ? "ok" : "erro");
        });
        return;

      case "clear-filters":
        S.setFiltros({
          search: "", method: "", status: "", source: "", route: "",
          screen: "", user: "", sessionId: "", onlyErrors: false, onlySlow: false
        });
        S.escreverUrl(true);
        carregarRequests();
        return;

      case "filter-route":
        S.set({ view: "requests" });
        S.setFiltros({ route: valor || "" });
        S.escreverUrl(false);
        fecharDetalheSilencioso();
        carregarRequests();
        return;

      case "filter-user":
        S.set({ view: "requests" });
        S.setFiltros({ user: valor || "" });
        S.escreverUrl(false);
        fecharDetalheSilencioso();
        carregarRequests();
        return;

      case "filter-session":
        S.set({ view: "requests" });
        S.setFiltros({ sessionId: valor || "" });
        S.escreverUrl(false);
        fecharDetalheSilencioso();
        carregarRequests();
        return;

      case "close-drawer":
        fecharDetalhe();
        return;

      case "copy-request-id":
        copiarComAviso(S.state.selecionado && S.state.selecionado.requestId, "Request id copiado.");
        return;

      case "copy-endpoint": {
        var detalhe = S.state.selecionado && S.state.selecionado.detalhe;
        var servidor = (detalhe && detalhe.servidor) || {};
        var evento = (detalhe && detalhe.eventoPrincipal) || {};
        copiarComAviso(servidor.route || servidor.path || evento.endpoint || "", "Endpoint copiado.");
        return;
      }

      case "copy-json": {
        var detalheJson = S.state.selecionado && S.state.selecionado.detalhe;
        copiarComAviso(detalheJson ? S.formatarJson(detalheJson) : "", "JSON sanitizado copiado.");
        return;
      }

      case "copy-curl":
        copiarComAviso(S.montarCurl(S.state.selecionado && S.state.selecionado.detalhe), "curl sanitizado copiado (sem token).");
        return;

      case "test-get":
        rodarTesteGet(valor);
        return;

      case "toggle-console":
        if (!cliente) return;
        cliente.setConfig({ captureConsole: !cliente.getConfig().captureConsole });
        S.carregarLocal();
        toast("Captura de console.error " + (cliente.getConfig().captureConsole ? "ligada" : "desligada") + ".");
        return;

      case "force-sync":
        if (!cliente) return;
        toast("Sincronizando…");
        cliente.sync({ force: true }).then(function (resultado) {
          S.carregarLocal();
          toast(resultado.erro ? "Sync falhou: " + resultado.erro : resultado.enviados + " eventos enviados.",
            resultado.erro ? "erro" : "ok");
        });
        return;

      case "export-local":
        if (!cliente) return;
        cliente.exportEvents().then(function (pacote) {
          baixarJson(pacote, "eventos-locais");
          toast("Eventos locais exportados (sanitizados).");
        });
        return;

      case "clear-local":
        if (!cliente) return;
        if (!window.confirm("Limpar apenas o cache local deste navegador?\n\nO histórico do servidor NÃO é afetado.")) return;
        cliente.clearLocal().then(function () {
          S.carregarLocal();
          toast("Cache local limpo. O histórico do servidor permanece intacto.");
        });
        return;

      case "test-error":
        if (!cliente) return;
        cliente.emitTestError().then(function () {
          S.carregarLocal();
          S.state.ferramentas.testes = Object.assign({}, S.state.ferramentas.testes, {
            browser: { tipo: "erro de teste", registradoEm: new Date().toISOString(), afetaProducao: false }
          });
          S.emit();
          toast("Erro de TESTE registrado. Nenhum sistema foi afetado.");
        });
        return;

      case "test-request":
        if (!cliente) return;
        cliente.runTestRequest().then(function (resultado) {
          S.carregarLocal();
          S.state.ferramentas.testes = Object.assign({}, S.state.ferramentas.testes, { browser: resultado });
          S.emit();
          toast("Teste GET /health: " + (resultado.ok ? "ok" : "falhou"), resultado.ok ? "ok" : "erro");
        });
        return;

      case "run-tests":
        rodarTestesRapidos();
        return;

      case "build-report":
        montarRelatorio();
        return;

      case "copy-report":
        copiarComAviso(S.state.ferramentas.relatorio, "Relatório copiado.");
        return;

      case "playground-run": {
        var campo = document.getElementById("cc-playground-path");
        rodarTesteGet(campo ? campo.value : "/health", "playground");
        return;
      }

      case "purge-server":
        abrirPurge();
        return;

      case "close-purge":
        fecharPurge();
        return;

      case "confirm-purge":
        confirmarPurge();
        return;

      default:
        return;
    }
  }

  function fecharDetalheSilencioso() {
    if (S.state.selecionado) S.set({ selecionado: null, detalheErro: null });
  }

  function copiarComAviso(texto, mensagem) {
    if (!texto) return toast("Nada para copiar.", "erro");
    S.copiar(texto).then(function (ok) {
      toast(ok ? mensagem : "O navegador bloqueou a cópia.", ok ? "ok" : "erro");
    });
  }

  /* ============================================================
   * TESTES
   * ============================================================ */

  function rodarTesteSaude(alvo) {
    var alvos = alvo === "todos" ? null : [alvo];
    S.marcarCarregando("teste-" + alvo, true);
    API.healthCheck(alvos).then(function (resposta) {
      S.marcarCarregando("teste-" + alvo, false);
      if (!resposta.ok) return toast("Teste falhou: " + resposta.erro, "erro");
      var anteriores = (S.state.testesSaude && S.state.testesSaude.resultados) || {};
      S.set({
        testesSaude: {
          disponiveis: resposta.dados.disponiveis,
          resultados: Object.assign({}, anteriores, resposta.dados.resultados)
        }
      });
      toast("Teste concluído.");
    });
  }

  function rodarTesteGet(caminho, destino) {
    var limpo = String(caminho || "").trim();
    if (!limpo || limpo.charAt(0) !== "/") return toast("Informe um caminho interno começando com /.", "erro");
    if (limpo.indexOf(":") !== -1) return toast("Rotas com parâmetro (:id) não podem ser reexecutadas às cegas.", "erro");

    toast("Executando GET " + limpo + "…");
    API.ping(limpo, true).then(function (resultado) {
      var chave = destino === "playground" ? "playground" : "rota";
      var testes = Object.assign({}, S.state.ferramentas.testes);
      testes[chave] = Object.assign({ caminho: limpo, metodo: "GET" }, resultado);
      S.state.ferramentas.testes = testes;
      S.state.ferramentas.caminhoTeste = limpo;
      S.emit();
      toast("GET " + limpo + " → " + (resultado.status || "sem resposta"), resultado.ok ? "ok" : "erro");
    });
  }

  function rodarTestesRapidos() {
    S.marcarCarregando("testes", true);
    var cliente = S.coletor();

    var tarefas = [
      API.ping("/health", false).then(function (r) { return Object.assign({ nome: "GET /health" }, r); }),
      API.ping("/auth/me", true).then(function (r) { return Object.assign({ nome: "GET /auth/me" }, r); }),
      API.healthCheck(["postgres"]).then(function (r) {
        var resultado = r.ok ? r.dados.resultados.postgres : null;
        return {
          nome: "PostgreSQL (SELECT 1)",
          ok: !!(resultado && resultado.resultado === "ok"),
          status: r.status,
          duracaoMs: resultado ? resultado.latenciaMs : null,
          erro: resultado ? resultado.detalhe : r.erro
        };
      }),
      API.healthCheck(["observabilidade"]).then(function (r) {
        var resultado = r.ok ? r.dados.resultados.observabilidade : null;
        return {
          nome: "Tabelas de observabilidade",
          ok: !!(resultado && resultado.resultado === "ok"),
          status: r.status,
          duracaoMs: resultado ? resultado.latenciaMs : null,
          erro: resultado ? resultado.detalhe : r.erro
        };
      }),
      API.summary({ window: "15m" }).then(function (r) {
        return { nome: "GET /admin/observability/summary", ok: r.ok, status: r.status, duracaoMs: null, erro: r.erro };
      })
    ];

    if (cliente && cliente.isActive()) {
      tarefas.push(
        cliente.record({
          eventType: "test",
          severity: "info",
          message: "Escrita e leitura de evento de teste (Ferramentas)",
          data: { teste: true, afetaProducao: false }
        }).then(function (evento) {
          if (!evento) return { nome: "Escrever evento local", ok: false, erro: "coletor não gravou" };
          return cliente.getEvents({ limit: 50 }).then(function (eventos) {
            var achou = eventos.some(function (e) { return e.eventId === evento.eventId; });
            return { nome: "Escrever + ler evento local", ok: achou, status: 0, duracaoMs: null, erro: achou ? null : "evento não relido" };
          });
        })
      );
    } else {
      tarefas.push(Promise.resolve({
        nome: "Escrever + ler evento local",
        ok: false, status: 0, erro: "coletor desligado"
      }));
    }

    Promise.all(tarefas).then(function (resultados) {
      S.marcarCarregando("testes", false);
      S.state.ferramentas.testes = Object.assign({}, S.state.ferramentas.testes, { rapidos: resultados });
      S.emit();
      var falhas = resultados.filter(function (r) { return !r.ok; }).length;
      toast(falhas ? falhas + " teste(s) falharam." : "Todos os testes passaram.", falhas ? "erro" : "ok");
    });
  }

  function montarRelatorio() {
    var detalhe = S.state.selecionado && S.state.selecionado.detalhe;
    var servidor = (detalhe && detalhe.servidor) || null;
    var evento = (detalhe && detalhe.eventoPrincipal) || null;
    var saude = S.state.saude;
    var usuario = API.user();

    var relatorio = {
      geradoEm: new Date().toISOString(),
      ambiente: saude && saude.api ? saude.api.ambiente : "desconhecido",
      apiBase: API.apiBase(),
      versaoServidor: saude && saude.api ? saude.api.versao : null,
      paginaDoRelato: window.location.pathname.split("/").pop(),
      usuario: { nome: usuario.nome || null, role: usuario.role || null },
      navegador: {
        userAgent: navigator.userAgent,
        idioma: navigator.language,
        viewport: window.innerWidth + "x" + window.innerHeight
      },
      request: detalhe ? {
        requestId: detalhe.requestId,
        metodo: servidor ? servidor.method : (evento ? evento.method : null),
        endpoint: servidor ? (servidor.route || servidor.path) : (evento ? evento.endpoint : null),
        status: servidor ? servidor.status_code : (evento ? evento.status_code : null),
        duracaoMs: servidor ? servidor.duration_ms : (evento ? evento.duration_ms : null),
        telaDeOrigem: evento ? evento.page : null,
        mensagemDeErro: servidor ? servidor.error_message : (evento ? evento.message : null),
        correlacao: detalhe.correlacao
      } : "nenhuma request selecionada",
      eventosRelacionados: detalhe ? detalhe.navegador.map(function (e) {
        return { em: e.created_at, tipo: e.event_type, severidade: e.severity, mensagem: e.message, pagina: e.page };
      }) : [],
      janelaAnalisada: S.state.window,
      resumoDaJanela: S.state.resumo ? {
        total: S.state.resumo.total,
        erros4xx: S.state.resumo.erros4xx,
        erros5xx: S.state.resumo.erros5xx,
        p95: S.state.resumo.p95
      } : null,
      // Nunca incluído: token, senha, cookie, payload sensível.
      observacao: "Relatório gerado pelo Control Center. Nenhum token, senha ou payload sensível é incluído."
    };

    S.state.ferramentas.relatorio = S.formatarJson(relatorio);
    S.emit();
    toast("Relatório gerado. Revise antes de compartilhar.");
  }

  /* ============================================================
   * PURGE
   * ============================================================ */

  function abrirPurge() {
    els.modalPurge.hidden = false;
    els.modalPurge.classList.add("is-open");
    document.getElementById("cc-purge-erro").textContent = "";
    var campo = document.getElementById("cc-purge-confirmacao");
    campo.value = "";
    campo.focus();
  }

  function fecharPurge() {
    els.modalPurge.hidden = true;
    els.modalPurge.classList.remove("is-open");
  }

  function confirmarPurge() {
    var confirmacao = document.getElementById("cc-purge-confirmacao").value;
    var antes = document.getElementById("cc-purge-antes").value;
    var erro = document.getElementById("cc-purge-erro");

    if (confirmacao !== "EXCLUIR HISTORICO") {
      erro.textContent = "Digite exatamente EXCLUIR HISTORICO para liberar a exclusão.";
      return;
    }

    erro.textContent = "";
    API.purge(confirmacao, antes ? new Date(antes).toISOString() : null).then(function (resposta) {
      if (!resposta.ok) {
        erro.textContent = resposta.erro || "falha ao excluir";
        return;
      }
      fecharPurge();
      toast("Removidos " + resposta.dados.requests + " requests e " + resposta.dados.clientEvents + " eventos do servidor.");
      atualizar("manual");
    });
  }

  /* ============================================================
   * TOASTS / DOWNLOAD
   * ============================================================ */

  function toast(mensagem, tipo) {
    if (!els.toasts) return;
    var caixa = document.createElement("div");
    caixa.className = "vf-toast vfc-toast" + (tipo === "erro" ? " is-danger" : tipo === "ok" ? " is-success" : "");
    caixa.setAttribute("role", "status");
    caixa.textContent = mensagem;
    els.toasts.appendChild(caixa);
    setTimeout(function () {
      caixa.classList.add("is-saindo");
      setTimeout(function () {
        if (caixa.parentNode) caixa.parentNode.removeChild(caixa);
      }, 300);
    }, 4200);
  }

  function baixarJson(dados, nomeBase) {
    try {
      var blob = new Blob([JSON.stringify(dados, null, 2)], { type: "application/json" });
      var url = URL.createObjectURL(blob);
      var link = document.createElement("a");
      link.href = url;
      link.download = nomeBase + "-" + new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-") + ".json";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    } catch (e) {
      toast("Falha ao gerar o arquivo.", "erro");
    }
  }

  window.addEventListener("beforeunload", function () {
    pararAutoRefresh();
    if (desinscreverColetor) desinscreverColetor();
  });
})();
