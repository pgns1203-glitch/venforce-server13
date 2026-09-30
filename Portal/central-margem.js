/*
 * Central de Margem — cockpit de precificação em JavaScript puro.
 *
 * Ordem de leitura da tela:
 *   RESUMO       compacto (margem, receita, lucro, prejuízo…) + saúde dos dados recolhida
 *   TABELA       o centro da operação (visão Operacional × Composição)
 *   DIVERGÊNCIAS resumo recolhido; a fila técnica completa abre sob demanda
 *   OPORTUNIDADES fonte bulk persistida (nunca promoções por linha)
 *   DRAWER       resumo fixo + PRECIFICAR · EVIDÊNCIAS · HISTÓRICO
 *
 * Todo número vem de `central-margem-api.js`, que é o contrato único; o
 * cálculo de preço/promoção é do BACKEND (camada segura /precificacao).
 * Nenhuma fórmula financeira mora aqui.
 */
(function (root) {
  "use strict";

  var contract = root.VFCentralMargemApi;
  if (!contract) return;

  var api = root.__VF_CENTRAL_MARGEM_API_CLIENT__ || contract.createClient();

  var CONFIDENCE_META = {
    HIGH: { label: "Alta", className: "is-success" },
    MEDIUM: { label: "Média", className: "is-warning" },
    LOW: { label: "Baixa", className: "is-danger" },
    UNKNOWN: { label: "Desconhecida", className: "is-neutral" },
  };

  var PRESET_COPY = {
    projected: "Preço, comissão e frete previstos do Mercado Livre + custo, imposto e taxa fixa da Base. Responde “qual é a margem do anúncio agora?”.",
    realized: "Preço médio vendido + comissão e frete realizados dos pedidos do período. Custo e imposto são os que a Base tinha no momento de cada venda (gravados pela Central de Vendas), não a Base de hoje. Taxa fixa não tem histórico: fica indisponível e não é descontada.",
    custom: "Uma ou mais fontes foram alteradas manualmente no cabeçalho. A composição exibida não corresponde a nenhum preset.",
  };

  var SOURCE_STATE_META = {
    OK: { label: "OK", className: "is-ok" },
    PARTIAL: { label: "Parcial", className: "is-warn" },
    PENDING: { label: "Pendente", className: "is-off" },
    UNAVAILABLE: { label: "Indisponível", className: "is-off" },
  };

  var PRESET_LABELS = { projected: "Projetado", realized: "Realizado", custom: "Personalizado" };

  var DRAWER_TABS = ["pricing", "evidence", "history"];
  // Nomes antigos das abas (atalhos/links antigos) caem na aba nova equivalente.
  var DRAWER_TAB_ALIASES = { summary: "pricing", scenario: "pricing", audit: "history" };

  var state = {
    token: null,
    // F2.3 — cliente vem do Shell V3 (aplicarContextoDoShell). getWorkspace
    // não recebe clienteContaId (é client-level, não account-level — §14
    // do MASTER_SPEC), então nada aqui finge precisão por conta. marketplace
    // segue fixo em "meli": o próprio renderContext() já escrevia "Mercado
    // Livre" hardcoded antes desta unidade — o Motor de Margem só resolve
    // bases MELI (confirmado em contextoPrecificacaoService).
    client: null,
    marketplace: "meli",
    search: "",
    financial: "",
    integrity: "",
    listingStatus: "",
    selection: contract.clonePreset("projected"),
    preset: "projected",
    criticalOnly: false,
    // Paginação VISUAL apenas: fatia o array já carregado no workspace.
    // Nunca dispara nova leitura — "Todos carregados" usa a string "all".
    visiblePageSize: 50,
    visiblePage: 1,
    loading: false,
    data: null,
    error: null,
    errorCode: null,
    searchTimer: null,
    requestSequence: 0,
    abortController: null,
    selectedItemId: null,
    drawerTab: "pricing",
    evidenceVariable: "price",
    scenario: null,
    scenarioItemId: null,
    previousFocus: null,

    // Leitura persistida (Margin Snapshot). O backend decide o modo em
    // /snapshot/resumo: "legacy" = workspace ao vivo (comportamento de
    // sempre); "snapshot" = projetada lida do banco, paginada/filtrada no
    // servidor, por CONTA (clienteContaId do Shell).
    mode: null,
    contaId: null,
    awaitingAccount: false,
    snapshot: null,
    serverPage: 1,
    serverLimit: 50,
    refreshRun: null,
    refreshError: null,
    pollTimer: null,
    pollSequence: 0,

    // Período do REALIZADO na leitura persistida: null = "últimos 30 dias
    // até ontem" (padrão do servidor); "YYYY-MM" = o parâmetro global
    // ?periodo= do Shell (vf-context), nunca um store novo.
    periodParam: null,
    realizado: null,
    realizadoError: null,
    realizadoLoading: false,
    realizadoSequence: 0,

    // Visão da tabela: "operational" (decisão) × "composition" (fontes).
    view: "operational",
    healthOpen: false,
    divergencesOpen: false,

    // Drawer / precificação. `drawerSeq` muda a cada abertura/troca de item
    // ou de contexto: resposta assíncrona de outro item/conta é descartada.
    drawerSeq: 0,
    pricing: null,
    promos: null,
    history: null,
    confirm: null,

    // Oportunidades da conta (uma leitura por conta/período).
    opps: null,
    oppsSequence: 0,
  };

  // Intervalo moderado de polling do run. O override existe só para o
  // smoke test de UI (mesmo padrão de __VF_CENTRAL_MARGEM_API_CLIENT__).
  var SNAPSHOT_POLL_MS = Number(root.__VF_CENTRAL_MARGEM_POLL_MS__) || 4000;
  // Pós-escrita: acompanha o refresh do snapshot do item aplicado.
  var POST_WRITE_POLL_MS = Number(root.__VF_CENTRAL_MARGEM_POST_WRITE_POLL_MS__) || 2500;

  var refs = {};

  function el(id) { return document.getElementById(id); }

  function escapeHtml(value) {
    return String(value === null || value === undefined ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatMoney(value, signed) {
    var number = contract.numberOrNull(value);
    if (number === null) return null;
    var prefix = signed && number > 0 ? "+" : "";
    return prefix + number.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  function formatPercent(value, signed) {
    var number = contract.numberOrNull(value);
    if (number === null) return null;
    var prefix = signed && number > 0 ? "+" : "";
    return prefix + (number * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 2 }) + "%";
  }

  function formatPp(value) {
    var number = contract.numberOrNull(value);
    if (number === null) return null;
    return (number > 0 ? "+" : "") + number.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 2 }) + " pp";
  }

  function formatByVariable(variableKey, value) {
    var meta = contract.VARIABLE_META[variableKey];
    return meta && meta.format === "percent" ? formatPercent(value) : formatMoney(value);
  }

  /**
   * Rótulo de cobertura do workspace: "107 de 107 carregados" (completa) ou
   * "200 de 350 carregados" (parcial — nunca some o total real do catálogo).
   */
  function coverageLabel(coverage) {
    if (!coverage) return "—";
    var loaded = coverage.loaded || 0;
    var total = coverage.total || loaded;
    return loaded + " de " + total + " carregados";
  }

  function formatDateTime(value) {
    if (!value) return null;
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleDateString("pt-BR") + " às " + date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }

  /** Ausência é informação: nunca vira zero, nunca vira traço mudo. */
  function unavailable(label, title) {
    return '<span class="cm-unavailable"' + (title ? ' title="' + escapeHtml(title) + '"' : "") +
      ">" + escapeHtml(label || "Indisponível") +
      (title ? '<span class="cm-info-mark" aria-hidden="true">ⓘ</span>' : "") + "</span>";
  }

  /*
   * Explica POR QUE uma célula está indisponível: fonte esperada, situação e
   * próxima ação — nunca inventa um motivo que o backend não informou. Sem
   * causa específica, cai no texto genérico e honesto do pedido.
   */
  var SOURCE_EXPECTATION_LABEL = {
    MELI_API: "Mercado Livre API",
    MELI_ORDER: "Pedido ML / shipment",
    VENFORCE_BASE: "Base VenForce",
    VENFORCE_BASE_HIST: "Base VenForce no momento da venda (Central de Vendas)",
    MERCADO_PAGO: "Mercado Pago",
    EXTENSION_DOM: "Extensão VenForce",
  };

  function explainUnavailable(variableKey, source) {
    var fonte = SOURCE_EXPECTATION_LABEL[source] || contract.sourceLabel(source);
    var linhas = ["Fonte esperada: " + fonte];
    if (source === "MERCADO_PAGO") {
      linhas.push("Situação: integração ainda não disponível.");
    } else if (source === "EXTENSION_DOM") {
      linhas.push("Situação: canal de ingestão ainda não disponível.");
    } else if (source === "VENFORCE_BASE_HIST" && variableKey === "fixedFee") {
      linhas.push("Situação: a Central de Vendas não guarda taxa fixa histórica — o realizado não desconta taxa fixa.");
      linhas.push("A taxa fixa atual nunca é usada no lugar do histórico.");
    } else if (source === "VENFORCE_BASE_HIST") {
      linhas.push("Situação: sem venda no período, ou as vendas não tinham " + variableLabel(variableKey) + " na Base quando foram sincronizadas.");
      linhas.push("A Base de hoje nunca substitui o valor da venda.");
    } else if (source === "VENFORCE_BASE") {
      linhas.push("Situação: nenhum " + variableLabel(variableKey) + " encontrado para este MLB na Base.");
      linhas.push("Ação: Ver na Base.");
    } else if (source === "MELI_API") {
      linhas.push("Situação: nenhuma evidência desta fonte foi retornada nesta leitura.");
      linhas.push("Ação: verificar conexão/sincronização ML.");
    } else if (source === "MELI_ORDER") {
      linhas.push("Situação: nenhuma venda/evidência realizada no período.");
    } else {
      linhas.push("Situação: nenhuma evidência desta fonte foi retornada nesta leitura.");
    }
    return linhas.join("\n");
  }

  function statusTag(entry) {
    if (!entry) return unavailable("Indisponível");
    return '<span class="vf-status ' + entry.tone + '" title="' + escapeHtml(entry.reason || "") + '">' + escapeHtml(entry.label) + "</span>";
  }

  function stateHtml(type, title, description, action) {
    if (type === "loading") {
      return '<div class="vf-loading-state" role="status"><span class="vf-spinner" aria-hidden="true"></span><span>' + escapeHtml(title) + "</span></div>";
    }
    var danger = type === "error";
    return '<div class="vf-empty"' + (danger ? ' role="alert"' : "") + ">" +
      '<div class="vf-empty__icon ' + (danger ? "is-danger" : "") + '" aria-hidden="true">' + (danger ? "!" : "◇") + "</div>" +
      '<p class="vf-empty__title">' + escapeHtml(title) + "</p>" +
      (description ? '<p class="vf-empty__description">' + escapeHtml(description) + "</p>" : "") +
      (action || "") + "</div>";
  }

  function toast(message, type) {
    var node = document.createElement("div");
    node.className = "vf-toast " + (type || "is-info");
    node.setAttribute("role", "status");
    node.innerHTML = '<div class="vf-toast__content"><p class="vf-toast__description">' + escapeHtml(message) + "</p></div>";
    refs.toasts.appendChild(node);
    root.setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, 3600);
  }

  function cacheRefs() {
    refs.search = el("cm-search");
    refs.refresh = el("cm-refresh");
    refs.updated = el("cm-updated");
    refs.contextMeta = el("cm-context-meta");
    refs.monitoredTag = el("cm-monitored-tag");
    refs.sourceTag = el("cm-source-tag");
    refs.pageState = el("cm-page-state");
    refs.presets = el("cm-presets");
    refs.modeCopy = el("cm-mode-copy");
    refs.sourceStrip = el("cm-source-strip");
    refs.openSources = el("cm-open-sources");
    refs.sourcesOverlay = el("cm-sources-overlay");
    refs.sourcesClose = el("cm-sources-close");
    refs.sourcesBody = el("cm-sources-body");
    refs.kpisFinancial = el("cm-kpis-financial");
    refs.kpisIntegrity = el("cm-kpis-integrity");
    refs.listingSummary = el("cm-listing-summary");
    refs.kpisListing = el("cm-kpis-listing");
    refs.summaryScope = el("cm-summary-scope");
    refs.restoreSources = el("cm-restore-sources");
    refs.financialFilter = el("cm-financial-filter");
    refs.integrityFilter = el("cm-integrity-filter");
    refs.listingStatusFilterWrap = el("cm-listing-status-filter-wrap");
    refs.listingStatusFilter = el("cm-listing-status-filter");
    refs.activeFilters = el("cm-active-filters");
    refs.resultCount = el("cm-result-count");
    refs.tableHost = el("cm-table-host");
    refs.pagination = el("cm-pagination");
    refs.criticalOnly = el("cm-critical-only");
    refs.divergenceCount = el("cm-divergence-count");
    refs.divergences = el("cm-divergences-host");
    refs.drawer = el("cm-drawer");
    refs.drawerBackdrop = el("cm-drawer-backdrop");
    refs.drawerTitle = el("cm-drawer-title");
    refs.drawerMeta = el("cm-drawer-meta");
    refs.drawerTabs = el("cm-drawer-tabs");
    refs.drawerBody = el("cm-drawer-body");
    refs.drawerPrev = el("cm-drawer-prev");
    refs.drawerNext = el("cm-drawer-next");
    refs.drawerPosition = el("cm-drawer-position");
    refs.toasts = el("cm-toasts");
    refs.topContext = el("cm-top-context");
    refs.kpisTop = el("cm-kpis-top");
    refs.summaryLine = el("cm-summary-line");
    refs.healthToggle = el("cm-health-toggle");
    refs.health = el("cm-health");
    refs.healthDot = el("cm-health-dot");
    refs.healthCount = el("cm-health-count");
    refs.view = el("cm-view");
    refs.compbar = el("cm-compbar");
    refs.divergencesToggle = el("cm-divergences-toggle");
    refs.divergencesBody = el("cm-divergences-body");
    refs.opportunities = el("cm-opportunities");
    refs.oppsHost = el("cm-opps-host");
    refs.oppsMeta = el("cm-opps-meta");
    refs.drawerSummary = el("cm-drawer-summary");
    refs.healthIssues = el("cm-health-issues");
    refs.confirmOverlay = el("cm-confirm-overlay");
    refs.confirmBody = el("cm-confirm-body");
    refs.confirmApply = el("cm-confirm-apply");
    refs.periodWrap = el("cm-period-wrap");
    refs.period = el("cm-period");
    refs.realized = el("cm-realized");
    refs.realizedPeriod = el("cm-realized-period");
    refs.realizedFresh = el("cm-realized-fresh");
    refs.kpisRealized = el("cm-kpis-realized");
    refs.realizedNotes = el("cm-realized-notes");
  }

  // ---------------------------------------------------------------------------
  // Eventos
  // ---------------------------------------------------------------------------

  function bindEvents() {
    // F2.3 — Cliente/Marketplace não são mais seletores locais: o contexto
    // vem do Shell V3 (aplicarContextoDoShell(), assinado via evento
    // 'vf:context' no fim do arquivo).

    // Período do realizado: relê a página e o realizado da conta. O
    // projetado (snapshot) NÃO é recalculado — nenhum refresh é pedido.
    if (refs.period) {
      refs.period.addEventListener("change", function () {
        var valor = refs.period.value || null;
        if (valor === state.periodParam) return;
        state.periodParam = valor;
        var ctx = root.VF && root.VF.context;
        if (ctx && typeof ctx.setPeriodoParam === "function") ctx.setPeriodoParam(valor);
        if (!isSnapshotMode()) return;
        state.serverPage = 1;
        loadSnapshotPage();
        loadRealizado();
        loadOpportunities();
      });
    }

    // Modo legado: busca PURAMENTE local sobre o workspace carregado.
    // Modo persistido: a busca vai ao servidor (debounce), página 1.
    refs.search.addEventListener("input", function () {
      state.search = refs.search.value.trim();
      state.visiblePage = 1;
      if (state.searchTimer) root.clearTimeout(state.searchTimer);
      state.searchTimer = root.setTimeout(function () {
        if (isSnapshotMode()) {
          state.serverPage = 1;
          loadSnapshotPage();
          return;
        }
        renderSummary();
        renderSheet();
        renderDivergences();
      }, isSnapshotMode() ? 300 : 150);
    });

    refs.refresh.addEventListener("click", function () {
      if (!state.client) { renderAll(); return; }
      // Persistido: "Atualizar leitura" enfileira o recálculo em background
      // (202) — nunca congela a tela esperando o cálculo.
      if (isSnapshotMode()) { requestSnapshotRefresh(); return; }
      loadCentral(true);
    });

    refs.presets.addEventListener("click", function (event) {
      var button = event.target.closest("[data-preset]");
      if (!button) return;
      applyPreset(button.getAttribute("data-preset"));
    });

    refs.restoreSources.addEventListener("click", function () { applyPreset("projected"); });

    refs.openSources.addEventListener("click", openSourcesPanel);
    refs.sourcesClose.addEventListener("click", closeSourcesPanel);
    refs.sourcesOverlay.addEventListener("click", function (event) {
      if (event.target === refs.sourcesOverlay) closeSourcesPanel();
    });

    refs.financialFilter.addEventListener("change", function () {
      state.financial = refs.financialFilter.value;
      onFiltersChanged();
    });

    refs.integrityFilter.addEventListener("change", function () {
      state.integrity = refs.integrityFilter.value;
      onFiltersChanged();
    });

    refs.listingStatusFilter.addEventListener("change", function () {
      state.listingStatus = refs.listingStatusFilter.value;
      onFiltersChanged();
    });

    refs.activeFilters.addEventListener("click", function (event) {
      var button = event.target.closest("[data-clear-filter]");
      if (!button) return;
      var target = button.getAttribute("data-clear-filter");
      if (target === "financial") { state.financial = ""; refs.financialFilter.value = ""; }
      if (target === "integrity") { state.integrity = ""; refs.integrityFilter.value = ""; }
      if (target === "listingStatus") { state.listingStatus = ""; refs.listingStatusFilter.value = ""; }
      onFiltersChanged();
    });

    refs.kpisFinancial.addEventListener("click", function (event) {
      var button = event.target.closest("[data-financial-filter]");
      if (!button || !state.data) return;
      var value = button.getAttribute("data-financial-filter");
      state.financial = state.financial === value ? "" : value;
      refs.financialFilter.value = state.financial;
      onFiltersChanged();
    });

    refs.kpisIntegrity.addEventListener("click", function (event) {
      var button = event.target.closest("[data-integrity-filter]");
      if (!button || !state.data) return;
      var value = button.getAttribute("data-integrity-filter");
      state.integrity = state.integrity === value ? "" : value;
      refs.integrityFilter.value = state.integrity;
      onFiltersChanged();
    });

    refs.kpisListing.addEventListener("click", function (event) {
      var button = event.target.closest("[data-listing-filter]");
      if (!button || !state.data) return;
      var value = button.getAttribute("data-listing-filter");
      state.listingStatus = state.listingStatus === value ? "" : value;
      refs.listingStatusFilter.value = state.listingStatus;
      onFiltersChanged();
    });

    // Sai da tela: nenhum timer de polling fica vivo.
    root.addEventListener("pagehide", stopPolling);

    refs.criticalOnly.addEventListener("click", function () {
      state.criticalOnly = !state.criticalOnly;
      refs.criticalOnly.setAttribute("aria-pressed", state.criticalOnly ? "true" : "false");
      refs.criticalOnly.classList.toggle("is-active", state.criticalOnly);
      refs.criticalOnly.textContent = state.criticalOnly ? "Mostrar todas" : "Somente críticas";
      renderDivergences();
    });

    refs.tableHost.addEventListener("change", function (event) {
      var select = event.target.closest("[data-source-select]");
      if (!select) return;
      state.selection[select.getAttribute("data-source-select")] = select.value;
      state.preset = contract.presetFor(state.selection);
      syncPresetButtons();
      renderSheet();
      renderDivergences();
      if (state.selectedItemId) { markSelectedRow(); renderDrawer(); }
    });

    refs.tableHost.addEventListener("click", function (event) {
      if (event.target.closest("select, option")) return;
      var evidence = event.target.closest("[data-open-evidence]");
      var trigger = event.target.closest("[data-open-item]");
      var row = event.target.closest("tr[data-item-id]");
      if (evidence) {
        event.preventDefault();
        event.stopPropagation();
        openDrawer(evidence.getAttribute("data-open-evidence"), "evidence", evidence.getAttribute("data-evidence-variable"), evidence);
      } else if (trigger) {
        event.preventDefault();
        event.stopPropagation();
        openDrawer(trigger.getAttribute("data-open-item"), "pricing", null, trigger);
      } else if (row && !event.target.closest("a, button, input, select")) {
        openDrawer(row.getAttribute("data-item-id"), "pricing", null, row);
      }
    });

    refs.tableHost.addEventListener("keydown", function (event) {
      var row = event.target.closest("tr[data-item-id]");
      if (row && event.target === row && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        openDrawer(row.getAttribute("data-item-id"), "pricing", null, row);
      }
    });

    refs.view.addEventListener("click", function (event) {
      var button = event.target.closest("[data-view]");
      if (!button) return;
      setView(button.getAttribute("data-view"));
    });

    refs.healthToggle.addEventListener("click", function () {
      state.healthOpen = !state.healthOpen;
      renderHealth();
    });

    refs.divergencesToggle.addEventListener("click", function () {
      state.divergencesOpen = !state.divergencesOpen;
      renderDivergences();
    });

    refs.kpisTop.addEventListener("click", function (event) {
      var button = event.target.closest("[data-financial-filter]");
      if (!button || !state.data) return;
      var value = button.getAttribute("data-financial-filter");
      state.financial = state.financial === value ? "" : value;
      refs.financialFilter.value = state.financial;
      onFiltersChanged();
    });

    refs.oppsHost.addEventListener("click", function (event) {
      var button = event.target.closest("[data-opp-item]");
      if (!button) return;
      openDrawer(button.getAttribute("data-opp-item"), "pricing", null, button, { fromOpportunity: true });
    });

    refs.divergences.addEventListener("click", function (event) {
      var button = event.target.closest("[data-evidence-item]");
      if (!button) return;
      openDrawer(button.getAttribute("data-evidence-item"), "evidence", button.getAttribute("data-evidence-variable"), button);
    });

    refs.drawerTabs.addEventListener("click", function (event) {
      var button = event.target.closest("[data-tab]");
      if (!button) return;
      setDrawerTab(button.getAttribute("data-tab"));
    });

    refs.drawerBackdrop.addEventListener("click", closeDrawer);
    el("cm-drawer-close").addEventListener("click", closeDrawer);
    el("cm-drawer-close-footer").addEventListener("click", closeDrawer);
    refs.drawerPrev.addEventListener("click", function () { moveDrawer(-1); });
    refs.drawerNext.addEventListener("click", function () { moveDrawer(1); });
    el("cm-confirm-close").addEventListener("click", closeConfirm);
    el("cm-confirm-cancel").addEventListener("click", closeConfirm);
    refs.confirmApply.addEventListener("click", confirmApply);
    refs.confirmOverlay.addEventListener("click", function (event) {
      if (event.target === refs.confirmOverlay) closeConfirm();
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && refs.confirmOverlay.classList.contains("is-open")) { closeConfirm(); return; }
      if (event.key === "Escape" && refs.sourcesOverlay.classList.contains("is-open")) { closeSourcesPanel(); return; }
      if (event.key === "Escape" && refs.drawer.classList.contains("is-open")) closeDrawer();
      if (event.key === "Tab" && refs.drawer.classList.contains("is-open")) trapFocus(event);
    });
  }

  // Legado: filtros re-renderizam o workspace carregado. Persistido: nova
  // página 1 no servidor (o filtro vale para o catálogo inteiro da conta).
  function onFiltersChanged() {
    state.visiblePage = 1;
    if (isSnapshotMode()) {
      state.serverPage = 1;
      renderActiveFilters();
      loadSnapshotPage();
      return;
    }
    renderSummary();
    renderSheet();
    renderDivergences();
    renderActiveFilters();
  }

  /** O drawer (e o preview por cima dele) é modal: o Tab não escapa. */
  function trapFocus(event) {
    var container = refs.confirmOverlay && refs.confirmOverlay.classList.contains("is-open") ? refs.confirmOverlay : refs.drawer;
    var focusable = container.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
    if (!focusable.length) return;
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (!container.contains(document.activeElement)) {
      event.preventDefault();
      first.focus();
      return;
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function applyPreset(name) {
    if (name === "custom") {
      // "Personalizado" é um ESTADO, não um preset: só é atingido alterando um
      // seletor. Clicar nele não inventa uma composição nova.
      state.preset = contract.presetFor(state.selection);
      syncPresetButtons();
      return;
    }
    state.selection = contract.clonePreset(name);
    state.preset = contract.presetFor(state.selection);
    syncPresetButtons();
    renderSheet();
    renderDivergences();
    if (state.selectedItemId) {
      var item = findSelectedItem();
      if (item) initScenario(item);
      renderDrawer();
    }
  }

  function syncPresetButtons() {
    Array.prototype.forEach.call(refs.presets.querySelectorAll("[data-preset]"), function (button) {
      var active = button.getAttribute("data-preset") === state.preset;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    refs.modeCopy.textContent = PRESET_COPY[state.preset] || PRESET_COPY.custom;
  }

  // ---------------------------------------------------------------------------
  // Carregamento
  // ---------------------------------------------------------------------------

  // F2.3 — o contexto vem do Shell V3 (vf-context.js), nunca mais de um
  // <select> local nem de localStorage. data-vf-scope="client" nesta
  // página (não "account"): getWorkspace() é client-level, sem
  // clienteContaId — exigir uma operação escolhida antes de liberar a
  // tela seria um passo sem efeito nenhum no que é carregado.
  //
  // central-margem.js roda como <script> CLÁSSICO, carregado ANTES do
  // vf-shell.js (module, deferred) terminar de executar — a ponte é o
  // evento DOM 'vf:context' (MASTER_SPEC §6.5/§15.3), registrada no fim
  // deste arquivo antes de qualquer emit poder acontecer.
  var ultimoClienteAplicado; // difere de undefined/null na primeira chamada
  function aplicarContextoDoShell(snap) {
    var ctx = root.VF && root.VF.context;
    var temCliente = ctx && snap.context && snap.context.clienteId;
    var clienteAtual = temCliente ? ctx.getClienteAtual() : null;
    var chave = clienteAtual ? clienteAtual.slug : null;
    var contaId = temCliente && snap.context.clienteContaId ? snap.context.clienteContaId : null;

    state.client = clienteAtual ? { id: clienteAtual.id, slug: clienteAtual.slug, name: clienteAtual.nome } : null;

    var clienteMudou = chave !== ultimoClienteAplicado;
    var contaMudou = contaId !== state.contaId;
    state.contaId = contaId;
    // Precificação é SEMPRE por conta: trocar a conta fecha o drawer (e
    // invalida promoções/simulações em voo) mesmo no modo legado.
    if (contaMudou) closeDrawer();
    // O workspace legado é client-level: trocar/resolver a conta NÃO relê
    // (evita uma 2ª varredura ao vivo do Motor). Só a leitura persistida é
    // por conta — nela, trocar de conta troca o dataset.
    if (!clienteMudou && !(contaMudou && (state.mode === "snapshot" || state.awaitingAccount))) return;
    ultimoClienteAplicado = chave;

    stopPolling();
    state.visiblePage = 1;
    state.serverPage = 1;
    state.refreshRun = null;
    state.refreshError = null;
    // Troca de cliente/conta invalida o realizado em voo (resposta velha
    // nunca sobrescreve o contexto novo — ver loadRealizado).
    state.realizadoSequence += 1;
    state.realizado = null;
    state.realizadoError = null;
    state.realizadoLoading = false;
    state.oppsSequence += 1;
    state.opps = null;
    state.periodParam = lerPeriodoDoShell();
    if (clienteMudou) {
      state.mode = null;
      state.snapshot = null;
      state.data = null;
    }
    closeDrawer();
    if (state.client) {
      loadCentral();
    } else {
      state.data = null;
      state.error = null;
      state.errorCode = null;
      renderAll();
    }
  }

  function isSnapshotMode() { return state.mode === "snapshot"; }

  function lerPeriodoDoShell() {
    var ctx = root.VF && root.VF.context;
    var valor = ctx && typeof ctx.getPeriodoParam === "function" ? ctx.getPeriodoParam() : null;
    return /^\d{4}-\d{2}$/.test(String(valor || "")) ? valor : null;
  }

  // ---------------------------------------------------------------------------
  // Realizado da CONTA no período (KPIs, cobertura, freshness)
  // ---------------------------------------------------------------------------

  /** Uma leitura por (cliente, conta, período); resposta de contexto velho é descartada. */
  function loadRealizado() {
    if (!isSnapshotMode() || !state.client || !state.contaId || typeof api.getSnapshotRealizado !== "function") {
      state.realizado = null;
      renderRealized();
      return Promise.resolve();
    }
    state.realizadoSequence += 1;
    var sequence = state.realizadoSequence;
    var slug = state.client.slug;
    var conta = state.contaId;
    var periodo = state.periodParam || null;
    state.realizadoLoading = true;
    state.realizadoError = null;
    renderRealized();
    return api.getSnapshotRealizado({ clientSlug: slug, clienteContaId: conta, periodo: periodo || undefined }).then(function (result) {
      if (sequence !== state.realizadoSequence) return;
      if (!state.client || state.client.slug !== slug || state.contaId !== conta || (state.periodParam || null) !== periodo) return;
      state.realizadoLoading = false;
      if (!result.ok) {
        state.realizado = null;
        state.realizadoError = result.error || "Não foi possível carregar o realizado do período.";
      } else {
        state.realizado = result.enabled === false ? null : result;
      }
      renderRealized();
      renderContext();
      renderTop();
      renderHealth();
    }).catch(function (error) {
      if (sequence !== state.realizadoSequence) return;
      state.realizadoLoading = false;
      state.realizado = null;
      state.realizadoError = error && error.message || "Falha inesperada ao carregar o realizado.";
      renderRealized();
    });
  }

  function loadCentral(manual) {
    if (!state.client) return;
    if (state.mode === "snapshot") return loadSnapshot(manual);
    if (state.mode === "legacy" || typeof api.getSnapshotResumo !== "function") {
      state.mode = "legacy";
      return loadWorkspace(manual);
    }
    return decideMode(manual);
  }

  // ---------------------------------------------------------------------------
  // Leitura persistida (Margin Snapshot)
  // ---------------------------------------------------------------------------

  function decideMode(manual) {
    state.requestSequence += 1;
    var sequence = state.requestSequence;
    var clienteNoInicio = state.client && state.client.slug;
    var contaNoInicio = state.contaId;
    state.loading = true;
    state.error = null;
    state.errorCode = null;
    renderAll();
    return api.getSnapshotResumo({ clientSlug: clienteNoInicio, clienteContaId: contaNoInicio }).then(function (resumo) {
      if (sequence !== state.requestSequence) return;
      // O vf-context pode resolver/trocar a conta enquanto a descoberta do
      // modo ainda está em voo. A resposta pertence ao contexto capturado
      // acima e nunca pode decidir o modo nem colocar a conta atual em espera.
      // Repassar por loadCentral() preserva o vf-context como única autoridade
      // e refaz imediatamente o resumo com a conta que ele já resolveu.
      if (!state.client || state.client.slug !== clienteNoInicio || state.contaId !== contaNoInicio) {
        return state.client ? loadCentral(manual) : undefined;
      }
      if (!resumo.ok && (resumo.status === 404 || resumo.type === "network")) {
        // Backend sem a rota de snapshot (deploy anterior/rollback) ou rede
        // indisponível: a tela segue exatamente o caminho de sempre.
        state.mode = "legacy";
        return loadWorkspace(manual);
      }
      if (!resumo.ok) {
        if (resumo.code === "CLIENTE_CONTA_ID_OBRIGATORIO") {
          // Leitura persistida ligada, mas o Shell ainda não tem conta
          // (cliente com 2+ contas sem escolha): nunca escolher por ele.
          state.mode = "snapshot";
          state.awaitingAccount = true;
          state.loading = false;
          state.data = null;
          renderAll();
          return;
        }
        state.loading = false;
        state.error = resumo.error || "Não foi possível ler o estado da Central.";
        state.errorCode = resumo.code || null;
        renderAll();
        return;
      }
      if (!resumo.enabled) {
        state.mode = "legacy";
        return loadWorkspace(manual);
      }
      state.mode = "snapshot";
      state.awaitingAccount = false;
      applySnapshotResumo(resumo);
      loadRealizado();
      loadOpportunities();
      return loadSnapshotPage();
    }).catch(function (error) {
      if (sequence !== state.requestSequence) return;
      state.loading = false;
      state.error = error && error.message || "Falha inesperada ao carregar a Central.";
      renderAll();
    });
  }

  function applySnapshotResumo(resumo) {
    state.snapshot = resumo;
    if (resumo.activeRun && !contract.isRunTerminal(resumo.activeRun.status)) {
      state.refreshRun = resumo.activeRun;
      startPolling(resumo.activeRun.runId);
    }
  }

  // Resumo (estado + KPIs) e página atual. Usado na entrada e depois que um
  // run de atualização termina.
  function loadSnapshot() {
    if (!state.contaId) {
      state.awaitingAccount = true;
      state.data = null;
      renderAll();
      return Promise.resolve();
    }
    state.requestSequence += 1;
    var sequence = state.requestSequence;
    state.loading = !state.data;
    renderAll();
    return api.getSnapshotResumo({ clientSlug: state.client.slug, clienteContaId: state.contaId }).then(function (resumo) {
      if (sequence !== state.requestSequence) return;
      if (!resumo.ok) {
        state.loading = false;
        state.error = resumo.error;
        state.errorCode = resumo.code || null;
        renderAll();
        return;
      }
      if (!resumo.enabled) {
        state.mode = "legacy";
        state.snapshot = null;
        return loadWorkspace();
      }
      state.awaitingAccount = false;
      applySnapshotResumo(resumo);
      loadRealizado();
      loadOpportunities();
      return loadSnapshotPage();
    });
  }

  /** Busca UMA página no servidor — nunca o catálogo inteiro. */
  function loadSnapshotPage() {
    if (!state.client || !state.contaId) return Promise.resolve();
    state.requestSequence += 1;
    var sequence = state.requestSequence;
    if (state.abortController) state.abortController.abort();
    state.abortController = typeof AbortController !== "undefined" ? new AbortController() : null;
    state.loading = true;
    state.error = null;
    state.errorCode = null;
    renderAll();

    var statuses = contract.snapshotStatusFilter(state.financial, state.integrity);
    if (statuses && !statuses.length) {
      // Combinação de filtros impossível: resultado vazio sem ir ao servidor.
      state.loading = false;
      state.data = Object.assign({}, state.data || {}, { items: [], pagination: { page: 1, limit: state.serverLimit, total: 0, totalPages: 1 } });
      renderAll();
      return Promise.resolve();
    }

    return api.getSnapshotItens({
      clientSlug: state.client.slug,
      clientName: state.client.name,
      marketplace: state.marketplace,
      clienteContaId: state.contaId,
      page: state.serverPage,
      limit: state.serverLimit,
      status: statuses,
      statusAnuncio: state.listingStatus || undefined,
      search: state.search || undefined,
      periodo: state.periodParam || undefined,
    }, state.abortController && state.abortController.signal).then(function (result) {
      if (sequence !== state.requestSequence || result.aborted) return;
      state.loading = false;
      if (!result.ok) {
        state.error = result.error || "Não foi possível carregar os itens.";
        state.errorCode = result.code || null;
        renderAll();
        return;
      }
      state.data = result;
      if (result.refresh && result.refresh.activeRun && !contract.isRunTerminal(result.refresh.activeRun.status) && !state.pollTimer) {
        state.refreshRun = result.refresh.activeRun;
        startPolling(result.refresh.activeRun.runId);
      }
      renderAll();
    }).catch(function (error) {
      if (sequence !== state.requestSequence) return;
      state.loading = false;
      state.error = error && error.message || "Falha inesperada ao carregar os itens.";
      renderAll();
    });
  }

  /** "Atualizar leitura" no modo persistido: enfileira (202) e acompanha. */
  function requestSnapshotRefresh() {
    if (!state.client || !state.contaId) return;
    state.refreshError = null;
    refs.refresh.disabled = true;
    return api.requestSnapshotRefresh({ clientSlug: state.client.slug, clienteContaId: state.contaId }).then(function (result) {
      if (!result.ok) {
        state.refreshError = result.error;
        toast(result.error || "Não foi possível iniciar a atualização.", "is-danger");
        renderAll();
        return;
      }
      state.refreshRun = result.run || { runId: result.runId, status: "queued", processedItems: 0, totalItems: null };
      toast(result.reused ? "Já existe uma atualização em andamento; acompanhando o progresso." : "Atualização iniciada. A leitura atual continua visível.", "is-info");
      startPolling(result.runId);
      renderAll();
    });
  }

  // Polling leve do run: um único timer por vez, cancelado ao trocar de
  // cliente/conta ou sair da página; para em completed/failed.
  function startPolling(runId) {
    stopPolling();
    if (!runId) return;
    state.pollSequence += 1;
    var pollSequence = state.pollSequence;
    var contaNoInicio = state.contaId;
    var slugNoInicio = state.client && state.client.slug;
    function tick() {
      state.pollTimer = null;
      if (pollSequence !== state.pollSequence) return;
      api.getSnapshotRefreshStatus({ clientSlug: slugNoInicio, clienteContaId: contaNoInicio, runId: runId }).then(function (result) {
        if (pollSequence !== state.pollSequence) return;
        if (!result.ok) {
          // Falha pontual de rede não encerra o acompanhamento.
          state.pollTimer = root.setTimeout(tick, SNAPSHOT_POLL_MS);
          return;
        }
        state.refreshRun = result.run;
        if (contract.isRunTerminal(result.run.status)) {
          state.pollTimer = null;
          if (result.run.status === "completed") {
            toast("Leitura atualizada: " + (result.run.successItems || 0) + " item(ns) recalculado(s). Nenhum preço foi alterado.", "is-success");
          }
          loadSnapshot();
          return;
        }
        renderPageState();
        state.pollTimer = root.setTimeout(tick, SNAPSHOT_POLL_MS);
      });
    }
    state.pollTimer = root.setTimeout(tick, SNAPSHOT_POLL_MS);
  }

  function stopPolling() {
    state.pollSequence += 1;
    if (state.pollTimer) root.clearTimeout(state.pollTimer);
    state.pollTimer = null;
  }

  function loadWorkspace(manual) {
    if (!state.client) return;
    state.requestSequence += 1;
    var sequence = state.requestSequence;
    if (state.abortController) state.abortController.abort();
    state.abortController = typeof AbortController !== "undefined" ? new AbortController() : null;
    state.loading = true;
    state.error = null;
    state.errorCode = null;
    state.visiblePage = 1;
    renderAll();

    // UMA ÚNICA varredura (workspace) alimenta planilha, filtros, KPIs e fila
    // de divergências. Nenhuma chamada por linha, nem na abertura do drawer,
    // nem ao filtrar/buscar/paginar visualmente — só "Atualizar leitura"
    // monta um novo workspace.
    return api.getWorkspace({
      clientSlug: state.client.slug,
      clientName: state.client.name,
      marketplace: state.marketplace,
    }, state.abortController && state.abortController.signal).then(function (result) {
      if (sequence !== state.requestSequence || result.aborted) return;
      state.loading = false;
      if (!result.ok) {
        state.error = result.error || "Não foi possível carregar a Central de Margem.";
        state.errorCode = result.code || null;
        state.data = null;
      } else {
        state.data = result;
        state.error = null;
        state.errorCode = null;
        if (manual) toast("Leitura atualizada. Nenhum preço foi alterado.", "is-success");
      }
      renderAll();
    }).catch(function (error) {
      if (sequence !== state.requestSequence) return;
      state.loading = false;
      state.data = null;
      state.error = error && error.message || "Falha inesperada ao carregar a Central.";
      state.errorCode = null;
      renderAll();
    });
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  function runEmAndamento() {
    return Boolean(state.refreshRun && !contract.isRunTerminal(state.refreshRun.status));
  }

  function renderAll() {
    refs.refresh.disabled = state.loading || !state.client || (isSnapshotMode() && (state.awaitingAccount || runEmAndamento()));
    refs.refresh.classList.toggle("is-loading", state.loading || (isSnapshotMode() && runEmAndamento()));
    refs.search.disabled = !state.client;
    refs.listingStatusFilterWrap.hidden = !isSnapshotMode();
    renderContext();
    renderPeriodSelect();
    renderPageState();
    syncPresetButtons();
    renderSourceStrip();
    renderSummary();
    renderRealized();
    renderTop();
    renderHealth();
    renderViewToggle();
    renderActiveFilters();
    renderSheet();
    renderDivergences();
    renderOpportunities();
  }

  var MESES_CURTOS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

  function formatDateBr(iso) {
    if (!iso) return null;
    var parts = String(iso).slice(0, 10).split("-");
    return parts.length === 3 ? parts[2] + "/" + parts[1] + "/" + parts[0] : String(iso);
  }

  /** Opções do período: padrão (30 dias até ontem), mês atual e 3 anteriores. */
  function periodOptions() {
    var hoje = new Date();
    var opts = [{ value: "", label: "Últimos 30 dias (até ontem)" }];
    for (var i = 0; i < 4; i += 1) {
      var d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
      var key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
      opts.push({ value: key, label: i === 0 ? "Mês atual (até ontem)" : MESES_CURTOS[d.getMonth()] + "/" + d.getFullYear() });
    }
    if (state.periodParam && !opts.some(function (o) { return o.value === state.periodParam; })) {
      opts.push({ value: state.periodParam, label: state.periodParam });
    }
    return opts;
  }

  function renderPeriodSelect() {
    if (!refs.periodWrap || !refs.period) return;
    var visivel = isSnapshotMode() && !state.awaitingAccount && Boolean(state.client);
    refs.periodWrap.hidden = !visivel;
    if (!visivel) return;
    var atual = state.periodParam || "";
    refs.period.innerHTML = periodOptions().map(function (o) {
      return '<option value="' + escapeHtml(o.value) + '"' + (o.value === atual ? " selected" : "") + ">" + escapeHtml(o.label) + "</option>";
    }).join("");
    refs.period.value = atual;
    refs.period.disabled = state.loading;
  }

  var FRESHNESS_META = {
    ATUAL: { label: "Atual", tone: "is-success", copy: "todo o período coberto por sincronização publicada" },
    PARCIAL: { label: "Parcial", tone: "is-warning", copy: "parte do período não está coberta pela sincronização publicada" },
    NAO_DECLARADA: { label: "Cobertura não declarada", tone: "is-neutral", copy: "dados de importação anterior à publicação por cobertura" },
    SEM_SINCRONIZACAO: { label: "Sem sincronização", tone: "is-neutral", copy: "nenhuma venda sincronizada neste período" },
  };

  function realizedKpi(label, valueHtml, foot, modifier) {
    return '<div class="cm-kpi cm-kpi--static ' + (modifier || "") + '"><span class="cm-kpi__label">' + escapeHtml(label) + "</span>" +
      '<strong class="cm-kpi__value">' + valueHtml + "</strong>" +
      (foot ? '<span class="cm-kpi__foot">' + escapeHtml(foot) + "</span>" : "") + "</div>";
  }

  function formatInt(value) {
    return value === null || value === undefined ? null : Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  }

  function gapCopy(gap) {
    var mes = gap.month || "";
    if (gap.reason === "COBERTURA_INSUFICIENTE") {
      return mes + ": vendas publicadas só até " + (formatDateBr(gap.publishedUntil) || "—") +
        " — o período pede até " + (formatDateBr(gap.to) || "—") + ". Este mês ficou fora do realizado (nada foi zerado).";
    }
    return mes + ": nenhuma sincronização publicada cobre " + (formatDateBr(gap.from) || "—") + " a " + (formatDateBr(gap.to) || "—") + ".";
  }

  /** Bloco "Realizado no período": só EXIBE o que o backend calculou. */
  function renderRealized() {
    if (!refs.realized) return;
    var visivel = isSnapshotMode() && !state.awaitingAccount && Boolean(state.client && state.contaId);
    refs.realized.hidden = !visivel;
    if (!visivel) return;
    var r = state.realizado;
    if (state.realizadoLoading && !r) {
      refs.realizedPeriod.textContent = "carregando…";
      refs.realizedFresh.innerHTML = "";
      refs.kpisRealized.innerHTML = '<div class="vf-skeleton vf-skeleton--row"></div>';
      refs.realizedNotes.innerHTML = "";
      return;
    }
    if (!r) {
      refs.realizedPeriod.textContent = "—";
      refs.realizedFresh.innerHTML = state.realizadoError
        ? '<p class="cm-realized__error" role="alert">' + escapeHtml(state.realizadoError) + "</p>"
        : '<p class="cm-realized__muted">O realizado da conta aparece depois da primeira leitura.</p>';
      refs.kpisRealized.innerHTML = "";
      refs.realizedNotes.innerHTML = "";
      return;
    }
    var fresh = r.freshness || {};
    var meta = FRESHNESS_META[fresh.state] || FRESHNESS_META.SEM_SINCRONIZACAO;
    refs.realizedPeriod.textContent = (r.period && r.period.label) || "—";
    refs.realizedFresh.innerHTML =
      '<span class="vf-status ' + meta.tone + '" data-cm-realized-state="' + escapeHtml(fresh.state || "") + '" title="' + escapeHtml(meta.copy) + '">' + escapeHtml(meta.label) + "</span>" +
      (fresh.syncInProgress ? '<span class="vf-status is-info" data-cm-sync-running>Sincronização em andamento</span>' : "") +
      '<span class="cm-realized__fact">Vendas sincronizadas até <strong>' + escapeHtml(formatDateBr(fresh.syncedUntil) || "—") + "</strong></span>" +
      (fresh.lastPublishedAt ? '<span class="cm-realized__fact">publicado em ' + escapeHtml(formatDateTime(fresh.lastPublishedAt)) + "</span>" : "") +
      '<span class="cm-realized__fact">Projetado calculado em ' + escapeHtml(formatDateTime(state.snapshot && state.snapshot.lastCalculatedAt) || "—") + "</span>";

    var k = r.kpis || {};
    var m = k.margin || {};
    var d = k.drift || {};
    var margemFoot = m.state === "completa"
      ? "Σ lucro ÷ Σ receita · cobertura total"
      : m.state === "parcial"
        ? "parcial · " + (m.revenueCoverage === null ? "—" : formatPercent(m.revenueCoverage)) + " da receita sustenta o número"
        : "nenhum produto com margem realizada calculável";
    refs.kpisRealized.innerHTML = [
      realizedKpi("Receita realizada", escapeHtml(formatMoney(k.revenue) || "—"), k.revenueWithoutListing ? "inclui " + formatMoney(k.revenueWithoutListing) + " sem MLB" : "pedidos que entram no resultado"),
      realizedKpi("Unidades", escapeHtml(formatInt(k.units) || "0"), null),
      realizedKpi("Pedidos", escapeHtml(formatInt(k.orders) || "0"), "distintos"),
      realizedKpi("Produtos com venda", escapeHtml(formatInt(k.productsWithSales) || "0"), null),
      realizedKpi("Lucro realizado", k.profit === null ? unavailable("Indisponível", "Nenhum produto com margem realizada calculável no período.") : escapeHtml(formatMoney(k.profit)),
        k.profit === null ? null : "sem taxa fixa (sem histórico)", k.profit !== null && k.profit < 0 ? "is-danger" : ""),
      realizedKpi("Margem realizada", m.percent === null ? unavailable("Indisponível", margemFoot) : escapeHtml(formatPercent(m.percent / 100)), margemFoot,
        m.state === "parcial" ? "is-warning" : ""),
      realizedKpi("Desvio de margem", d.pp === null ? unavailable("Indisponível", "Sem produto com projetado e realizado calculáveis.") : escapeHtml(formatPp(d.pp)),
        d.available ? "realizado " + formatPercent(d.realizedMixPercent / 100) + " × projetado " + formatPercent(d.projectedMixPercent / 100) + " no mesmo mix" : null,
        d.pp !== null && d.pp < 0 ? "is-danger" : ""),
      realizedKpi("Desvio negativo relevante", escapeHtml(formatInt(d.negative) || "0"), "produtos com Δ ≤ −" + (d.thresholdPp || 2) + " p.p.", d.negative ? "is-warning" : ""),
    ].join("");

    var notas = [];
    var cov = r.coverage || {};
    (cov.gaps || []).forEach(function (gap) { notas.push('<li data-cm-gap="' + escapeHtml(gap.month) + '">' + escapeHtml(gapCopy(gap)) + "</li>"); });
    if (m.productsWithoutMargin) {
      notas.push("<li>" + escapeHtml(m.productsWithoutMargin + " produto(s) venderam sem margem realizada calculável (ex.: sem custo histórico na venda) — fora do lucro e da margem, contados na receita.") + "</li>");
    }
    if (m.estimatedProducts) {
      notas.push("<li>" + escapeHtml(m.estimatedProducts + " produto(s) com componente estimado (cobertura parcial de comissão/frete/custo/imposto ou frete rateado de pedido multi-item).") + "</li>");
    }
    if (d.worst && d.worst.length) {
      notas.push("<li>Maiores desvios: " + d.worst.map(function (w) {
        return escapeHtml((w.titulo || w.itemId) + " " + formatPp(w.driftPp));
      }).join(" · ") + "</li>");
    }
    refs.realizedNotes.innerHTML = notas.length ? '<ul class="cm-realized__list">' + notas.join("") + "</ul>" : "";
  }

  function renderContext() {
    var data = state.data;
    if (isSnapshotMode()) {
      var snap = state.snapshot || {};
      refs.updated.innerHTML = '<span class="cm-updated__label">Último cálculo</span><strong>' +
        escapeHtml(formatDateTime(snap.lastCalculatedAt) || "—") + "</strong>";
      refs.monitoredTag.textContent = snap.totalItems === null || snap.totalItems === undefined ? "—" : snap.totalItems + " itens";
      refs.sourceTag.textContent = "Leitura persistida";
      var contaMeta = root.VF && root.VF.context && root.VF.context.getAccountMeta ? root.VF.context.getAccountMeta() : null;
      refs.contextMeta.innerHTML = state.client
        ? '<span><strong>Cliente:</strong> ' + escapeHtml(state.client.name) + "</span>" +
          (contaMeta ? '<span><strong>Conta:</strong> ' + escapeHtml(contaMeta.nome || contaMeta.externalAccountLabel || state.contaId) + "</span>" : "") +
          '<span><strong>Marketplace:</strong> Mercado Livre</span>' +
          '<span><strong>Projetado:</strong> snapshot calculado em ' + escapeHtml(formatDateTime(snap.lastCalculatedAt) || "—") + "</span>" +
          '<span><strong>Realizado:</strong> ' + escapeHtml((data && data.period && data.period.label) || (state.realizado && state.realizado.period && state.realizado.period.label) || "últimos 30 dias (até ontem)") +
          (state.realizado && state.realizado.freshness && state.realizado.freshness.syncedUntil
            ? " · sincronizado até " + escapeHtml(formatDateBr(state.realizado.freshness.syncedUntil))
            : "") + "</span>" +
          '<span><strong>Modo:</strong> somente leitura</span>'
        : "";
      return;
    }
    refs.updated.innerHTML = '<span class="cm-updated__label">Última atualização</span><strong>' +
      escapeHtml((data && formatDateTime(data.lastUpdated)) || "—") + "</strong>";
    refs.monitoredTag.textContent = data ? coverageLabel(data.coverage) : "—";
    refs.sourceTag.textContent = data ? data.sourceLabel + " · leitura" : "Motor · leitura";
    if (!data || !state.client) {
      refs.contextMeta.innerHTML = state.client ? '<span><strong>Cliente:</strong> ' + escapeHtml(state.client.name) + "</span>" : "";
      return;
    }
    var period = data.period || {};
    var coverage = data.coverage || {};
    refs.contextMeta.innerHTML =
      '<span><strong>Cliente:</strong> ' + escapeHtml(state.client.name) + "</span>" +
      '<span><strong>Marketplace:</strong> Mercado Livre</span>' +
      '<span><strong>Fonte:</strong> ' + escapeHtml(data.sourceLabel) + "</span>" +
      '<span><strong>Realizado:</strong> ' + escapeHtml(period.label || "últimos 30 dias (até ontem)") + "</span>" +
      '<span><strong>Modo:</strong> somente leitura</span>' +
      '<span class="cm-coverage' + (coverage.partial ? " is-partial" : "") + '"><strong>Cobertura:</strong> ' +
      escapeHtml(coverageLabel(coverage)) + (coverage.partial ? " · parcial" : "") + "</span>";
  }

  function progressoRun(run) {
    var total = run.totalItems;
    var feitos = run.processedItems || 0;
    var pct = total ? Math.min(100, Math.round((feitos / total) * 100)) : null;
    return { total: total, feitos: feitos, pct: pct };
  }

  // Banners do modo persistido — nunca escondem falha nem fingem leitura.
  function renderSnapshotPageState() {
    var partes = [];
    if (state.awaitingAccount) {
      refs.pageState.innerHTML = '<div class="vf-banner is-info" data-cm-snapshot-state="conta"><div class="vf-banner__content"><p class="vf-banner__title">Escolha a operação (conta Mercado Livre)</p><p class="vf-banner__description">A leitura persistida da margem é por conta. Este cliente tem mais de uma conta ativa — selecione a operação no seletor do topo.</p></div></div>';
      return;
    }
    var snap = state.snapshot || {};
    var run = state.refreshRun;
    if (run && !contract.isRunTerminal(run.status)) {
      var p = progressoRun(run);
      var texto = run.status === "queued"
        ? "Na fila para atualizar…"
        : "Atualizando leitura · " + p.feitos + (p.total !== null ? " / " + p.total : "") + " itens";
      partes.push('<div class="vf-banner is-info" data-cm-snapshot-state="' + escapeHtml(run.status) + '" role="status"><div class="vf-banner__content"><p class="vf-banner__title">' + escapeHtml(texto) + "</p>" +
        (p.pct !== null ? '<div class="cm-progress" aria-hidden="true"><span style="width:' + p.pct + '%"></span></div>' : "") +
        '<p class="vf-banner__description">' + (snap.state === "ready"
          ? "O último snapshot continua visível enquanto a atualização roda em background."
          : "A primeira leitura desta conta está sendo calculada em background.") + "</p></div></div>");
    } else if (snap.state === "missing") {
      partes.push('<div class="vf-banner is-warning" data-cm-snapshot-state="missing"><div class="vf-banner__content"><p class="vf-banner__title">Leitura ainda não calculada para esta conta</p><p class="vf-banner__description">' +
        escapeHtml(snap.message || "Clique em \"Atualizar leitura\" para calcular a margem projetada em background.") +
        '</p></div><div class="vf-banner__actions"><button class="vf-btn vf-btn--primary vf-btn--sm" type="button" id="cm-snapshot-start">Atualizar leitura</button></div></div>');
    }
    var ultimo = run && contract.isRunTerminal(run.status) ? run : snap.lastRun;
    if (ultimo && ultimo.status === "failed" && !runEmAndamento()) {
      partes.push('<div class="vf-banner is-danger" data-cm-snapshot-state="failed" role="alert"><div class="vf-banner__content"><p class="vf-banner__title">A última atualização falhou</p><p class="vf-banner__description">' +
        escapeHtml(ultimo.errorMessage || "Erro não informado.") +
        (snap.state === "ready" ? " Os valores exibidos são do último snapshot válido — nada foi zerado." : "") + "</p></div></div>");
    }
    if (snap.kpis && snap.kpis.refresh && snap.kpis.refresh.failed > 0) {
      partes.push('<div class="vf-banner is-info" data-cm-snapshot-state="itens-falhos"><div class="vf-banner__content"><p class="vf-banner__description">' +
        snap.kpis.refresh.failed + " item(ns) não puderam ser recalculados na última atualização e mostram o valor anterior (marcados na linha).</p></div></div>");
    }
    refs.pageState.innerHTML = partes.join("");
    var start = el("cm-snapshot-start");
    if (start) start.addEventListener("click", requestSnapshotRefresh);
  }

  function renderPageState() {
    if (isSnapshotMode() && !state.error) {
      renderSnapshotPageState();
      return;
    }
    if (!state.client && !state.error) {
      // F2.3 — o Shell (data-vf-scope="client") já bloqueia esta tela
      // enquanto nenhum cliente estiver escolhido; isto é rede de segurança.
      refs.pageState.innerHTML = '<div class="vf-banner is-info"><div class="vf-banner__content"><p class="vf-banner__title">Selecione o contexto da análise</p><p class="vf-banner__description">Escolha um cliente na barra lateral para carregar anúncios, dados financeiros e cobertura de Base.</p></div></div>';
      return;
    }
    if (state.error) {
      var contextError = {
        BASE_MELI_NAO_VINCULADA: { title: "Cliente sem Base vinculada", action: '<a class="vf-btn vf-btn--secondary vf-btn--sm" href="bases.html">Ver em Bases</a>' },
        MULTIPLAS_BASES_MELI: { title: "Vínculo de Base ambíguo", action: '<a class="vf-btn vf-btn--secondary vf-btn--sm" href="bases.html">Ver em Bases</a>' },
        GRANT_ML_NAO_CONECTADO: { title: "Mercado Livre não conectado", action: '<a class="vf-btn vf-btn--secondary vf-btn--sm" href="clientes.html">Ver cliente</a>' },
      }[state.errorCode] || null;
      refs.pageState.innerHTML = '<div class="vf-banner is-danger" role="alert"><div class="vf-banner__content"><p class="vf-banner__title">Não foi possível carregar a Central</p><p class="vf-banner__description">' +
        escapeHtml(state.error) + '</p></div><div class="vf-banner__actions">' + (contextError ? contextError.action : "") + '<button class="vf-btn vf-btn--secondary vf-btn--sm" type="button" id="cm-retry">Tentar novamente</button></div></div>';
      if (contextError) refs.pageState.querySelector(".vf-banner__title").textContent = contextError.title;
      var retry = el("cm-retry");
      // state.client sempre existe aqui: o Shell resolve o cliente antes de
      // qualquer chamada a loadCentral() (aplicarContextoDoShell()).
      if (retry) retry.addEventListener("click", function () { loadCentral(); });
      return;
    }
    if (!state.data || state.loading) {
      refs.pageState.innerHTML = "";
      return;
    }
    var data = state.data;
    if (!data.partial && !(data.warnings || []).length) {
      refs.pageState.innerHTML = "";
      return;
    }
    var warnings = (data.warnings || []).map(function (warning) { return "<li>" + escapeHtml(warning) + "</li>"; }).join("");
    var coverageNote = data.partial
      ? "<p class=\"vf-banner__description\">" + escapeHtml(coverageLabel(data.coverage)) +
        " · cobertura parcial: o catálogo tem mais anúncios do que o teto seguro desta leitura. Filtros, KPIs e divergências consideram só os " +
        (data.coverage && data.coverage.loaded || 0) + " carregados.</p>"
      : "";
    refs.pageState.innerHTML = '<div class="vf-banner is-info"><div class="vf-banner__content"><p class="vf-banner__title">Leitura parcial e rastreável</p><p class="vf-banner__description">Os valores exibidos são reais ou derivados de fontes reais; campos sem fonte permanecem indisponíveis.</p>' +
      coverageNote + (warnings ? "<ul>" + warnings + "</ul>" : "") + "</div></div>";
  }

  function renderSourceStrip() {
    if (!state.data) {
      refs.sourceStrip.innerHTML = '<p class="cm-source-empty">A saúde das fontes aparece depois da primeira leitura.</p>';
      return;
    }
    refs.sourceStrip.innerHTML = contract.sourceHealth(state.data).map(function (source) {
      var meta = SOURCE_STATE_META[source.state] || SOURCE_STATE_META.UNAVAILABLE;
      return '<div class="cm-source"><div class="cm-source__top"><span class="cm-source__name">' + escapeHtml(source.name) +
        '</span><span class="cm-dot ' + meta.className + '" aria-hidden="true"></span></div>' +
        '<p class="cm-source__meta"><span class="cm-source__state">' + escapeHtml(meta.label) + "</span> · " + escapeHtml(source.detail) + "</p></div>";
    }).join("");
  }

  /*
   * Painel "Fontes e cobertura" — responde "de onde vem essa coluna?" e "por
   * que essa célula está indisponível?". A Saúde das fontes (cm-source-strip)
   * responde uma pergunta diferente ("a fonte está disponível?"); este painel
   * é o mapa fonte → variável, estático por design (não muda por item).
   */
  function sourcesTableHtml() {
    var rows = contract.VARIABLES.map(function (variableKey) {
      var meta = contract.VARIABLE_META[variableKey];
      var projected = contract.PRESETS.projected[variableKey];
      var realized = contract.PRESETS.realized[variableKey];
      return "<tr><td>" + escapeHtml(meta.label) + "</td><td>" + escapeHtml(contract.sourceLabel(projected)) +
        "</td><td>" + escapeHtml(contract.sourceLabel(realized)) + "</td></tr>";
    }).join("");
    return '<table class="cm-sources-table"><thead><tr><th>Variável</th><th>Projetado</th><th>Realizado</th></tr></thead><tbody>' +
      rows + "</tbody></table>";
  }

  function renderSourcesPanel() {
    var coverage = (state.data && state.data.coverage) || {};
    var coverageHtml = state.data
      ? '<p class="cm-sources-coverage">' + escapeHtml(coverageLabel(coverage)) +
        (coverage.partial ? " · cobertura parcial do catálogo nesta leitura." : " · cobertura completa nesta leitura.") + "</p>"
      : '<p class="cm-sources-coverage">Selecione um cliente para ver a cobertura desta leitura.</p>';

    refs.sourcesBody.innerHTML =
      '<p class="cm-sources-intro">Cada variável da planilha tem uma fonte PROJETADA (estado atual do anúncio) e uma REALIZADA (o que a venda entregou). Custo, imposto e taxa fixa são declarados na Base e valem para os dois momentos — o Motor não tem uma versão "realizada" separada delas.</p>' +
      coverageHtml + sourcesTableHtml() +
      '<div class="cm-sources-pending">' +
      '<p><strong>Mercado Pago</strong> · recebimento/conciliação — integração pendente. Nenhum valor é inventado; a célula fica indisponível até a integração existir.</p>' +
      '<p><strong>Extensão</strong> · evidência visual — ingestão pendente. O canal de recebimento ainda não existe no backend.</p>' +
      "</div>" +
      '<div class="cm-sources-actions"><a class="vf-btn vf-btn--secondary vf-btn--sm" href="bases.html">Ver na Base</a></div>';
  }

  function openSourcesPanel() {
    renderSourcesPanel();
    state.previousFocus = document.activeElement;
    refs.sourcesOverlay.classList.add("is-open");
    refs.sourcesClose.focus();
  }

  function closeSourcesPanel() {
    refs.sourcesOverlay.classList.remove("is-open");
    if (state.previousFocus && state.previousFocus.focus) state.previousFocus.focus();
  }

  // Modo persistido: placar da CONTA INTEIRA calculado no banco (não da
  // página), pelo status canônico projetado. `null` (missing) vira "—".
  function snapshotKpiValue(key) {
    var kpis = state.snapshot && state.snapshot.kpis;
    if (!kpis) return "—";
    return key === "total" ? kpis.total : kpis.counts[key] || 0;
  }

  function financialCards() {
    if (isSnapshotMode()) {
      return [
        { filter: null, label: "Itens da conta", value: snapshotKpiValue("total"), foot: "leitura persistida", modifier: "" },
        { filter: "HEALTHY", label: "Saudáveis", value: snapshotKpiValue("HEALTHY"), foot: "sem ação imediata", modifier: "is-success" },
        { filter: "LOW_MARGIN", label: "Margem baixa", value: snapshotKpiValue("LOW_MARGIN"), foot: "abaixo da meta", modifier: "is-warning" },
        { filter: "LOSS", label: "Prejuízo", value: snapshotKpiValue("LOSS"), foot: "ação prioritária", modifier: "is-danger" },
      ];
    }
    var summary = state.data ? contract.summarizeItems(state.data.items) : { financial: {} };
    var counts = summary.financial || {};
    var coverage = state.data ? state.data.coverage || {} : {};
    var monitored = coverage.loaded || 0;
    return [
      { filter: null, label: "Carregados", value: monitored, foot: coverageLabel(coverage), modifier: "" },
      { filter: "HEALTHY", label: "Saudáveis", value: counts.HEALTHY || 0, foot: "sem ação imediata", modifier: "is-success" },
      { filter: "LOW_MARGIN", label: "Margem baixa", value: counts.LOW_MARGIN || 0, foot: "abaixo da meta", modifier: "is-warning" },
      { filter: "LOSS", label: "Prejuízo", value: counts.LOSS || 0, foot: "ação prioritária", modifier: "is-danger" },
    ];
  }

  function integrityCards() {
    if (isSnapshotMode()) {
      return [
        { filter: "MISSING", label: "Não validados", value: snapshotKpiValue("UNVALIDATED"), foot: "dado obrigatório ausente", modifier: "" },
        { filter: "SUSPECT", label: "Dados suspeitos", value: snapshotKpiValue("SUSPECT_DATA"), foot: "fontes em conflito", modifier: "is-warning" },
        { filter: "RECONCILING", label: "Em conciliação", value: snapshotKpiValue("RECONCILING"), foot: "realizado ainda aberto", modifier: "is-info" },
      ];
    }
    var summary = state.data ? contract.summarizeItems(state.data.items) : { integrity: {} };
    var counts = summary.integrity || {};
    return [
      { filter: "MISSING", label: "Não validados", value: counts.MISSING || 0, foot: "dado obrigatório ausente", modifier: "" },
      { filter: "SUSPECT", label: "Dados suspeitos", value: counts.SUSPECT || 0, foot: "fontes em conflito", modifier: "is-warning" },
      { filter: "RECONCILING", label: "Em conciliação", value: counts.RECONCILING || 0, foot: "realizado ainda aberto", modifier: "is-info" },
    ];
  }

  function listingCards() {
    var listings = state.snapshot && state.snapshot.kpis && state.snapshot.kpis.listings;
    return [
      { filter: null, label: "Anúncios", value: listings ? listings.total : "—", foot: "conta inteira", modifier: "" },
      { filter: "active", label: "Ativos", value: listings ? listings.active : "—", foot: "em venda", modifier: "is-success" },
      { filter: "paused", label: "Pausados", value: listings ? listings.paused : "—", foot: "fora de venda", modifier: "is-warning" },
    ];
  }

  function kpiHtml(card, attribute, activeValue) {
    var active = card.filter !== null && activeValue === card.filter;
    return '<button type="button" class="cm-kpi ' + card.modifier + (active ? " is-active" : "") + '"' +
      (card.filter === null ? "" : " " + attribute + '="' + card.filter + '"') +
      (card.filter === null ? "" : ' aria-pressed="' + (active ? "true" : "false") + '"') +
      (!state.data || state.loading ? " disabled" : "") + ">" +
      '<span class="cm-kpi__label">' + escapeHtml(card.label) + '</span>' +
      '<strong class="cm-kpi__value">' + escapeHtml(card.value) + "</strong>" +
      '<span class="cm-kpi__foot">' + escapeHtml(card.foot) + "</span></button>";
  }

  function renderSummary() {
    refs.kpisFinancial.innerHTML = financialCards().map(function (card) {
      return kpiHtml(card, "data-financial-filter", state.financial);
    }).join("");
    refs.kpisIntegrity.innerHTML = integrityCards().map(function (card) {
      return kpiHtml(card, "data-integrity-filter", state.integrity);
    }).join("");
    refs.listingSummary.hidden = !isSnapshotMode();
    refs.kpisListing.innerHTML = isSnapshotMode() ? listingCards().map(function (card) {
      return kpiHtml(card, "data-listing-filter", state.listingStatus);
    }).join("") : "";

    if (!state.client) refs.summaryScope.textContent = "Selecione um cliente para iniciar a análise.";
    else if (isSnapshotMode()) {
      refs.summaryScope.textContent = state.snapshot && state.snapshot.kpis
        ? "Placar da conta inteira (" + state.snapshot.kpis.total + " itens), calculado no banco pelo status projetado do Motor — não depende da página nem dos filtros da planilha. O realizado aparece por item, no período."
        : "O placar aparece depois da primeira leitura calculada desta conta.";
    }
    else if (state.loading) refs.summaryScope.textContent = "Atualizando a leitura…";
    else if (!state.data) refs.summaryScope.textContent = "";
    else {
      var coverage = state.data.coverage || {};
      refs.summaryScope.textContent = "Resultado financeiro e integridade do dado são leituras diferentes: um produto pode ter prejuízo com dado confiável, e margem aparentemente saudável com dado suspeito. " +
        "Os dois placares refletem os " + coverageLabel(coverage) + (coverage.partial ? " (cobertura parcial do catálogo)" : "") + ".";
    }
  }

  // ---------------------------------------------------------------------------
  // Topo compacto + Saúde dos dados
  // ---------------------------------------------------------------------------

  function formatMoneyShort(value) {
    var number = contract.numberOrNull(value);
    if (number === null) return null;
    return number.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
  }

  /** Rótulo curto do período do realizado: "30d" (padrão) ou o mês escolhido. */
  function periodShortLabel() {
    if (!state.periodParam) return "30d";
    var parts = state.periodParam.split("-");
    return MESES_CURTOS[Number(parts[1]) - 1] + "/" + parts[0].slice(2);
  }

  function topMetric(label, valueHtml, opts) {
    var o = opts || {};
    var tag = o.filter ? "button" : "div";
    var active = o.filter && state.financial === o.filter;
    return "<" + tag + ' class="cm-topk' + (o.tone ? " " + o.tone : "") + (active ? " is-active" : "") + '"' +
      (o.filter ? ' type="button" data-financial-filter="' + o.filter + '" aria-pressed="' + (active ? "true" : "false") + '"' + (!state.data || state.loading ? " disabled" : "") : "") +
      (o.title ? ' title="' + escapeHtml(o.title) + '"' : "") + ">" +
      '<span class="cm-topk__label">' + escapeHtml(label) + "</span>" +
      '<strong class="cm-topk__value">' + valueHtml + "</strong>" +
      (o.foot ? '<span class="cm-topk__foot">' + escapeHtml(o.foot) + "</span>" : "") + "</" + tag + ">";
  }

  function renderTop() {
    if (!refs.kpisTop) return;
    var contaMeta = root.VF && root.VF.context && root.VF.context.getAccountMeta ? root.VF.context.getAccountMeta() : null;
    refs.topContext.textContent = state.client
      ? state.client.name + (contaMeta ? " · " + (contaMeta.nome || contaMeta.externalAccountLabel || state.contaId) : "")
      : "";
    if (!state.client) {
      refs.kpisTop.innerHTML = "";
      refs.summaryLine.textContent = "Selecione um cliente na barra lateral para iniciar.";
      return;
    }
    var per = periodShortLabel();
    var r = isSnapshotMode() ? state.realizado : null;
    var k = r && r.kpis ? r.kpis : null;
    var semRealizado = isSnapshotMode()
      ? (state.realizadoLoading ? "carregando…" : "sem realizado do período")
      : "disponível na leitura persistida por conta";
    var m = k ? k.margin || {} : {};
    var counts;
    if (isSnapshotMode()) counts = state.snapshot && state.snapshot.kpis ? state.snapshot.kpis.counts : null;
    else counts = state.data ? contract.summarizeItems(state.data.items).financial : null;
    var dash = unavailable("—");
    refs.kpisTop.innerHTML = [
      topMetric("Margem realizada", k && m.percent !== null && m.percent !== undefined ? escapeHtml(formatPercent(m.percent / 100)) : dash,
        { foot: k ? (m.state === "parcial" ? "parcial · " + per : per) : semRealizado, tone: m.state === "parcial" ? "is-warning" : "", title: k ? "Σ lucro ÷ Σ receita dos produtos com margem realizada calculável" : null }),
      topMetric("Receita " + per, k && k.revenue !== null ? escapeHtml(formatMoneyShort(k.revenue)) : dash),
      topMetric("Lucro " + per, k && k.profit !== null ? escapeHtml(formatMoneyShort(k.profit)) : dash, { tone: k && k.profit !== null && k.profit < 0 ? "is-danger" : "" }),
      topMetric("Produtos com venda", k && k.productsWithSales !== null ? escapeHtml(formatInt(k.productsWithSales)) : dash),
      topMetric("Prejuízo", counts ? escapeHtml(String(counts.LOSS || 0)) : dash, { filter: "LOSS", tone: counts && counts.LOSS ? "is-danger" : "", title: "Filtrar produtos em prejuízo (projetado)" }),
      topMetric("Margem baixa", counts ? escapeHtml(String(counts.LOW_MARGIN || 0)) : dash, { filter: "LOW_MARGIN", tone: counts && counts.LOW_MARGIN ? "is-warning" : "", title: "Filtrar produtos abaixo da meta de referência" }),
    ].join("");

    var partes = [];
    if (isSnapshotMode()) {
      var listings = state.snapshot && state.snapshot.kpis && state.snapshot.kpis.listings;
      if (listings) partes.push(listings.total + " anúncios · " + listings.active + " ativos · " + listings.paused + " pausados");
      var calc = state.snapshot && state.snapshot.lastCalculatedAt;
      if (calc) partes.push("Atualizado " + formatShortDateTime(calc));
    } else if (state.data) {
      partes.push(coverageLabel(state.data.coverage));
      if (state.data.lastUpdated) partes.push("Atualizado " + formatShortDateTime(state.data.lastUpdated));
    } else if (state.loading) {
      partes.push("Carregando leitura…");
    }
    refs.summaryLine.textContent = partes.join(" · ");
  }

  function formatShortDateTime(value) {
    var d = new Date(value);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }

  /** Problemas reais de dado (não o que é pendência permanente como Mercado Pago). */
  function healthIssues() {
    var issues = [];
    if (!state.client) return issues;
    if (isSnapshotMode()) {
      var snap = state.snapshot || {};
      if (state.awaitingAccount) issues.push({ tone: "warn", text: "Escolha a operação (conta) para ler a margem persistida." });
      if (snap.state === "missing") issues.push({ tone: "danger", text: "Leitura ainda não calculada para esta conta." });
      var ultimo = state.refreshRun && contract.isRunTerminal(state.refreshRun.status) ? state.refreshRun : snap.lastRun;
      if (ultimo && ultimo.status === "failed" && !runEmAndamento()) issues.push({ tone: "danger", text: "A última atualização falhou (valores do último snapshot válido)." });
      if (snap.kpis && snap.kpis.refresh && snap.kpis.refresh.failed > 0) issues.push({ tone: "warn", text: snap.kpis.refresh.failed + " item(ns) não recalculados na última atualização." });
      var fresh = state.realizado && state.realizado.freshness;
      if (fresh && fresh.state === "PARCIAL") issues.push({ tone: "warn", text: "Realizado parcial: vendas sincronizadas até " + (formatDateBr(fresh.syncedUntil) || "—") + "." });
      if (fresh && fresh.state === "SEM_SINCRONIZACAO") issues.push({ tone: "warn", text: "Nenhuma venda sincronizada no período." });
      if (state.realizadoError) issues.push({ tone: "warn", text: state.realizadoError });
      var counts = snap.kpis && snap.kpis.counts;
      if (counts && (counts.UNVALIDATED || counts.SUSPECT_DATA)) {
        issues.push({ tone: "warn", text: (counts.UNVALIDATED || 0) + " não validados · " + (counts.SUSPECT_DATA || 0) + " com dados suspeitos." });
      }
    } else if (state.data) {
      if (state.data.partial) issues.push({ tone: "warn", text: "Cobertura parcial: " + coverageLabel(state.data.coverage) + "." });
      var integ = contract.summarizeItems(state.data.items).integrity;
      if (integ.MISSING || integ.SUSPECT) issues.push({ tone: "warn", text: (integ.MISSING || 0) + " não validados · " + (integ.SUSPECT || 0) + " com dados suspeitos." });
    }
    if (state.error) issues.push({ tone: "danger", text: state.error });
    return issues;
  }

  function renderHealth() {
    if (!refs.health) return;
    var issues = healthIssues();
    var tone = issues.some(function (i) { return i.tone === "danger"; }) ? "danger" : issues.length ? "warn" : state.data ? "ok" : "off";
    refs.healthDot.className = "cm-health-dot is-" + tone;
    refs.healthCount.textContent = issues.length ? String(issues.length) : "";
    refs.healthToggle.setAttribute("aria-expanded", state.healthOpen ? "true" : "false");
    refs.healthToggle.title = issues.length ? issues.map(function (i) { return i.text; }).join("\n") : "Fontes, cobertura, integridade e freshness sem problemas.";
    refs.health.hidden = !state.healthOpen;
    refs.healthIssues.innerHTML = issues.length
      ? issues.map(function (i) { return '<li class="cm-health__issue is-' + i.tone + '">' + escapeHtml(i.text) + "</li>"; }).join("")
      : (state.data ? '<li class="cm-health__issue is-ok">Tudo certo com as fontes desta leitura.</li>' : "");
  }

  function renderViewToggle() {
    if (!refs.view) return;
    Array.prototype.forEach.call(refs.view.querySelectorAll("[data-view]"), function (button) {
      var active = button.getAttribute("data-view") === state.view;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    refs.compbar.hidden = state.view !== "composition";
  }

  function setView(view) {
    if (view !== "operational" && view !== "composition") return;
    state.view = view;
    renderViewToggle();
    renderSheet();
    if (state.selectedItemId) markSelectedRow();
  }

  // ---------------------------------------------------------------------------
  // Oportunidades (fonte bulk persistida; uma leitura por conta/período)
  // ---------------------------------------------------------------------------

  function loadOpportunities() {
    if (!isSnapshotMode() || !state.client || !state.contaId || typeof api.getOpportunities !== "function") {
      state.opps = null;
      renderOpportunities();
      return;
    }
    state.oppsSequence += 1;
    var seq = state.oppsSequence;
    var slug = state.client.slug;
    var conta = state.contaId;
    state.opps = { status: "loading" };
    renderOpportunities();
    api.getOpportunities({ clientSlug: slug, clienteContaId: conta, periodo: state.periodParam || undefined }).then(function (result) {
      if (seq !== state.oppsSequence || !state.client || state.client.slug !== slug || state.contaId !== conta) return;
      state.opps = result.ok ? Object.assign({ status: "ok" }, result) : { status: "error", error: result.error };
      renderOpportunities();
    });
  }

  function renderOpportunities() {
    if (!refs.opportunities) return;
    var o = state.opps;
    refs.opportunities.hidden = !o;
    if (!o) return;
    if (o.status === "loading") {
      refs.oppsMeta.textContent = "";
      refs.oppsHost.innerHTML = stateHtml("loading", "Carregando oportunidades…");
      return;
    }
    if (o.status === "error") {
      refs.oppsMeta.textContent = "";
      refs.oppsHost.innerHTML = '<p class="cm-empty-note" role="alert">' + escapeHtml(o.error || "Não foi possível carregar as oportunidades.") + "</p>";
      return;
    }
    if (!o.disponivel) {
      refs.oppsMeta.textContent = "depende de uma fonte bulk";
      refs.oppsHost.innerHTML = '<p class="cm-empty-note" data-cm-opps="indisponivel">' + escapeHtml(o.mensagem || "Sem fonte bulk de promoções para esta conta.") +
        ' <a class="cm-link" href="promocoes-retorno.html">Abrir Promoções ML</a></p>';
      return;
    }
    var fonte = o.fonte || {};
    refs.oppsMeta.textContent = "diagnóstico de " + (formatShortDateTime(fonte.geradoEm) || "—") + (fonte.frescor === "antigo" ? " · antigo (>24h)" : fonte.frescor === "atencao" ? " · mais de 6h" : "") + " · estimativa";
    if (!o.oportunidades || !o.oportunidades.length) {
      refs.oppsHost.innerHTML = '<p class="cm-empty-note" data-cm-opps="vazio">Nenhuma promoção disponível com margem pós-promoção positiva nesta conta.</p>';
      return;
    }
    refs.oppsHost.innerHTML = '<div class="vf-table-wrap"><table class="vf-table vf-table--compact cm-opps-table"><thead><tr>' +
      '<th>Produto</th><th class="num">Atual</th><th>Promoção</th><th class="num">Preço promo</th><th class="num">Margem pós</th><th class="num">Vendas</th><th class="num">Retorno ML</th><th>Motivo</th><th><span class="vf-visually-hidden">Ação</span></th>' +
      "</tr></thead><tbody>" + o.oportunidades.map(function (op) {
        return "<tr data-opp=\"" + escapeHtml(op.itemId) + "\">" +
          "<td><strong>" + escapeHtml(op.titulo) + '</strong><span class="cm-prod-meta">' + escapeHtml(op.itemId) + "</span></td>" +
          '<td class="num">' + escapeHtml(formatMoney(op.precoAtual) || "—") + '<span class="cm-prod-meta">' + escapeHtml(op.margemAtual === null ? "—" : formatPercent(op.margemAtual)) + "</span></td>" +
          "<td>" + escapeHtml(op.promocao.nome || op.promocao.tipo || "—") + '<span class="cm-prod-meta">' + escapeHtml(op.promocao.tipo || "") + "</span></td>" +
          '<td class="num">' + escapeHtml(formatMoney(op.precoPromocao) || "—") + "</td>" +
          '<td class="num"><strong class="' + marginClass(op.margemDepois, {}) + '">' + escapeHtml(formatPercent(op.margemDepois) || "—") + "</strong></td>" +
          '<td class="num">' + escapeHtml(formatInt(op.unidades) || "0") + " un.</td>" +
          '<td class="num">' + escapeHtml(op.retornoMl ? formatMoney(op.retornoMl) : "—") + "</td>" +
          '<td class="cm-opps-why">' + escapeHtml(op.motivo || "") + "</td>" +
          '<td class="vf-table__actions"><button class="vf-btn vf-btn--sm" type="button" data-opp-item="' + escapeHtml(op.itemId) + '">Precificar</button></td></tr>';
      }).join("") + "</tbody></table></div>" +
      '<p class="cm-opps-foot">' + escapeHtml(o.criterio || "") + " Margem estimada com a taxa de comissão e o frete atuais; o drawer recota exato.</p>";
  }

  function renderActiveFilters() {
    var chips = [];
    if (state.financial) {
      chips.push('<span class="vf-active-filter">Resultado: ' + escapeHtml(contract.FINANCIAL_RESULTS[state.financial].label) +
        '<button type="button" class="vf-active-filter__remove" data-clear-filter="financial" aria-label="Remover filtro de resultado">×</button></span>');
    }
    if (state.integrity) {
      chips.push('<span class="vf-active-filter">Integridade: ' + escapeHtml(contract.INTEGRITY_STATES[state.integrity].label) +
        '<button type="button" class="vf-active-filter__remove" data-clear-filter="integrity" aria-label="Remover filtro de integridade">×</button></span>');
    }
    if (state.listingStatus) {
      chips.push('<span class="vf-active-filter">Status do anúncio: ' + (state.listingStatus === "active" ? "Ativos" : "Pausados") +
        '<button type="button" class="vf-active-filter__remove" data-clear-filter="listingStatus" aria-label="Remover filtro de status do anúncio">×</button></span>');
    }
    refs.activeFilters.innerHTML = chips.join("");
  }

  /**
   * Filtra o WORKSPACE INTEIRO (todos os itens carregados), nunca uma página.
   * Busca, filtro financeiro e filtro de integridade operam sobre o mesmo
   * array que alimenta KPIs e fila de divergências — uma única varredura.
   */
  function filteredItems() {
    var items = state.data ? state.data.items || [] : [];
    // Persistido: a página JÁ veio filtrada/buscada pelo servidor.
    if (isSnapshotMode()) return items;
    var term = state.search ? state.search.trim().toLowerCase() : "";
    return items.filter(function (item) {
      if (state.financial && contract.financialResult(item).key !== state.financial) return false;
      if (state.integrity && contract.dataIntegrity(item).key !== state.integrity) return false;
      if (term) {
        var haystack = [item.title, item.itemId, item.sku].join(" ").toLowerCase();
        if (haystack.indexOf(term) === -1) return false;
      }
      return true;
    });
  }

  /** Fatia a paginação VISUAL sobre um array já filtrado. Nunca chama a rede. */
  function visibleSlice(items) {
    if (state.visiblePageSize === "all") return items;
    var size = Number(state.visiblePageSize) || 50;
    var totalPages = Math.max(Math.ceil(items.length / size), 1);
    if (state.visiblePage > totalPages) state.visiblePage = totalPages;
    if (state.visiblePage < 1) state.visiblePage = 1;
    var start = (state.visiblePage - 1) * size;
    return items.slice(start, start + size);
  }

  // ---------------------------------------------------------------------------
  // Planilha
  // ---------------------------------------------------------------------------

  function sourceSelectHtml(variableKey) {
    var meta = contract.VARIABLE_META[variableKey];
    var selected = state.selection[variableKey];
    var options = contract.SOURCE_SLOTS[variableKey].map(function (source) {
      return '<option value="' + source + '" title="' + escapeHtml(contract.sourceLabel(source)) + '"' +
        (source === selected ? " selected" : "") + ">" +
        escapeHtml(contract.SOURCE_SELECT_LABELS[source] || contract.SOURCE_SHORT_LABELS[source] || source) + "</option>";
    }).join("");
    var changed = state.preset === "custom" && selected !== contract.PRESETS.projected[variableKey];
    return '<th class="cm-var-head"><span class="cm-head-label">' + escapeHtml(meta.label) + "</span>" +
      '<select class="cm-head-select' + (changed ? " is-changed" : "") + '" data-source-select="' + variableKey +
      '" aria-label="Fonte de ' + escapeHtml(meta.label) + '" title="' + escapeHtml(contract.sourceLabel(selected)) + '">' + options + "</select></th>";
  }

  function sheetHead() {
    return "<tr>" +
      '<th class="cm-product-head"><span class="cm-head-label">Produto</span></th>' +
      contract.VARIABLES.map(sourceSelectHtml).join("") +
      '<th class="num cm-calc-head"><span class="cm-head-label">Margem</span></th>' +
      '<th class="cm-state-head"><span class="cm-head-label">Estado</span></th>' +
      '<th class="cm-diag-head"><span class="cm-head-label">Diagnóstico</span></th>' +
      "</tr>";
  }

  function valueCell(item, variableKey) {
    var source = state.selection[variableKey];
    var entry = contract.sourceEntry(item, variableKey, source);
    if (!entry || !entry.available) {
      return '<td class="num cm-var-cell">' + unavailable("Indisponível", explainUnavailable(variableKey, source)) + "</td>";
    }
    var differs = contract.hasSourceDisagreement(item, variableKey, source);
    return '<td class="num cm-var-cell"><span class="cm-cell-value">' + escapeHtml(formatByVariable(variableKey, entry.value)) + "</span>" +
      '<span class="cm-cell-sub"><span class="cm-cell-meta">' + escapeHtml(entry.sourceShort) + "</span>" +
      (differs ? '<span class="cm-cell-diff" title="Outra fonte disponível diverge deste valor."></span>' : "") + "</span></td>";
  }

  function marginClass(margin, item) {
    if (margin === null) return "";
    if (margin < 0) return "cm-negative";
    var target = item.targetMargin;
    if (target !== null && target !== undefined && margin < target) return "cm-low";
    return "cm-good";
  }

  /**
   * Próxima ação: derivada do estado real do item, na mesma ordem de prioridade
   * que o Motor usa para classificar (dado antes de dinheiro).
   */
  function nextAction(item, integrity, financial, composition) {
    if (integrity.key === "MISSING") {
      return { title: "Completar Base", detail: "Abrir Bases usando o MLB como busca. A Central não escreve custo." };
    }
    if (integrity.key === "SUSPECT") {
      return { title: "Investigar evidências", detail: "Comparar as fontes da variável divergente antes de agir." };
    }
    if (integrity.key === "RECONCILING") {
      return { title: "Aguardar conciliação", detail: "Não tratar o realizado como fechado." };
    }
    if (!composition.computable) {
      return { title: "Completar composição", detail: "Falta " + composition.missing.map(variableLabel).join(", ") + " na fonte selecionada." };
    }
    if (financial.key === "LOSS") {
      return { title: "Revisar preço", detail: "Simular preço mínimo para sair do prejuízo." };
    }
    if (financial.key === "LOW_MARGIN") {
      return { title: "Simular ajuste", detail: "Testar preço para atingir a meta." };
    }
    return { title: "Monitorar", detail: "Nenhuma ação necessária agora." };
  }

  /** Confiança que o Motor informou para a variável desta planilha. */
  function variableConfidence(item, variableKey) {
    var map = item && item.confidenceByVariable;
    return contract.normalizeConfidence(map ? map[variableKey] : null);
  }

  function variableLabel(variableKey) {
    return contract.VARIABLE_META[variableKey] ? contract.VARIABLE_META[variableKey].label.toLowerCase() : variableKey;
  }

  /**
   * Faixa fina de status da linha (produto é a âncora visual). Prioriza o
   * resultado financeiro — é o sinal mais acionável — e cai para integridade
   * quando o financeiro não aponta exceção. Não inventa estado novo: reusa
   * exatamente as chaves que `financialResult`/`dataIntegrity` já expõem.
   */
  function rowStripeTone(financial, integrity) {
    if (financial.key === "LOSS") return "is-danger";
    if (financial.key === "LOW_MARGIN") return "is-warning";
    if (integrity.key === "SUSPECT") return "is-warning";
    if (integrity.key === "RECONCILING") return "is-info";
    if (financial.key === "HEALTHY") return "is-success";
    return "";
  }

  function productThumbHtml(item) {
    if (item.image) {
      return '<span class="cm-product__thumb"><img src="' + escapeHtml(item.image) + '" alt="" loading="lazy" ' +
        'onerror="this.parentElement.classList.add(\'is-fallback\');this.remove();"></span>';
    }
    return '<span class="cm-product__thumb cm-product__thumb--empty" aria-hidden="true"></span>';
  }

  function productCellHtml(item, stripeTone, withSales) {
    var listingStatus = "";
    if (isSnapshotMode()) {
      if (item.statusAnuncio === "active") listingStatus = '<span class="cm-listing-status is-active">● Ativo</span>';
      else if (item.statusAnuncio === "paused") listingStatus = '<span class="cm-listing-status is-paused">⏸ Pausado</span>';
      else listingStatus = '<span class="cm-listing-status">' + escapeHtml(item.statusAnuncio ? "Status: " + item.statusAnuncio : "Status não informado") + "</span>";
    }
    return '<td class="cm-product-cell' + (stripeTone ? " " + stripeTone : "") + '">' +
      '<div class="cm-product">' + productThumbHtml(item) +
      '<div class="cm-product__info"><span class="cm-prod-title">' + escapeHtml(item.title) + "</span>" +
      '<span class="cm-prod-meta">' + escapeHtml(item.itemId || "—") + " · " + escapeHtml(item.sku || "sem SKU") + "</span>" + listingStatus +
      (withSales === false ? "" : salesLineHtml(item)) + "</div>" +
      "</div></td>";
  }

  // Componentes do realizado com cobertura incompleta (backend: cobertura por
  // componente do adapter da Central de Vendas). Só lê — nada é recalculado.
  var COVERAGE_LABELS = { preco: "preço", comissao: "comissão", frete: "frete", custo: "custo", imposto: "imposto" };

  function partialCoverage(coverage) {
    if (!coverage) return [];
    return Object.keys(COVERAGE_LABELS).filter(function (key) {
      var c = coverage[key];
      return c && (c.completa === false || (c.linhasRateadas || 0) > 0);
    }).map(function (key) {
      var c = coverage[key];
      var parte = COVERAGE_LABELS[key] + " " + (c.linhasComValor || 0) + "/" + (c.linhas || 0) + " linhas";
      if (c.fracao !== null && c.fracao !== undefined) parte += " (" + formatPercent(c.fracao) + " das unidades)";
      if (c.linhasRateadas) parte += ", " + c.linhasRateadas + " com frete rateado";
      return parte;
    });
  }

  /** Vendas do período na célula do produto: unidades · pedidos · receita. */
  function salesLineHtml(item) {
    var sales = item.sales || {};
    if (!item.hasOrders) {
      return '<span class="cm-prod-sales is-empty" data-cm-sales="none">sem venda no período</span>';
    }
    // Vendeu, mas o contrato não trouxe as quantidades (adaptador legado):
    // não afirmar nada em vez de dizer "sem venda".
    if (sales.units === null || sales.units === undefined) return "";
    var parcial = partialCoverage(sales.coverage);
    return '<span class="cm-prod-sales" data-cm-sales="' + escapeHtml(String(sales.units)) + '">' +
      "<span>" + escapeHtml(formatInt(sales.units) + " un · " + formatInt(sales.orders || 0) + " ped.") + "</span>" +
      "<span>" + escapeHtml(formatMoney(sales.revenue) || "—") + "</span>" +
      (parcial.length ? '<span class="cm-cell-diff" data-cm-coverage-partial title="' + escapeHtml("Cobertura parcial: " + parcial.join("; ")) + '"></span>' : "") +
      "</span>";
  }

  var COMPARISON_COPY = {
    NO_SALES: "sem venda",
    REALIZED_NOT_COMPUTABLE: "realizado indisponível",
  };

  /**
   * Linha compacta Projetado × Realizado na célula de Margem. Os números são
   * os do Motor (projectedVsRealized); a composição da planilha continua
   * sendo o número principal da célula.
   */
  function comparisonLineHtml(item) {
    var cmp = item.comparison;
    if (!cmp) return "";
    if (cmp.status === "NO_SALES" || cmp.status === "REALIZED_NOT_COMPUTABLE") {
      var titulo = cmp.status === "REALIZED_NOT_COMPUTABLE"
        ? "Houve venda, mas falta " + (cmp.realized.missing || []).map(variableLabel).join(", ") + " histórico para calcular a margem realizada."
        : "Nenhuma venda deste anúncio no período do realizado.";
      return '<span class="cm-cmp-line is-muted" data-cm-cmp="' + escapeHtml(cmp.status) + '" title="' + escapeHtml(titulo) + '">' + escapeHtml(COMPARISON_COPY[cmp.status]) + "</span>";
    }
    var mostrarProjetado = state.preset === "realized";
    var alvo = mostrarProjetado ? cmp.projected : cmp.realized;
    var rotulo = mostrarProjetado ? "proj." : "real.";
    var drift = cmp.drift && cmp.drift.marginPp;
    var tone = drift === null || drift === undefined ? "" : drift < 0 ? " is-negative" : drift > 0 ? " is-positive" : "";
    return '<span class="cm-cmp-line' + tone + '" data-cm-cmp="' + escapeHtml(cmp.status) + '" title="Margem projetada × realizada no período (Δ = realizado − projetado).">' +
      "<span>" + escapeHtml(rotulo + " " + (alvo.margin === null ? "—" : formatPercent(alvo.margin))) + "</span>" +
      (drift === null || drift === undefined ? "" : "<span>" + escapeHtml(formatPp(drift)) + "</span>") + "</span>";
  }

  function rowHtml(item) {
    var composition = contract.resolveComposition(item, state.selection);
    var financial = contract.financialResult(item);
    var integrity = contract.dataIntegrity(item);
    var action = nextAction(item, integrity, financial, composition);
    var stripeTone = rowStripeTone(financial, integrity);
    var assumed = composition.computable && composition.assumed.length
      ? '<span class="cm-cell-meta">assumido 0: ' + escapeHtml(composition.assumed.map(variableLabel).join(", ")) + "</span>"
      : "";

    // Margem: MC é o número que importa (principal, maior); LC é o valor em
    // R$ que sustenta a MC (secundário). Os dois continuam presentes — só
    // compartilham uma coluna em vez de duas.
    var margemCellHtml = (composition.computable
      ? '<span class="cm-cell-value cm-mc-value ' + marginClass(composition.margin, item) + '">' + escapeHtml(formatPercent(composition.margin)) + "</span>" +
        '<span class="cm-cell-sub cm-lc-value"><span class="cm-cell-meta">LC ' + escapeHtml(formatMoney(composition.profit)) + "</span></span>" + assumed
      : unavailable("Indisponível", "Falta " + composition.missing.map(variableLabel).join(", ") + " na composição selecionada.")) +
      comparisonLineHtml(item);

    // Estado: resultado financeiro + integridade do dado continuam sendo DOIS
    // conceitos e dois status — só agrupados visualmente numa coluna.
    var estadoCellHtml = '<div class="cm-state-stack">' + statusTag(financial) + statusTag(integrity) + "</div>";

    // Diagnóstico: problema → próxima ação, sem duas colunas largas de texto.
    // Persistido: item que falhou na última atualização mostra o valor
    // anterior — sinalizado, nunca zerado.
    var snapshotNote = item.snapshot && item.snapshot.refreshStatus === "failed"
      ? '<p class="cm-diag-problem" data-cm-refresh-failed title="' + escapeHtml(item.snapshot.lastError || "") + '">Valor da leitura anterior: a última atualização não recalculou este item.</p>'
      : "";
    var diagCellHtml = snapshotNote + '<p class="cm-diag-problem">' + escapeHtml(item.problem || "Sem problema informado") + "</p>" +
      '<div class="cm-diag-action" title="' + escapeHtml(action.detail) + '"><span class="cm-diag-arrow" aria-hidden="true">→</span><strong>' +
      escapeHtml(action.title) + "</strong></div>";

    return '<tr class="' + (state.selectedItemId === item.id ? "is-selected" : "") + '" data-item-id="' + escapeHtml(item.id) + '" tabindex="0">' +
      productCellHtml(item, stripeTone) +
      contract.VARIABLES.map(function (variableKey) { return valueCell(item, variableKey); }).join("") +
      '<td class="num cm-calc-cell">' + margemCellHtml + "</td>" +
      '<td class="cm-state-cell">' + estadoCellHtml + "</td>" +
      '<td class="cm-diag-cell">' + diagCellHtml + "</td>" +
      "</tr>";
  }

  // --- Visão operacional: decisão primeiro ------------------------------------

  function opHead() {
    return "<tr>" +
      '<th class="cm-product-head"><span class="cm-head-label">Produto</span></th>' +
      '<th class="num cm-op-head"><span class="cm-head-label">Preço</span></th>' +
      '<th class="num cm-op-head"><span class="cm-head-label">Margem proj.</span></th>' +
      '<th class="num cm-op-head"><span class="cm-head-label">Margem real.</span></th>' +
      '<th class="num cm-op-head"><span class="cm-head-label">Δ margem</span></th>' +
      '<th class="num cm-op-head cm-op-head--sales"><span class="cm-head-label">Vendas / receita</span></th>' +
      '<th class="cm-state-head"><span class="cm-head-label">Status</span></th>' +
      '<th class="cm-act-head"><span class="vf-visually-hidden">Ação</span></th>' +
      "</tr>";
  }

  function realizedCellHtml(item) {
    var cmp = item.comparison;
    if (cmp && (cmp.status === "NO_SALES" || cmp.status === "REALIZED_NOT_COMPUTABLE")) {
      var titulo = cmp.status === "REALIZED_NOT_COMPUTABLE"
        ? "Houve venda, mas falta " + (cmp.realized.missing || []).map(variableLabel).join(", ") + " histórico para calcular a margem realizada."
        : "Nenhuma venda deste anúncio no período do realizado.";
      return '<span class="cm-cmp-line is-muted" data-cm-cmp="' + escapeHtml(cmp.status) + '" title="' + escapeHtml(titulo) + '">' + escapeHtml(COMPARISON_COPY[cmp.status]) + "</span>";
    }
    var margin = cmp ? cmp.realized.margin : item.realized && item.realized.margin;
    if (margin === null || margin === undefined) {
      return item.hasOrders ? unavailable("Indisponível") : '<span class="cm-cmp-line is-muted" data-cm-cmp="NO_SALES">sem venda</span>';
    }
    return '<span class="cm-cell-value ' + marginClass(margin, item) + '" data-cm-cmp="' + escapeHtml(cmp ? cmp.status : "REALIZED") + '">' + escapeHtml(formatPercent(margin)) + "</span>";
  }

  function driftCellHtml(item) {
    var drift = item.comparison && item.comparison.drift ? item.comparison.drift.marginPp : null;
    if (drift === null || drift === undefined) return '<span class="cm-muted">—</span>';
    var tone = drift < 0 ? "is-negative" : drift > 0 ? "is-positive" : "";
    return '<span class="cm-drift ' + tone + '" data-cm-drift title="Realizado − projetado, em pontos percentuais">' + escapeHtml(formatPp(drift)) + "</span>";
  }

  function opSalesCellHtml(item) {
    var sales = item.sales || {};
    if (!item.hasOrders) return '<span class="cm-prod-sales is-empty" data-cm-sales="none">sem venda no período</span>';
    if (sales.units === null || sales.units === undefined) return '<span class="cm-muted">—</span>';
    var parcial = partialCoverage(sales.coverage);
    return '<span class="cm-op-sales" data-cm-sales="' + escapeHtml(String(sales.units)) + '">' +
      "<strong>" + escapeHtml(formatInt(sales.units) + " un · " + formatInt(sales.orders || 0) + " ped.") + "</strong>" +
      "<span>" + escapeHtml(formatMoney(sales.revenue) || "—") + "</span>" +
      (parcial.length ? '<span class="cm-cell-diff" data-cm-coverage-partial title="' + escapeHtml("Cobertura parcial: " + parcial.join("; ")) + '"></span>' : "") +
      "</span>";
  }

  function opRowHtml(item) {
    var financial = contract.financialResult(item);
    var integrity = contract.dataIntegrity(item);
    var stripeTone = rowStripeTone(financial, integrity);
    var price = contract.sourceEntry(item, "price", "MELI_API");
    var projected = item.projected ? item.projected.margin : null;
    var divs = item.divergences || [];
    var firstVar = divs.length ? (contract.VARIABLE_META[divs[0].variableKey] ? divs[0].variableKey : "price") : null;
    var refreshFailed = item.snapshot && item.snapshot.refreshStatus === "failed"
      ? '<span class="cm-refresh-failed" data-cm-refresh-failed title="' + escapeHtml("Valor da leitura anterior: a última atualização não recalculou este item. " + (item.snapshot.lastError || "")) + '">valor anterior</span>'
      : "";
    return '<tr class="cm-op-row' + (state.selectedItemId === item.id ? " is-selected" : "") + '" data-item-id="' + escapeHtml(item.id) + '" tabindex="0">' +
      productCellHtml(item, stripeTone, false) +
      '<td class="num">' + (price && price.available ? '<span class="cm-cell-value">' + escapeHtml(formatMoney(price.value)) + "</span>" : unavailable("Indisponível", explainUnavailable("price", "MELI_API"))) + "</td>" +
      '<td class="num">' + (projected === null || projected === undefined
        ? unavailable("Indisponível", item.problem || "Margem projetada não calculável.")
        : '<span class="cm-cell-value cm-mc-value ' + marginClass(projected, item) + '">' + escapeHtml(formatPercent(projected)) + "</span>" +
          (item.projected.profit !== null && item.projected.profit !== undefined ? '<span class="cm-cell-sub"><span class="cm-cell-meta">LC ' + escapeHtml(formatMoney(item.projected.profit)) + "</span></span>" : "")) + "</td>" +
      '<td class="num">' + realizedCellHtml(item) + "</td>" +
      '<td class="num">' + driftCellHtml(item) + "</td>" +
      '<td class="num">' + opSalesCellHtml(item) + "</td>" +
      '<td class="cm-state-cell"><div class="cm-state-stack">' + statusTag(financial) + (integrity.key === "RELIABLE" ? "" : statusTag(integrity)) + refreshFailed + "</div></td>" +
      '<td class="cm-act-cell"><button class="vf-btn vf-btn--sm cm-price-btn" type="button" data-open-item="' + escapeHtml(item.id) + '">Precificar</button>' +
      (divs.length ? '<button class="cm-div-link" type="button" data-open-evidence="' + escapeHtml(item.id) + '" data-evidence-variable="' + escapeHtml(firstVar) + '">' + divs.length + (divs.length === 1 ? " divergência" : " divergências") + "</button>" : "") +
      "</td></tr>";
  }

  /** Tabela da visão atual: Operacional (decisão) ou Composição (fontes). */
  function tableHtml(items) {
    var operational = state.view !== "composition";
    return '<div class="vf-table-wrap cm-table-wrap"><table class="cm-table' + (operational ? " cm-table--op" : " cm-table--comp") + '"><thead>' +
      (operational ? opHead() : sheetHead()) + "</thead><tbody>" + items.map(operational ? opRowHtml : rowHtml).join("") + "</tbody></table></div>";
  }

  function loadingTable() {
    var rows = "";
    for (var i = 0; i < 6; i += 1) {
      rows += '<tr class="vf-table__loading"><td><div class="vf-skeleton vf-skeleton--row"></div></td><td><div class="vf-skeleton vf-skeleton--row"></div></td><td><div class="vf-skeleton vf-skeleton--row"></div></td><td><div class="vf-skeleton vf-skeleton--row"></div></td></tr>';
    }
    return '<div class="vf-table-wrap cm-table-wrap" aria-busy="true"><table class="vf-table vf-table--compact cm-table"><thead><tr><th>Carregando produtos</th><th>Valores</th><th>Fontes</th><th>Situação</th></tr></thead><tbody>' + rows + "</tbody></table></div>";
  }

  function renderSheet() {
    if (state.loading) {
      refs.tableHost.innerHTML = loadingTable();
      refs.pagination.hidden = true;
      refs.resultCount.textContent = "Carregando…";
      return;
    }
    if (!state.client) {
      refs.tableHost.innerHTML = stateHtml("empty", "Nenhum cliente selecionado", "Escolha um cliente no cabeçalho para carregar a planilha operacional.");
      refs.pagination.hidden = true;
      refs.resultCount.textContent = "0 produtos";
      return;
    }
    if (state.error) {
      refs.tableHost.innerHTML = stateHtml("error", "Erro ao carregar os produtos", state.error,
        '<div class="vf-empty__actions"><button class="vf-btn vf-btn--secondary" type="button" id="cm-table-retry">Tentar novamente</button></div>');
      var retry = el("cm-table-retry");
      if (retry) retry.addEventListener("click", function () { loadCentral(); });
      refs.pagination.hidden = true;
      refs.resultCount.textContent = "Erro";
      return;
    }
    if (isSnapshotMode()) {
      renderSnapshotSheet();
      return;
    }
    var items = filteredItems();
    var coverage = (state.data && state.data.coverage) || {};
    refs.resultCount.textContent = items.length + (items.length === 1 ? " resultado" : " resultados") +
      (coverage.loaded ? " de " + coverage.loaded + " carregados" : "");
    if (!items.length) {
      var hasFilters = state.search || state.financial || state.integrity || state.listingStatus;
      refs.tableHost.innerHTML = stateHtml("empty", hasFilters ? "Nenhum resultado" : "Nenhum item monitorado",
        hasFilters ? "Ajuste a busca ou remova os filtros operacionais." : "Sincronize o catálogo em Anúncios ML e atualize esta leitura.",
        hasFilters ? '<div class="vf-empty__actions"><button class="vf-btn vf-btn--secondary" type="button" id="cm-clear-all">Limpar filtros</button></div>' : "");
      var clear = el("cm-clear-all");
      if (clear) clear.addEventListener("click", clearAllFilters);
      refs.pagination.hidden = true;
      return;
    }
    // Paginação VISUAL: fatia o array já filtrado. Não dispara nova leitura.
    var page = visibleSlice(items);
    refs.tableHost.innerHTML = tableHtml(page);
    renderPagination(items.length);
  }

  // Planilha do modo persistido: a página do servidor como veio (já
  // filtrada/buscada/ordenada), paginação real no servidor.
  function renderSnapshotSheet() {
    if (state.awaitingAccount) {
      refs.tableHost.innerHTML = stateHtml("empty", "Escolha a operação", "A leitura persistida é por conta Mercado Livre.");
      refs.pagination.hidden = true;
      refs.resultCount.textContent = "—";
      return;
    }
    if (state.snapshot && state.snapshot.state === "missing") {
      refs.tableHost.innerHTML = stateHtml("empty", "Leitura ainda não calculada",
        runEmAndamento() ? "O cálculo desta conta está em andamento. Os itens aparecem ao final." : "Use \"Atualizar leitura\" para calcular a margem projetada desta conta em background.");
      refs.pagination.hidden = true;
      refs.resultCount.textContent = "sem leitura";
      return;
    }
    var items = state.data ? state.data.items || [] : [];
    var pagination = (state.data && state.data.pagination) || {};
    var total = pagination.total === null || pagination.total === undefined ? items.length : pagination.total;
    refs.resultCount.textContent = total + (total === 1 ? " resultado" : " resultados");
    if (!items.length) {
      var hasFilters = state.search || state.financial || state.integrity || state.listingStatus;
      refs.tableHost.innerHTML = stateHtml("empty", hasFilters ? "Nenhum resultado" : "Nenhum item na leitura desta conta",
        hasFilters ? "Ajuste a busca ou remova os filtros operacionais." : "O último cálculo não encontrou anúncios ativos ou pausados nesta conta.",
        hasFilters ? '<div class="vf-empty__actions"><button class="vf-btn vf-btn--secondary" type="button" id="cm-clear-all">Limpar filtros</button></div>' : "");
      var clear = el("cm-clear-all");
      if (clear) clear.addEventListener("click", clearAllFilters);
      refs.pagination.hidden = true;
      return;
    }
    refs.tableHost.innerHTML = tableHtml(items);
    renderServerPagination(pagination, total);
  }

  function renderServerPagination(pagination, total) {
    var page = pagination.page || 1;
    var limit = pagination.limit || state.serverLimit;
    var totalPages = pagination.totalPages || Math.max(Math.ceil(total / limit), 1);
    var start = total ? (page - 1) * limit + 1 : 0;
    var end = Math.min(page * limit, total);
    refs.pagination.hidden = false;
    refs.pagination.innerHTML = '<span class="vf-pagination__info">' + start + "–" + end + " de " + total +
      '</span><label class="vf-page-size">Por página <select class="vf-select vf-select--sm" id="cm-page-size">' +
      '<option value="50">50</option><option value="100">100</option><option value="200">200</option>' +
      '</select></label><div class="vf-pagination__actions"><button class="vf-btn vf-btn--secondary vf-btn--sm" type="button" id="cm-page-prev"' +
      (page <= 1 ? " disabled" : "") + '>Anterior</button><span class="vf-tag is-neutral">Página ' +
      page + " de " + totalPages + '</span><button class="vf-btn vf-btn--secondary vf-btn--sm" type="button" id="cm-page-next"' +
      (page >= totalPages ? " disabled" : "") + ">Próxima</button></div>";
    var sizeSelect = el("cm-page-size");
    sizeSelect.value = String(limit);
    sizeSelect.addEventListener("change", function () {
      state.serverLimit = Number(sizeSelect.value) || 50;
      state.serverPage = 1;
      loadSnapshotPage();
    });
    el("cm-page-prev").addEventListener("click", function () {
      if (state.serverPage > 1) { state.serverPage -= 1; loadSnapshotPage(); }
    });
    el("cm-page-next").addEventListener("click", function () {
      if (state.serverPage < totalPages) { state.serverPage += 1; loadSnapshotPage(); }
    });
  }

  function clearAllFilters() {
    state.financial = "";
    state.integrity = "";
    state.listingStatus = "";
    state.search = "";
    state.visiblePage = 1;
    refs.search.value = "";
    refs.financialFilter.value = "";
    refs.integrityFilter.value = "";
    refs.listingStatusFilter.value = "";
    if (isSnapshotMode()) {
      onFiltersChanged();
      return;
    }
    renderSummary();
    renderSheet();
    renderDivergences();
    renderActiveFilters();
  }

  /**
   * Paginação 100% visual: 50/100/Todos carregados. Nunca chama a rede —
   * o array já filtrado (`total`) só é reapresentado em fatias diferentes.
   */
  function renderPagination(total) {
    if (!state.data || !total) {
      refs.pagination.hidden = true;
      return;
    }
    var size = state.visiblePageSize === "all" ? total : Number(state.visiblePageSize) || 50;
    var totalPages = Math.max(Math.ceil(total / size), 1);
    if (state.visiblePage > totalPages) state.visiblePage = totalPages;
    var start = total ? (state.visiblePage - 1) * (Number(state.visiblePageSize) || total) + 1 : 0;
    var end = state.visiblePageSize === "all" ? total : Math.min(state.visiblePage * size, total);
    refs.pagination.hidden = false;
    refs.pagination.innerHTML = '<span class="vf-pagination__info">' + start + "–" + end + " de " + total +
      '</span><label class="vf-page-size">Por página <select class="vf-select vf-select--sm" id="cm-page-size">' +
      '<option value="50">50</option><option value="100">100</option><option value="all">Todos carregados</option>' +
      '</select></label><div class="vf-pagination__actions"><button class="vf-btn vf-btn--secondary vf-btn--sm" type="button" id="cm-page-prev"' +
      (state.visiblePage <= 1 || state.visiblePageSize === "all" ? " disabled" : "") + '>Anterior</button><span class="vf-tag is-neutral">Página ' +
      state.visiblePage + " de " + totalPages + '</span><button class="vf-btn vf-btn--secondary vf-btn--sm" type="button" id="cm-page-next"' +
      (state.visiblePage >= totalPages || state.visiblePageSize === "all" ? " disabled" : "") + ">Próxima</button></div>";
    var sizeSelect = el("cm-page-size");
    sizeSelect.value = String(state.visiblePageSize);
    sizeSelect.addEventListener("change", function () {
      state.visiblePageSize = sizeSelect.value === "all" ? "all" : Number(sizeSelect.value) || 50;
      state.visiblePage = 1;
      renderSheet();
    });
    el("cm-page-prev").addEventListener("click", function () {
      if (state.visiblePage > 1) { state.visiblePage -= 1; renderSheet(); }
    });
    el("cm-page-next").addEventListener("click", function () {
      if (state.visiblePage < totalPages) { state.visiblePage += 1; renderSheet(); }
    });
  }

  // ---------------------------------------------------------------------------
  // Fila de divergências
  // ---------------------------------------------------------------------------

  function allDivergenceRows() {
    return contract.divergenceQueue(filteredItems(), state.selection);
  }

  function divergenceRows() {
    var rows = allDivergenceRows();
    return state.criticalOnly ? rows.filter(function (row) { return row.severity === "CRITICA"; }) : rows;
  }

  /**
   * Divergências são informação técnica valiosa, mas não uma 2ª planilha:
   * a página mostra só o resumo (total · críticas · revisar) e a fila completa
   * abre sob demanda. A fila continua renderizada (e navegável) por inteiro.
   */
  function renderDivergences() {
    refs.divergencesToggle.setAttribute("aria-expanded", state.divergencesOpen ? "true" : "false");
    refs.divergencesToggle.textContent = state.divergencesOpen ? "Ocultar divergências" : "Ver divergências";
    refs.divergencesBody.hidden = !state.divergencesOpen;
    if (!state.data || state.loading) {
      refs.divergenceCount.textContent = state.loading ? "comparando fontes…" : "";
      refs.divergencesToggle.disabled = !state.data;
      refs.divergences.innerHTML = state.loading
        ? stateHtml("loading", "Comparando fontes…")
        : stateHtml("empty", "Sem leitura carregada", "A fila de divergências acompanha a leitura carregada.");
      return;
    }
    var todas = allDivergenceRows();
    var criticas = todas.filter(function (row) { return row.severity === "CRITICA"; }).length;
    var coverage = (state.data && state.data.coverage) || {};
    refs.divergencesToggle.disabled = !todas.length;
    refs.divergenceCount.innerHTML = todas.length
      ? "<strong>" + todas.length + (todas.length === 1 ? " divergência" : " divergências") + "</strong>" +
        ' <span class="cm-divs__crit">' + criticas + (criticas === 1 ? " crítica" : " críticas") + "</span> · " + (todas.length - criticas) + " revisar" +
        '<span class="cm-divs__scope">' + escapeHtml(isSnapshotMode() ? " nesta página" : coverage.loaded ? " nos " + coverage.loaded + " carregados" : "") + "</span>"
      : "Nenhuma divergência" + (isSnapshotMode() ? " nesta página" : " na leitura carregada");
    var rows = divergenceRows();
    if (!rows.length) {
      refs.divergences.innerHTML = stateHtml("empty", "Nenhuma divergência no recorte",
        state.criticalOnly ? "Nenhuma divergência crítica no recorte atual." : "As fontes disponíveis concordam dentro da tolerância do Motor.");
      return;
    }
    refs.divergences.innerHTML = '<div class="vf-table-wrap cm-div-wrap"><table class="vf-table vf-table--compact cm-div-table"><thead><tr>' +
      "<th>Produto</th><th>Variável</th><th>Comparação</th><th class=\"num\">Impacto MC</th><th>Severidade</th><th><span class=\"vf-visually-hidden\">Ação</span></th>" +
      "</tr></thead><tbody>" + rows.map(function (row) {
        var impact = row.impactPp === null
          ? unavailable("Sem comparação")
          : '<span class="cm-impact ' + (row.impactPp < 0 ? "is-bad" : Math.abs(row.impactPp) >= 1 ? "is-warn" : "is-good") + '">' + escapeHtml(formatPp(row.impactPp)) + "</span>";
        return "<tr>" +
          '<td><strong>' + escapeHtml(row.title) + '</strong><span class="cm-prod-meta">' + escapeHtml(row.itemId) + " · " + escapeHtml(row.sku || "sem SKU") + "</span></td>" +
          '<td><strong>' + escapeHtml(row.variableLabel) + '</strong><span class="cm-prod-meta">' + escapeHtml(row.selectedSourceLabel) + " × " + escapeHtml(row.alternativeSourceLabel) + "</span></td>" +
          '<td><span class="cm-compare-values">' + escapeHtml(formatByVariable(row.variable, row.selectedValue) || "Indisponível") +
          '<span class="cm-arrow" aria-hidden="true">→</span>' + escapeHtml(formatByVariable(row.variable, row.alternativeValue) || "Indisponível") + "</span>" +
          '<span class="cm-prod-meta">' + escapeHtml(row.type === "DRIFT" ? "Desvio previsto × realizado" : "Conflito entre fontes") +
          (row.origin === "adapter" ? " · derivada na leitura" : "") + "</span></td>" +
          '<td class="num">' + impact + "</td>" +
          "<td>" + (row.severity === "CRITICA"
            ? '<span class="vf-status is-danger">Crítica</span>'
            : '<span class="vf-status is-warning">Revisar</span>') + "</td>" +
          '<td class="vf-table__actions"><button class="vf-btn vf-btn--ghost vf-btn--sm" type="button" data-evidence-item="' + escapeHtml(row.itemId) +
          '" data-evidence-variable="' + escapeHtml(row.variable) + '">Evidências</button></td>' +
          "</tr>";
      }).join("") + "</tbody></table></div>";
  }

  // ---------------------------------------------------------------------------
  // Drawer — resumo fixo + PRECIFICAR · EVIDÊNCIAS · HISTÓRICO
  // ---------------------------------------------------------------------------

  /**
   * Marca a linha aberta sem redesenhar a planilha: redesenhar destruiria o
   * elemento que abriu o drawer e o foco não teria para onde voltar.
   */
  function markSelectedRow() {
    Array.prototype.forEach.call(refs.tableHost.querySelectorAll("tr[data-item-id]"), function (row) {
      row.classList.toggle("is-selected", row.getAttribute("data-item-id") === state.selectedItemId);
    });
  }

  /** Item de Oportunidades fora da página atual: só o essencial para precificar. */
  function stubFromOpportunity(itemId) {
    var list = (state.opps && state.opps.oportunidades) || [];
    var o = list.find(function (entry) { return entry.itemId === itemId; });
    if (!o) return null;
    return {
      id: o.itemId, itemId: o.itemId, title: o.titulo, image: o.imagem || null, sku: null, stub: true,
      stubPrice: o.precoAtual, status: null, statusAnuncio: null, divergences: [], variables: {}, sources: null,
      projected: { margin: o.margemAtual, profit: null }, realized: { margin: null, profit: null, pending: true },
      sales: { units: o.unidades, orders: null, revenue: o.receita }, hasOrders: Boolean(o.unidades), comparison: null,
    };
  }

  function findSelectedItem() {
    if (state.stubItem && state.stubItem.id === state.selectedItemId) return state.stubItem;
    var items = state.data ? state.data.items || [] : [];
    return items.find(function (item) { return item.id === state.selectedItemId; }) || null;
  }

  function initScenario(item) {
    state.scenario = {};
    state.scenarioItemId = item.id;
    contract.VARIABLES.forEach(function (variableKey) {
      state.scenario[variableKey] = { source: state.selection[variableKey], value: null, manual: false };
    });
  }

  /** Preço atual mostrado ao operador — é o `precoVisto` do stale check. */
  function currentPriceOf(item) {
    if (!item) return null;
    if (item.stub) return contract.numberOrNull(item.stubPrice);
    var entry = contract.sourceEntry(item, "price", "MELI_API");
    return entry && entry.available ? entry.value : null;
  }

  function pricingAvailability() {
    if (!state.client) return { ok: false, reason: "Selecione um cliente." };
    if (!state.contaId) return { ok: false, reason: "Escolha a operação (conta Mercado Livre) no topo para precificar: a escrita é sempre por conta." };
    if (typeof api.simulatePricing !== "function" || typeof api.previewPricing !== "function") {
      return { ok: false, reason: "Precificação indisponível nesta leitura." };
    }
    return { ok: true };
  }

  function drawerKey() {
    return [state.client && state.client.slug, state.contaId, state.selectedItemId].join("::");
  }

  /** Novo item (ou novo contexto): tudo que é assíncrono do item anterior morre aqui. */
  function resetItemState(item) {
    state.drawerSeq += 1;
    if (state.pricing && state.pricing.abort) state.pricing.abort.abort();
    if (state.pricing && state.pricing.timer) root.clearTimeout(state.pricing.timer);
    if (state.pricing && state.pricing.pollTimer) root.clearTimeout(state.pricing.pollTimer);
    state.pricing = { novoPreco: "", status: "idle", sim: null, error: null, localError: null, abort: null, timer: null, promoSim: null, aplicacao: null, pollTimer: null, precoAoVivo: null, precoTabela: null };
    state.promos = null;
    state.history = null;
    state.evidenceVariable = state.evidenceVariable || "price";
    if (item) initScenario(item);
    closeConfirm();
  }

  function openDrawer(itemId, tab, variableKey, trigger, opts) {
    var items = filteredItems();
    var item = items.find(function (entry) { return entry.id === itemId; }) || null;
    if (!item && opts && opts.fromOpportunity) {
      item = stubFromOpportunity(itemId);
      state.stubItem = item;
    } else {
      state.stubItem = null;
    }
    if (!item) return;
    if (!refs.drawer.classList.contains("is-open")) state.previousFocus = trigger || document.activeElement;
    var mesmoItem = state.selectedItemId === item.id && refs.drawer.classList.contains("is-open");
    state.selectedItemId = item.id;
    var tabName = DRAWER_TAB_ALIASES[tab] || tab;
    state.drawerTab = DRAWER_TABS.indexOf(tabName) !== -1 ? tabName : "pricing";
    if (variableKey && contract.VARIABLE_META[variableKey]) state.evidenceVariable = variableKey;
    if (!mesmoItem) {
      resetItemState(item);
      loadPromotions();
    }
    refs.drawerBackdrop.classList.add("is-open");
    refs.drawer.classList.add("is-open");
    document.body.classList.add("vf-no-scroll");
    renderDrawer();
    markSelectedRow();
    refs.drawer.focus();
  }

  function closeDrawer() {
    if (!refs.drawer || !refs.drawer.classList.contains("is-open")) return;
    refs.drawer.classList.remove("is-open");
    refs.drawerBackdrop.classList.remove("is-open");
    document.body.classList.remove("vf-no-scroll");
    resetItemState(null);
    // Nada do produto anterior fica no DOM do drawer fechado.
    refs.drawerMeta.innerHTML = "";
    refs.drawerSummary.innerHTML = "";
    refs.drawerBody.innerHTML = "";
    state.selectedItemId = null;
    state.stubItem = null;
    state.scenario = null;
    state.scenarioItemId = null;
    markSelectedRow();
    if (state.previousFocus && typeof state.previousFocus.focus === "function" && document.contains(state.previousFocus)) state.previousFocus.focus();
    state.previousFocus = null;
  }

  function moveDrawer(direction) {
    var items = filteredItems();
    var index = items.findIndex(function (item) { return item.id === state.selectedItemId; });
    var next = index + direction;
    if (next < 0 || next >= items.length) return;
    state.selectedItemId = items[next].id;
    state.stubItem = null;
    resetItemState(items[next]);
    loadPromotions();
    renderDrawer();
    markSelectedRow();
    refs.drawerBody.scrollTop = 0;
  }

  function setDrawerTab(tab) {
    var name = DRAWER_TAB_ALIASES[tab] || tab;
    if (DRAWER_TABS.indexOf(name) === -1) return;
    state.drawerTab = name;
    if (name === "history") loadHistory();
    renderDrawer();
  }

  function panel(title, note, body, extraClass) {
    return '<section class="cm-panel' + (extraClass ? " " + extraClass : "") + '"><header class="cm-panel__head"><h3>' + escapeHtml(title) + "</h3>" +
      (note ? "<span>" + escapeHtml(note) + "</span>" : "") + "</header>" +
      '<div class="cm-panel__body">' + body + "</div></section>";
  }

  function dsumCell(label, valueHtml, foot, tone) {
    return '<div class="cm-dsum__cell' + (tone ? " " + tone : "") + '"><span class="cm-dsum__label">' + escapeHtml(label) + "</span>" +
      '<strong class="cm-dsum__value">' + valueHtml + "</strong>" +
      (foot ? '<span class="cm-dsum__foot">' + escapeHtml(foot) + "</span>" : "") + "</div>";
  }

  function listingStatusHtml(item) {
    if (item.statusAnuncio === "active") return '<span class="cm-listing-status is-active">● Ativo</span>';
    if (item.statusAnuncio === "paused") return '<span class="cm-listing-status is-paused">⏸ Pausado</span>';
    return item.statusAnuncio ? '<span class="cm-listing-status">' + escapeHtml("Status: " + item.statusAnuncio) + "</span>" : "";
  }

  function renderDrawerHeader(item) {
    var financial = contract.financialResult(item);
    var integrity = contract.dataIntegrity(item);
    refs.drawerTitle.textContent = item.title;
    var baseHref = "bases.html?busca=" + encodeURIComponent(item.itemId || item.sku || "");
    refs.drawerMeta.innerHTML = '<span class="vf-mono">' + escapeHtml(item.itemId || "—") + "</span>" +
      '<span>SKU <span class="vf-mono">' + escapeHtml(item.sku || "—") + "</span></span>" +
      listingStatusHtml(item) +
      (item.stub ? "" : statusTag(financial) + statusTag(integrity)) +
      (item.permalink ? '<a class="cm-link" href="' + escapeHtml(item.permalink) + '" target="_blank" rel="noopener">Abrir anúncio</a>' : "") +
      '<a class="cm-link" href="' + escapeHtml(baseHref) + '">Ver na Base</a>';

    // Resumo essencial, sempre visível: pouco texto, números grandes.
    var sim = state.pricing && state.pricing.sim;
    var aplicada = state.pricing && state.pricing.aplicacao;
    var precoAtual = currentPriceOf(item);
    var precoFoot = "leitura da tabela";
    if (aplicada && aplicada.precoConfirmado !== null && aplicada.precoConfirmado !== undefined) {
      precoAtual = aplicada.precoConfirmado;
      precoFoot = "confirmado pelo Mercado Livre";
    } else if (sim && sim.atual && sim.atual.preco !== null && sim.atual.preco !== undefined) {
      precoAtual = sim.atual.preco;
      precoFoot = "confirmado ao vivo";
    } else if (state.pricing && state.pricing.precoAoVivo !== null && state.pricing.precoAoVivo !== undefined) {
      precoAtual = state.pricing.precoAoVivo;
      precoFoot = "confirmado ao vivo";
    }
    var sales = item.sales || {};
    var realized = item.realized && item.realized.margin !== null && item.realized.margin !== undefined
      ? escapeHtml(formatPercent(item.realized.margin))
      : unavailable(item.hasOrders ? "Indisponível" : "Sem venda");
    var aplicacao = state.pricing && state.pricing.aplicacao;
    refs.drawerSummary.innerHTML =
      dsumCell("Preço atual", precoAtual === null ? unavailable("Indisponível") : escapeHtml(formatMoney(precoAtual)), precoFoot) +
      dsumCell("Margem projetada", item.projected && item.projected.margin !== null && item.projected.margin !== undefined
        ? escapeHtml(formatPercent(item.projected.margin)) : unavailable("Indisponível"), null, marginClass(item.projected ? item.projected.margin : null, item)) +
      dsumCell("Margem realizada", realized, null) +
      dsumCell("Vendas", sales.units === null || sales.units === undefined ? unavailable("—") : escapeHtml(formatInt(sales.units) + " un."), periodShortLabel()) +
      dsumCell("Receita", sales.revenue === null || sales.revenue === undefined ? unavailable("—") : escapeHtml(formatMoney(sales.revenue)), periodShortLabel()) +
      (aplicacao ? '<p class="cm-dsum__status" data-cm-pos-escrita="' + escapeHtml(aplicacao.snapshotStatus || "") + '">' + escapeHtml(posEscritaTexto(aplicacao)) + "</p>" : "");
  }

  function posEscritaTexto(aplicacao) {
    var confirmado = aplicacao.precoConfirmado !== null && aplicacao.precoConfirmado !== undefined ? formatMoney(aplicacao.precoConfirmado) : "—";
    if (aplicacao.snapshotStatus === "atualizado") return "Aplicado no Mercado Livre (" + confirmado + ") · margem atualizada.";
    if (aplicacao.snapshotStatus === "falhou") return "Aplicado no Mercado Livre (" + confirmado + ") · a margem não pôde ser recalculada agora; use Atualizar leitura.";
    return "Aplicado no Mercado Livre (" + confirmado + ") · atualizando margem…";
  }

  function renderDrawer() {
    var item = findSelectedItem();
    if (!item) return;
    var items = filteredItems();
    var index = items.findIndex(function (entry) { return entry.id === item.id; });
    renderDrawerHeader(item);
    refs.drawerPrev.disabled = index <= 0;
    refs.drawerNext.disabled = index < 0 || index >= items.length - 1;
    refs.drawerPosition.textContent = index >= 0 ? (index + 1) + " de " + items.length + " produtos neste recorte" : "";

    Array.prototype.forEach.call(refs.drawerTabs.querySelectorAll("[data-tab]"), function (button) {
      var active = button.getAttribute("data-tab") === state.drawerTab;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });

    if (state.drawerTab === "evidence") renderEvidenceTab(item);
    else if (state.drawerTab === "history") renderHistoryTab(item);
    else renderPricingTab(item);
  }

  // --- Precificar ------------------------------------------------------------

  var PRICE_RE = /^\d+([.,]\d{1,2})?$/;

  /** Validação local só para não chamar o backend com lixo; o backend revalida tudo. */
  function parsePriceInput(raw) {
    var text = String(raw || "").trim().replace(/^R\$\s*/, "");
    if (!text) return { ok: false, empty: true };
    if (!PRICE_RE.test(text)) return { ok: false, error: "Use um número com até duas casas decimais." };
    var value = Number(text.replace(",", "."));
    if (!(value > 0)) return { ok: false, error: "O preço precisa ser maior que zero." };
    return { ok: true, value: Math.round(value * 100) / 100 };
  }

  var GATE_ICON = { ok: "✓", warn: "!", block: "×", info: "•" };
  var GATE_TONE = { ok: "is-ok", warn: "is-warn", block: "is-block", info: "is-info" };

  function gatesListHtml(gates, compact) {
    if (!gates || !gates.length) return "";
    var list = compact ? gates.filter(function (g) { return g.tom !== "ok"; }) : gates;
    var okCount = gates.filter(function (g) { return g.tom === "ok"; }).length;
    return '<ul class="cm-gates' + (compact ? " cm-gates--compact" : "") + '">' +
      (compact && okCount ? '<li class="cm-gate is-ok"><span class="cm-gate__icon" aria-hidden="true">✓</span><span>' + okCount + " verificação(ões) ok</span></li>" : "") +
      list.map(function (g) {
        return '<li class="cm-gate ' + (GATE_TONE[g.tom] || "is-info") + '" data-gate="' + escapeHtml(g.id) + '"><span class="cm-gate__icon" aria-hidden="true">' + (GATE_ICON[g.tom] || "•") + "</span>" +
          "<span><strong>" + escapeHtml(g.titulo) + "</strong>" + (g.detalhe ? '<small>' + escapeHtml(g.detalhe) + "</small>" : "") + "</span></li>";
      }).join("") + "</ul>";
  }

  /** Antes → depois. Cor só para resultado (margem/LC); preço é neutro: subir ou descer não é bom nem ruim por si. */
  function deltaRow(label, before, after, fmt, neutral) {
    var b = before === null || before === undefined ? "—" : fmt(before);
    var a = after === null || after === undefined ? "—" : fmt(after);
    var tone = !neutral && before !== null && before !== undefined && after !== null && after !== undefined
      ? (after > before ? " is-up" : after < before ? " is-down" : "") : "";
    return '<div class="cm-delta' + tone + '"><span class="cm-delta__label">' + escapeHtml(label) + "</span>" +
      '<span class="cm-delta__values"><span>' + escapeHtml(b) + '</span><span class="cm-arrow" aria-hidden="true">→</span><strong>' + escapeHtml(a) + "</strong></span></div>";
  }

  var FONTE_COPY = { recotada: "recotada", recotado: "recotado", motor: "do Motor", taxa: "estimada pela taxa", atual: "do preço atual", nao_aplicavel: "combinável", indisponivel: "indisponível" };

  function simResultHtml(sim, kind) {
    var a = sim.atual || {};
    var p = sim.proposta || {};
    var promo = sim.promocao;
    var linhas = deltaRow("Preço", a.preco, p.preco, function (v) { return formatMoney(v); }, true) +
      (kind === "PROMOTION" && promo
        ? '<div class="cm-delta"><span class="cm-delta__label">Desconto</span><span class="cm-delta__values"><strong>' +
          escapeHtml((formatMoney(promo.descontoReais) || "—") + (promo.descontoPercentual !== null && promo.descontoPercentual !== undefined ? " (" + promo.descontoPercentual.toLocaleString("pt-BR") + "%)" : "")) + "</strong></span></div>" +
          '<div class="cm-delta"><span class="cm-delta__label">ML banca</span><span class="cm-delta__values"><strong>' + escapeHtml(formatMoney(promo.mlBanca) || "R$ 0,00") + "</strong></span></div>" +
          '<div class="cm-delta"><span class="cm-delta__label">Seller banca</span><span class="cm-delta__values"><strong>' + escapeHtml(formatMoney(promo.sellerBanca) || "—") + "</strong></span></div>"
        : "") +
      deltaRow("Margem", a.margem, p.margem, function (v) { return formatPercent(v); }) +
      deltaRow("LC / un.", a.lucro, p.lucro, function (v) { return formatMoney(v); }) +
      (p.variacaoPercentual !== null && p.variacaoPercentual !== undefined
        ? '<div class="cm-delta"><span class="cm-delta__label">Variação</span><span class="cm-delta__values"><strong>' + escapeHtml((p.variacaoPercentual > 0 ? "+" : "") + p.variacaoPercentual.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) + "%") + "</strong></span></div>"
        : "");
    var rodape = "Comissão " + (formatMoney(p.comissao) || "—") + " (" + (FONTE_COPY[p.comissaoFonte] || "—") + ") · Frete " +
      (formatMoney(p.frete) || "—") + " (" + (FONTE_COPY[p.freteFonte] || "—") + ")" + (p.rebate ? " · Retorno ML " + formatMoney(p.rebate) : "") + ". Calculado no backend (Motor).";
    return '<div class="cm-sim" data-cm-sim="' + escapeHtml(kind) + '">' + linhas + '<p class="cm-sim__foot">' + escapeHtml(rodape) + "</p></div>" +
      gatesListHtml(sim.gates, true);
  }

  function manualPricingHtml(item) {
    var availability = pricingAvailability();
    var p = state.pricing;
    var sim = p.sim;
    var chips = "";
    if (sim && sim.atual) {
      if (sim.atual.precoAlvo) chips += '<button class="cm-chip" type="button" data-price-chip="' + sim.atual.precoAlvo + '" title="Preço que atinge a meta de referência do Motor">Meta ' + escapeHtml(formatMoney(sim.atual.precoAlvo)) + "</button>";
      if (sim.atual.breakEven) chips += '<button class="cm-chip" type="button" data-price-chip="' + sim.atual.breakEven + '" title="Preço de equilíbrio (LC zero) de referência">Break-even ' + escapeHtml(formatMoney(sim.atual.breakEven)) + "</button>";
    }
    var resultado = "";
    if (!availability.ok) resultado = '<p class="cm-empty-note">' + escapeHtml(availability.reason) + "</p>";
    else if (p.localError) resultado = '<p class="cm-field-error" role="alert">' + escapeHtml(p.localError) + "</p>";
    else if (p.status === "loading") resultado = '<div class="vf-loading-state" role="status"><span class="vf-spinner" aria-hidden="true"></span><span>Calculando no backend…</span></div>';
    else if (p.status === "error") resultado = '<p class="cm-field-error" role="alert">' + escapeHtml(p.error || "Não foi possível simular.") + "</p>";
    else if (p.status === "ok" && sim) resultado = simResultHtml(sim, "PRICE");
    else resultado = '<p class="cm-empty-note">Digite o novo preço para ver margem, LC e os gates antes de qualquer alteração.</p>';

    var podeRevisar = availability.ok && p.status === "ok" && sim && !sim.bloqueado;
    return '<section class="cm-pp" aria-labelledby="cm-pp-title">' +
      '<header class="cm-pp__head"><h3 id="cm-pp-title">Ajuste manual</h3><span>só o preço vira escrita real</span></header>' +
      '<div class="cm-pp__row">' +
      '<div class="cm-pp__field"><span class="cm-pp__label">Preço atual</span><strong class="cm-pp__current">' + escapeHtml(formatMoney(shownPrice(item)) || "—") + "</strong></div>" +
      '<label class="cm-pp__field"><span class="cm-pp__label">Novo preço</span><input class="vf-input vf-input--sm cm-pp__input" id="cm-new-price" inputmode="decimal" autocomplete="off" placeholder="0,00" value="' + escapeHtml(p.novoPreco) + '"' + (availability.ok ? "" : " disabled") + "></label>" +
      (chips ? '<div class="cm-pp__chips">' + chips + "</div>" : "") +
      "</div>" +
      (p.precoAoVivo !== null && p.precoAoVivo !== undefined && p.precoTabela !== null && p.precoTabela !== undefined && Math.abs(p.precoAoVivo - p.precoTabela) >= 0.005
        ? '<p class="cm-live-note" data-cm-live-price>O preço no Mercado Livre mudou desde a última leitura da tabela: ' + escapeHtml(formatMoney(p.precoTabela)) + " → <strong>" + escapeHtml(formatMoney(p.precoAoVivo)) + "</strong> agora. A simulação e o preview usam o preço atual do ML.</p>"
        : "") +
      '<div class="cm-pp__result" id="cm-pp-result" aria-live="polite">' + resultado + "</div>" +
      '<div class="cm-pp__actions"><button class="vf-btn vf-btn--primary vf-btn--sm" type="button" id="cm-pp-review"' + (podeRevisar ? "" : " disabled") + ">Revisar alteração</button></div>" +
      "</section>";
  }

  var PROMO_STATUS_TONE = { "ATIVA": "is-success", "ELEGÍVEL": "is-info", "PROGRAMADA": "is-neutral", "NÃO APLICADA": "is-warning" };

  function formatShortDate(value) {
    if (!value) return null;
    var d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  }

  function promoCardHtml(promo, atual) {
    var status = promo.statusExibicao || promo.status || "—";
    var periodo = [formatShortDate(promo.inicio), formatShortDate(promo.fim)].filter(Boolean).join(" – ");
    var escrita = promo.escrita || {};
    var p = state.pricing;
    var simAberta = p.promoSim && p.promoSim.id === String(promo.id);
    var acao = escrita.suportada
      ? '<button class="vf-btn vf-btn--primary vf-btn--sm" type="button" data-promo-apply="' + escapeHtml(promo.id) + '">' + (escrita.acao === "ALTERAR" ? "Alterar" : "Participar") + "</button>"
      : '<span class="cm-sim-only" title="' + escapeHtml(escrita.motivo || "Somente simulação") + '">Somente simulação</span>';
    var metric = function (label, value) { return '<div class="cm-promo__m"><span>' + escapeHtml(label) + "</span><strong>" + value + "</strong></div>"; };
    var margemAtual = atual && atual.margem !== null && atual.margem !== undefined ? formatPercent(atual.margem) : "—";
    var lcAtual = atual && atual.lucro !== null && atual.lucro !== undefined ? formatMoney(atual.lucro) : "—";
    var simHtml = "";
    if (simAberta) {
      var ps = p.promoSim;
      var editable = escrita.suportada;
      simHtml = '<div class="cm-promo__sim">' +
        (editable ? '<label class="cm-pp__field cm-pp__field--inline"><span class="cm-pp__label">Preço da oferta</span><input class="vf-input vf-input--sm cm-pp__input" data-promo-price="' + escapeHtml(promo.id) + '" inputmode="decimal" value="' + escapeHtml(ps.preco) + '"></label>' : "") +
        (ps.localError ? '<p class="cm-field-error">' + escapeHtml(ps.localError) + "</p>"
          : ps.status === "loading" ? '<div class="vf-loading-state" role="status"><span class="vf-spinner" aria-hidden="true"></span><span>Calculando no backend…</span></div>'
            : ps.status === "error" ? '<p class="cm-field-error" role="alert">' + escapeHtml(ps.error || "Não foi possível simular.") + "</p>"
              : ps.sim ? simResultHtml(ps.sim, "PROMOTION") : "") +
        "</div>";
    }
    return '<article class="cm-promo" data-promo-id="' + escapeHtml(promo.id) + '">' +
      '<header class="cm-promo__head"><div><strong>' + escapeHtml(promo.nome || promo.tipoLabel || promo.tipo || "Promoção") + "</strong>" +
      '<span class="cm-promo__sub">' + escapeHtml([promo.tipoLabel || promo.tipo, periodo].filter(Boolean).join(" · ")) + "</span></div>" +
      '<span class="vf-status ' + (PROMO_STATUS_TONE[status] || "is-neutral") + '" data-promo-status="' + escapeHtml(status) + '">' + escapeHtml(status) + "</span></header>" +
      '<div class="cm-promo__grid">' +
      metric("Preço", escapeHtml((formatMoney(promo.precoOriginal) || "—") + " → " + (formatMoney(promo.precoFinal) || "sem sugestão do ML"))) +
      metric("Desconto", escapeHtml(promo.descontoReais === null || promo.descontoReais === undefined ? "—" : formatMoney(promo.descontoReais) + (promo.descontoPercentual !== null && promo.descontoPercentual !== undefined ? " (" + promo.descontoPercentual.toLocaleString("pt-BR") + "%)" : ""))) +
      metric("Seller banca", escapeHtml(formatMoney(promo.sellerBanca) || "—")) +
      metric("ML banca · retorno", escapeHtml(formatMoney(promo.mlBanca) || "R$ 0,00") + (promo.meliPercentage ? ' <small>' + escapeHtml(promo.meliPercentage.toLocaleString("pt-BR") + "%") + "</small>" : "")) +
      metric("Margem", escapeHtml(margemAtual + " → " + (promo.margem === null || promo.margem === undefined ? "—" : formatPercent(promo.margem)))) +
      metric("LC / un.", escapeHtml(lcAtual + " → " + (promo.lucro === null || promo.lucro === undefined ? "—" : formatMoney(promo.lucro)))) +
      "</div>" +
      '<div class="cm-promo__actions"><button class="vf-btn vf-btn--ghost vf-btn--sm" type="button" data-promo-sim="' + escapeHtml(promo.id) + '"' + (promo.precoFinal === null || promo.precoFinal === undefined ? (escrita.suportada ? "" : " disabled") : "") + ">" + (simAberta ? "Recalcular" : "Simular") + "</button>" + acao + "</div>" +
      simHtml + "</article>";
  }

  function promotionsHtml(item) {
    var availability = pricingAvailability();
    var body;
    var promos = state.promos;
    if (!availability.ok || typeof api.getItemPromotions !== "function") {
      body = '<p class="cm-empty-note">' + escapeHtml(availability.ok ? "Promoções indisponíveis nesta leitura." : availability.reason) + "</p>";
    } else if (!promos || promos.status === "loading") {
      body = '<div class="vf-loading-state" role="status" data-cm-promos="loading"><span class="vf-spinner" aria-hidden="true"></span><span>Consultando promoções no Mercado Livre…</span></div>';
    } else if (promos.status === "error") {
      body = '<p class="cm-field-error" role="alert" data-cm-promos="error">' + escapeHtml(promos.error) + ' <button class="vf-btn vf-btn--ghost vf-btn--sm" type="button" id="cm-promos-retry">Tentar de novo</button></p>';
    } else if (promos.contaCorreta === false) {
      body = gatesListHtml(promos.gates || [], false);
    } else if (!promos.list.length) {
      body = '<p class="cm-empty-note" data-cm-promos="empty">Nenhuma promoção disponível para este anúncio no Mercado Livre.</p>';
    } else {
      body = '<div class="cm-promos__list" data-cm-promos="list">' + promos.list.map(function (promo) { return promoCardHtml(promo, promos.atual); }).join("") + "</div>" +
        (promos.escritaHabilitada ? "" : '<p class="cm-rollout-note">Escrita no Mercado Livre desligada para este cliente (rollout): simulação e preview funcionam; nada é enviado.</p>');
    }
    return '<section class="cm-promos" aria-labelledby="cm-promos-title"><header class="cm-pp__head"><h3 id="cm-promos-title">Promoções do Mercado Livre</h3><span>margem e LC em cada oferta</span></header>' + body + "</section>";
  }

  function advancedSimulationHtml(item) {
    if (item.stub || !state.scenario) return "";
    var simulation = contract.simulateScenario(item, state.scenario, state.selection);
    var rows = contract.VARIABLES.map(function (variableKey) {
      var changed = simulation.changed.indexOf(variableKey) !== -1;
      var inputValue = simulation.values[variableKey] === null ? "" : String(simulation.values[variableKey]);
      return "<tr><td>" + escapeHtml(contract.VARIABLE_META[variableKey].label) + (changed ? ' <span class="cm-changed">alterada</span>' : "") + "</td>" +
        '<td><input class="cm-scenario-input" type="number" step="0.0001" value="' + escapeHtml(inputValue) + '" data-scenario-value="' + variableKey +
        '" aria-label="Valor hipotético de ' + escapeHtml(contract.VARIABLE_META[variableKey].label) + '"></td>' +
        '<td class="cm-scenario-base">' + escapeHtml(formatByVariable(variableKey, simulation.baseline.values[variableKey]) || "Indisponível") + "</td></tr>";
    }).join("");
    return '<details class="cm-adv"' + (state.advancedOpen ? " open" : "") + ' id="cm-adv"><summary>Simulação avançada <small>hipótese local — não é decisão</small></summary>' +
      '<p class="cm-adv__warn"><strong>Somente simulação.</strong> Não grava na Base, não muda comissão, não muda o custo real e não altera nada no Mercado Livre. Só o <strong>preço</strong> pode virar escrita real.</p>' +
      '<div class="vf-table-wrap"><table class="vf-table vf-table--compact cm-scenario-table"><thead><tr><th>Variável</th><th>Hipótese</th><th>Fonte atual</th></tr></thead><tbody>' + rows + "</tbody></table></div>" +
      '<p class="cm-adv__result">Resultado hipotético: LC ' + escapeHtml(simulation.computable ? formatMoney(simulation.profit) : "—") + " · MC " +
      escapeHtml(simulation.computable ? formatPercent(simulation.margin) : "—") +
      (simulation.computable ? "" : " · cenário incompleto: falta " + escapeHtml(simulation.missing.map(variableLabel).join(", "))) + "</p>" +
      '<button class="vf-btn vf-btn--ghost vf-btn--sm" type="button" id="cm-scenario-reset"' + (simulation.changed.length ? "" : " disabled") + ">Restaurar hipótese</button>" +
      "</details>";
  }

  function renderPricingTab(item) {
    refs.drawerBody.innerHTML = manualPricingHtml(item) + advancedSimulationHtml(item) + promotionsHtml(item);
    bindPricingControls(item);
  }

  function bindPricingControls(item) {
    var input = el("cm-new-price");
    if (input) {
      input.addEventListener("input", function () {
        state.pricing.novoPreco = input.value;
        schedulePriceSimulation();
      });
    }
    Array.prototype.forEach.call(refs.drawerBody.querySelectorAll("[data-price-chip]"), function (chip) {
      chip.addEventListener("click", function () {
        state.pricing.novoPreco = Number(chip.getAttribute("data-price-chip")).toFixed(2).replace(".", ",");
        schedulePriceSimulation(0);
        renderDrawer();
      });
    });
    var review = el("cm-pp-review");
    if (review) review.addEventListener("click", function () { reviewPricing("PRICE", null); });
    var adv = el("cm-adv");
    if (adv) adv.addEventListener("toggle", function () { state.advancedOpen = adv.open; });
    Array.prototype.forEach.call(refs.drawerBody.querySelectorAll("[data-scenario-value]"), function (field) {
      field.addEventListener("change", function () {
        var key = field.getAttribute("data-scenario-value");
        var raw = field.value.trim();
        var parsed = raw === "" ? null : Number(raw.replace(",", "."));
        state.scenario[key] = { source: state.scenario[key].source, value: raw === "" || !Number.isFinite(parsed) ? null : parsed, manual: true };
        state.advancedOpen = true;
        renderDrawer();
      });
    });
    var reset = el("cm-scenario-reset");
    if (reset) reset.addEventListener("click", function () { initScenario(item); state.advancedOpen = true; renderDrawer(); });
    var retry = el("cm-promos-retry");
    if (retry) retry.addEventListener("click", function () { loadPromotions(true); });
    Array.prototype.forEach.call(refs.drawerBody.querySelectorAll("[data-promo-sim]"), function (button) {
      button.addEventListener("click", function () { simulatePromotion(button.getAttribute("data-promo-sim")); });
    });
    Array.prototype.forEach.call(refs.drawerBody.querySelectorAll("[data-promo-price]"), function (field) {
      field.addEventListener("change", function () {
        var ps = state.pricing.promoSim;
        if (!ps) return;
        ps.preco = field.value;
        simulatePromotion(field.getAttribute("data-promo-price"), true);
      });
    });
    Array.prototype.forEach.call(refs.drawerBody.querySelectorAll("[data-promo-apply]"), function (button) {
      button.addEventListener("click", function () {
        var id = button.getAttribute("data-promo-apply");
        var promo = promoById(id);
        if (!promo) return;
        // Alterar uma oferta ativa exige escolher o novo preço antes: abre o
        // editor da oferta em vez de pré-visualizar o preço que já está lá.
        var ps = state.pricing && state.pricing.promoSim;
        var alterar = promo.escrita && promo.escrita.acao === "ALTERAR";
        if (alterar && !(ps && ps.id === String(promo.id) && ps.status === "ok")) {
          simulatePromotion(id);
          return;
        }
        reviewPricing("PROMOTION", promo);
      });
    });
  }

  function promoById(id) {
    var list = (state.promos && state.promos.list) || [];
    return list.find(function (promo) { return String(promo.id) === String(id); }) || null;
  }

  /**
   * `precoVisto` = o preço que a tela está MOSTRANDO ao operador. Começa com
   * o da tabela; quando o backend informa o preço vivo do ML e ele difere, a
   * tela passa a exibir o vivo (com aviso) e é ele que vai no preview — o
   * compare-and-set entre preview e aplicar continua valendo.
   */
  function shownPrice(item) {
    var p = state.pricing;
    return p && p.precoAoVivo !== null && p.precoAoVivo !== undefined ? p.precoAoVivo : currentPriceOf(item);
  }

  function adoptLivePrice(livePrice) {
    var p = state.pricing;
    var item = findSelectedItem();
    if (!p || !item || livePrice === null || livePrice === undefined) return false;
    var mostrado = shownPrice(item);
    if (mostrado !== null && Math.abs(Number(livePrice) - mostrado) < 0.005) return false;
    p.precoTabela = currentPriceOf(item);
    p.precoAoVivo = Number(livePrice);
    return true;
  }

  function pricingParams(extra) {
    var item = findSelectedItem();
    return Object.assign({
      clientSlug: state.client && state.client.slug,
      clienteContaId: state.contaId,
      itemId: item && item.itemId,
      precoVisto: shownPrice(item),
    }, extra || {});
  }

  /** Simulação ao vivo com debounce; resposta de outro item/conta ou digitação antiga é descartada. */
  function schedulePriceSimulation(delay) {
    var p = state.pricing;
    if (!p) return;
    if (p.timer) root.clearTimeout(p.timer);
    if (p.abort) p.abort.abort();
    var parsed = parsePriceInput(p.novoPreco);
    p.localError = parsed.ok || parsed.empty ? null : parsed.error;
    if (!parsed.ok) {
      p.simSeq = (p.simSeq || 0) + 1; // resposta pendente de um preço válido anterior não volta
      p.status = "idle";
      p.sim = parsed.empty ? p.sim : null;
      if (parsed.empty) p.sim = null;
      updatePricingResult();
      return;
    }
    if (!pricingAvailability().ok) return;
    p.status = "loading";
    updatePricingResult();
    var seq = state.drawerSeq;
    var key = drawerKey();
    // Sequência própria da simulação: o abort nem sempre chega antes da
    // resposta — a digitação mais recente é sempre a única que renderiza.
    p.simSeq = (p.simSeq || 0) + 1;
    var simSeq = p.simSeq;
    p.timer = root.setTimeout(function () {
      p.timer = null;
      p.abort = typeof AbortController !== "undefined" ? new AbortController() : null;
      api.simulatePricing(pricingParams({ tipo: "PRICE", novoPreco: parsed.value }), p.abort && p.abort.signal).then(function (result) {
        if (seq !== state.drawerSeq || key !== drawerKey() || result.aborted || simSeq !== p.simSeq) return;
        if (!result.ok) {
          p.status = "error";
          p.error = result.error;
          p.sim = null;
        } else {
          p.status = "ok";
          p.sim = result;
          p.error = null;
          // Preço do ML mudou desde a leitura da tabela: mostra o vivo e
          // recalcula com ele (os gates passam a comparar com o que a tela exibe).
          if (result.atual && adoptLivePrice(result.atual.preco)) {
            renderDrawer();
            schedulePriceSimulation(0);
            return;
          }
        }
        renderDrawerHeader(findSelectedItem());
        updatePricingResult();
      });
    }, delay === undefined ? 400 : delay);
  }

  /** Re-renderiza só o resultado (não o input, para não perder o foco/cursor). */
  function updatePricingResult() {
    if (state.drawerTab !== "pricing") return;
    var host = el("cm-pp-result");
    var item = findSelectedItem();
    if (!host || !item) return;
    var temp = document.createElement("div");
    temp.innerHTML = manualPricingHtml(item);
    var fresh = temp.querySelector("#cm-pp-result");
    host.innerHTML = fresh ? fresh.innerHTML : "";
    var review = el("cm-pp-review");
    var freshReview = temp.querySelector("#cm-pp-review");
    if (review && freshReview) review.disabled = freshReview.disabled;
    var chipsNow = temp.querySelector(".cm-pp__chips");
    var chipsHost = refs.drawerBody.querySelector(".cm-pp__chips");
    if (chipsNow && !chipsHost) {
      refs.drawerBody.querySelector(".cm-pp__row").appendChild(chipsNow);
      Array.prototype.forEach.call(chipsNow.querySelectorAll("[data-price-chip]"), function (chip) {
        chip.addEventListener("click", function () {
          state.pricing.novoPreco = Number(chip.getAttribute("data-price-chip")).toFixed(2).replace(".", ",");
          schedulePriceSimulation(0);
          renderDrawer();
        });
      });
    }
  }

  function simulatePromotion(promotionId, keepPrice) {
    var promo = promoById(promotionId);
    var p = state.pricing;
    if (!promo || !p) return;
    if (!p.promoSim || p.promoSim.id !== String(promo.id)) {
      p.promoSim = { id: String(promo.id), preco: promo.precoFinal === null || promo.precoFinal === undefined ? "" : String(promo.precoFinal).replace(".", ","), status: "idle", sim: null, error: null, localError: null };
    }
    var ps = p.promoSim;
    var parsed = parsePriceInput(ps.preco);
    ps.localError = parsed.ok ? null : parsed.empty ? "Informe o preço da oferta para simular." : parsed.error;
    if (!parsed.ok || !pricingAvailability().ok) { renderDrawer(); return; }
    ps.status = "loading";
    ps.seq = (ps.seq || 0) + 1;
    var promoSeq = ps.seq;
    renderDrawer();
    var seq = state.drawerSeq;
    var key = drawerKey();
    api.simulatePricing(pricingParams({ tipo: "PROMOTION", promotionId: promo.id, novoPreco: parsed.value })).then(function (result) {
      if (seq !== state.drawerSeq || key !== drawerKey() || !state.pricing.promoSim || state.pricing.promoSim !== ps || promoSeq !== ps.seq) return;
      ps.status = result.ok ? "ok" : "error";
      ps.sim = result.ok ? result : null;
      ps.error = result.ok ? null : result.error;
      renderDrawer();
    });
  }

  /** Promoções do ITEM ABERTO, em paralelo: o drawer abre antes do ML responder. */
  function loadPromotions(force) {
    if (!pricingAvailability().ok || typeof api.getItemPromotions !== "function") return;
    var item = findSelectedItem();
    if (!item) return;
    if (state.promos && state.promos.status === "ok" && !force) return;
    var seq = state.drawerSeq;
    var key = drawerKey();
    state.promos = { status: "loading" };
    api.getItemPromotions({ clientSlug: state.client.slug, clienteContaId: state.contaId, itemId: item.itemId }).then(function (result) {
      if (seq !== state.drawerSeq || key !== drawerKey()) return;
      state.promos = result.ok
        ? { status: "ok", list: result.promocoes || [], atual: result.atual || null, contaCorreta: result.contaCorreta !== false, gates: result.gates || [], escritaHabilitada: result.escritaHabilitada === true }
        : { status: "error", error: result.error || "Não foi possível carregar as promoções." };
      if (result.ok && result.atual) adoptLivePrice(result.atual.preco);
      if (state.drawerTab === "pricing") renderDrawer();
    });
    if (state.drawerTab === "pricing" && refs.drawer.classList.contains("is-open")) renderDrawer();
  }

  // --- Preview da alteração (confirmação humana) ------------------------------

  function newIdempotencyKey() {
    if (root.crypto && typeof root.crypto.randomUUID === "function") return "cm-" + root.crypto.randomUUID();
    return "cm-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12);
  }

  function reviewPricing(kind, promo) {
    var p = state.pricing;
    if (!p || !pricingAvailability().ok) return;
    var novoPreco = null;
    if (kind === "PRICE") {
      var parsed = parsePriceInput(p.novoPreco);
      if (!parsed.ok) return;
      novoPreco = parsed.value;
    } else if (p.promoSim && p.promoSim.id === String(promo.id)) {
      var parsedPromo = parsePriceInput(p.promoSim.preco);
      novoPreco = parsedPromo.ok ? parsedPromo.value : null;
    }
    var seq = state.drawerSeq;
    var key = drawerKey();
    state.confirm = { kind: kind, promo: promo, status: "loading", preview: null, error: null, idempotencyKey: newIdempotencyKey(), result: null };
    openConfirm();
    api.previewPricing(pricingParams({ tipo: kind, promotionId: promo ? promo.id : undefined, novoPreco: novoPreco })).then(function (result) {
      if (seq !== state.drawerSeq || key !== drawerKey() || !state.confirm) return;
      state.confirm.status = result.ok ? "ready" : "error";
      state.confirm.preview = result.ok ? result : null;
      state.confirm.error = result.ok ? null : result.error;
      renderConfirm();
    });
  }

  function openConfirm() {
    refs.confirmOverlay.classList.add("is-open");
    renderConfirm();
    root.setTimeout(function () { var c = el("cm-confirm-cancel"); if (c) c.focus(); }, 0);
  }

  function closeConfirm() {
    if (state.confirm && state.confirm.status === "applying") return; // nunca fechar no meio da escrita
    state.confirm = null;
    if (refs.confirmOverlay) refs.confirmOverlay.classList.remove("is-open");
  }

  function confirmRow(label, value) {
    return "<tr><th>" + escapeHtml(label) + "</th><td>" + value + "</td></tr>";
  }

  function renderConfirm() {
    var c = state.confirm;
    if (!c) return;
    var item = findSelectedItem();
    if (c.status === "loading") {
      refs.confirmBody.innerHTML = '<div class="vf-loading-state" role="status"><span class="vf-spinner" aria-hidden="true"></span><span>Relendo o anúncio ao vivo e avaliando os gates…</span></div>';
      refs.confirmApply.disabled = true;
      return;
    }
    if (c.status === "error" && !c.preview) {
      refs.confirmBody.innerHTML = '<div class="vf-banner is-danger" role="alert"><div class="vf-banner__content"><p class="vf-banner__title">Não foi possível gerar o preview</p><p class="vf-banner__description">' + escapeHtml(c.error || "Erro desconhecido.") + "</p></div></div>";
      refs.confirmApply.disabled = true;
      return;
    }
    var pv = c.preview;
    var a = pv.atual || {};
    var p = pv.proposta || {};
    var promo = pv.promocao;
    var arrow = function (b, x, fmt) {
      return escapeHtml((b === null || b === undefined ? "—" : fmt(b)) + " → ") + "<strong>" + escapeHtml(x === null || x === undefined ? "—" : fmt(x)) + "</strong>";
    };
    var titulo = c.kind === "PROMOTION"
      ? (promo && promo.escrita && promo.escrita.acao === "ALTERAR" ? "Alterar oferta: " : "Participar de: ") + (promo ? (promo.nome || promo.tipoLabel || promo.tipo) : "promoção")
      : "Alterar preço";
    var rows = confirmRow("Preço", arrow(a.preco, p.preco, formatMoney)) +
      (c.kind === "PROMOTION" && promo
        ? confirmRow("Desconto total", escapeHtml(formatMoney(promo.descontoReais) || "—")) +
          confirmRow("ML banca", escapeHtml(formatMoney(promo.mlBanca) || "R$ 0,00")) +
          confirmRow("Seller banca", escapeHtml(formatMoney(promo.sellerBanca) || "—"))
        : "") +
      confirmRow("Margem", arrow(a.margem, p.margem, formatPercent)) +
      confirmRow("LC / un.", arrow(a.lucro, p.lucro, formatMoney)) +
      confirmRow("Vendas " + periodShortLabel(), escapeHtml(pv.vendas && pv.vendas.unidades !== null && pv.vendas.unidades !== undefined ? formatInt(pv.vendas.unidades) + " un." : "—"));
    var escrita = pv.escrita || {};
    var status = "";
    if (c.status === "applying") status = '<div class="vf-loading-state" role="status"><span class="vf-spinner" aria-hidden="true"></span><span>Aplicando no Mercado Livre… não feche esta janela.</span></div>';
    else if (c.status === "done") status = '<div class="vf-banner is-success" role="status" data-cm-apply-result="aplicado"><div class="vf-banner__content"><p class="vf-banner__title">Aplicado no Mercado Livre</p><p class="vf-banner__description">Preço confirmado pelo Mercado Livre: <strong>' + escapeHtml(formatMoney(c.result.aplicacao.precoConfirmado) || "—") + "</strong>. A margem está sendo recalculada.</p></div></div>";
    else if (c.status === "failed") status = '<div class="vf-banner is-danger" role="alert" data-cm-apply-result="' + escapeHtml(c.result && c.result.aplicacao ? c.result.aplicacao.status : "erro") + '"><div class="vf-banner__content"><p class="vf-banner__title">' + escapeHtml(c.result && c.result.aplicacao && c.result.aplicacao.status === "recusado" ? "Alteração recusada — nada foi alterado" : "A alteração não foi confirmada") + '</p><p class="vf-banner__description">' + escapeHtml(c.error || "") + (c.retryable ? " Você pode tentar de novo com segurança (mesma chave, sem escrita dupla)." : " Gere um novo preview para tentar de novo.") + "</p></div></div>";
    refs.confirmBody.innerHTML =
      '<div class="cm-confirm__who"><strong>' + escapeHtml(pv.item && pv.item.titulo || (item && item.title) || "Produto") + "</strong>" +
      '<span class="vf-mono">' + escapeHtml(pv.item ? pv.item.itemId : "") + "</span>" +
      "<span>" + escapeHtml("Conta " + (pv.conta && pv.conta.nome || "—") + " · Mercado Livre " + (pv.conta && pv.conta.mlUserId || "")) + "</span></div>" +
      '<p class="cm-confirm__what">' + escapeHtml(titulo) + "</p>" +
      '<table class="cm-confirm__table">' + rows + "</table>" +
      '<p class="cm-block-label">Gates</p>' + gatesListHtml((c.result && c.result.gates) || pv.gates, false) +
      (escrita.habilitada ? "" : '<p class="cm-rollout-note" data-cm-rollout="off">' + escapeHtml(escrita.motivo || "Escrita desligada.") + "</p>") +
      status;
    var podeAplicar = c.status === "ready" && !pv.bloqueado && escrita.habilitada && pv.preview && pv.preview.id;
    var podeRetentar = c.status === "failed" && c.retryable;
    refs.confirmApply.disabled = !(podeAplicar || podeRetentar);
    refs.confirmApply.textContent = podeRetentar ? "Tentar de novo" : c.status === "done" ? "Aplicado" : "Confirmar alteração no Mercado Livre";
  }

  /** Aplicar: 1 clique = 1 chave; clique repetido/retry reusa a MESMA chave. */
  function confirmApply() {
    var c = state.confirm;
    if (!c || !c.preview || c.status === "applying" || c.status === "done") return;
    if (c.status !== "ready" && !(c.status === "failed" && c.retryable)) return;
    if (c.preview.bloqueado || !(c.preview.escrita && c.preview.escrita.habilitada)) return;
    c.status = "applying";
    renderConfirm();
    var seq = state.drawerSeq;
    var item = findSelectedItem();
    var promoId = c.kind === "PROMOTION" && c.promo ? c.promo.id : undefined;
    api.applyPricing({
      clientSlug: state.client.slug,
      clienteContaId: state.contaId,
      previewId: c.preview.preview.id,
      idempotencyKey: c.idempotencyKey,
      promotionId: promoId,
    }).then(function (result) {
      var data = result.ok ? result : (result.data || {});
      var aplicacao = data.aplicacao || null;
      if (result.ok && aplicacao && aplicacao.status === "aplicado") {
        c.status = "done";
        c.result = data;
        toast("Aplicado no Mercado Livre: " + (formatMoney(aplicacao.precoConfirmado) || "") + " (valor confirmado pelo ML).", "is-success");
        if (seq === state.drawerSeq && state.pricing) {
          state.pricing.aplicacao = aplicacao;
          // A simulação era do preço anterior: nunca continuar exibindo-a
          // como "confirmada ao vivo" depois da escrita.
          state.pricing.sim = null;
          state.pricing.status = "idle";
          state.pricing.novoPreco = "";
          state.pricing.promoSim = null;
          if (c.kind === "PRICE" && aplicacao.precoConfirmado !== null && aplicacao.precoConfirmado !== undefined) {
            state.pricing.precoTabela = null;
            state.pricing.precoAoVivo = aplicacao.precoConfirmado;
          }
          state.history = null;
          trackPostWrite(aplicacao.id, seq);
          renderDrawer();
        }
      } else {
        c.status = "failed";
        c.result = data;
        c.error = result.error || data.motivo || "A alteração não foi aplicada.";
        // Só erro de rede (sem resposta) é retentável com a mesma chave.
        c.retryable = result.type === "network";
        toast(c.error, "is-danger");
        if (seq === state.drawerSeq) state.history = null;
      }
      if (state.confirm === c) renderConfirm();
      if (item && seq === state.drawerSeq && state.drawerTab === "history") loadHistory(true);
    });
  }

  /** Pós-escrita: acompanha o refresh do snapshot do ITEM e relê a página quando chegar. */
  function trackPostWrite(aplicacaoId, seq) {
    var tentativas = 0;
    var slug = state.client.slug;
    var conta = state.contaId;
    function tick() {
      if (!state.pricing || seq !== state.drawerSeq) return;
      tentativas += 1;
      api.getPricingApplication({ clientSlug: slug, clienteContaId: conta, id: aplicacaoId }).then(function (result) {
        if (!state.pricing || seq !== state.drawerSeq) return;
        if (result.ok && result.aplicacao) {
          state.pricing.aplicacao = result.aplicacao;
          if (result.aplicacao.snapshotStatus === "atualizado" || result.aplicacao.snapshotStatus === "falhou") {
            renderDrawerHeader(findSelectedItem());
            if (result.aplicacao.snapshotStatus === "atualizado" && isSnapshotMode()) {
              toast("Margem recalculada com o preço confirmado.", "is-success");
              loadSnapshotPage();
            }
            return;
          }
        }
        renderDrawerHeader(findSelectedItem());
        if (tentativas < 15) state.pricing.pollTimer = root.setTimeout(tick, POST_WRITE_POLL_MS);
      });
    }
    if (typeof api.getPricingApplication === "function") state.pricing.pollTimer = root.setTimeout(tick, POST_WRITE_POLL_MS);
  }

  // --- Histórico ---------------------------------------------------------------

  function loadHistory(force) {
    var item = findSelectedItem();
    if (!item || typeof api.getPricingHistory !== "function" || !state.client || !state.contaId) return;
    if (state.history && state.history.status !== "error" && !force) return;
    var seq = state.drawerSeq;
    var key = drawerKey();
    state.history = { status: "loading" };
    api.getPricingHistory({ clientSlug: state.client.slug, clienteContaId: state.contaId, itemId: item.itemId }).then(function (result) {
      if (seq !== state.drawerSeq || key !== drawerKey()) return;
      state.history = result.ok ? { status: "ok", list: result.historico || [] } : { status: "error", error: result.error };
      if (state.drawerTab === "history") renderDrawer();
    });
  }

  var HISTORY_STATUS = {
    aplicado: { label: "Aplicado no Mercado Livre", tone: "is-success" },
    recusado: { label: "Recusado — nada foi alterado", tone: "is-warning" },
    falhou: { label: "Não confirmado", tone: "is-danger" },
    aplicando: { label: "Aplicando…", tone: "is-info" },
  };

  function historyEntryHtml(entry) {
    var meta = HISTORY_STATUS[entry.status] || { label: entry.status, tone: "is-neutral" };
    var quando = entry.aplicadoEm || entry.criadoEm;
    var d = quando ? new Date(quando) : null;
    var data = d && !Number.isNaN(d.getTime())
      ? d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) + " · " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
      : "—";
    var quem = entry.usuario && (entry.usuario.nome || entry.usuario.email) || "usuário não identificado";
    var depois = entry.precoConfirmado !== null && entry.precoConfirmado !== undefined ? entry.precoConfirmado : entry.precoSolicitado;
    var oque = entry.tipoAcao === "PROMOTION"
      ? (entry.promotionAcao === "ALTERAR" ? "Alterou oferta: " : "Participou de: ") + (entry.promotionNome || entry.promotionType || entry.promotionId || "promoção")
      : "Preço";
    return '<li class="cm-hist" data-cm-hist="' + escapeHtml(entry.status) + '">' +
      '<div class="cm-hist__head"><span>' + escapeHtml(data + " · " + quem) + '</span><span class="vf-status ' + meta.tone + '">' + escapeHtml(meta.label) + "</span></div>" +
      '<p class="cm-hist__what">' + escapeHtml(oque) + "</p>" +
      '<div class="cm-hist__nums">' +
      deltaRow("Preço", entry.precoAnterior !== null && entry.precoAnterior !== undefined ? entry.precoAnterior : entry.precoVisto, depois, function (v) { return formatMoney(v); }, true) +
      deltaRow("Margem", entry.margemAntes, entry.margemDepois, function (v) { return formatPercent(v); }) +
      "</div>" +
      (entry.status !== "aplicado" && (entry.erroMensagem || entry.erroCodigo)
        ? '<p class="cm-hist__err">' + escapeHtml((entry.erroMensagem || "") + (entry.erroCodigo ? " (" + entry.erroCodigo + ")" : "")) + "</p>"
        : "") +
      "</li>";
  }

  function renderHistoryTab(item) {
    var h = state.history;
    var body;
    if (item.stub || !state.contaId || typeof api.getPricingHistory !== "function") {
      body = '<p class="cm-empty-note">Histórico disponível quando uma conta está selecionada.</p>';
    } else if (!h || h.status === "loading") {
      body = stateHtml("loading", "Carregando histórico…");
    } else if (h.status === "error") {
      body = '<p class="cm-field-error" role="alert">' + escapeHtml(h.error || "Não foi possível carregar o histórico.") + "</p>";
    } else if (!h.list.length) {
      body = '<div class="cm-hist-empty" data-cm-hist-empty><p class="vf-empty__title">Nenhuma alteração feita pela Central</p><p class="vf-empty__description">Quando um preço ou promoção for aplicado por aqui, fica registrado quem, quando, o preço visto, o pedido e o confirmado pelo Mercado Livre.</p></div>';
    } else {
      body = '<ol class="cm-hist-list">' + h.list.map(historyEntryHtml).join("") + "</ol>";
    }
    refs.drawerBody.innerHTML = panel("Histórico de precificação", "auditoria persistida", body) + readTrailHtml(item);
  }

  /** Rastro desta LEITURA (não é histórico): observações que vieram na resposta. */
  function readTrailHtml(item) {
    if (item.stub) return "";
    var audit = item.audit || {};
    var trail = [];
    contract.VARIABLES.forEach(function (variableKey) {
      var bucket = item.sources[variableKey];
      bucket.order.forEach(function (source) {
        var entry = bucket.entries[source];
        if (!entry.available) return;
        trail.push({
          time: entry.observedAt,
          title: contract.sourceLabel(source) + " · " + contract.VARIABLE_META[variableKey].label,
          copy: (entry.kind === "REALIZED" ? "Observação realizada" : "Observação projetada") + " de " + (formatByVariable(variableKey, entry.value) || "—") + (entry.note ? " — " + entry.note : "."),
        });
      });
    });
    trail.sort(function (a, b) { return String(a.time || "") < String(b.time || "") ? -1 : 1; });
    var reasons = (audit.statusReasons || []).concat(audit.qualityReasons || []);
    return '<details class="cm-trail"><summary>Rastro desta leitura <small>metadado da resposta atual, não um log de eventos gravado</small></summary>' +
      (trail.length
        ? '<ol class="cm-audit">' + trail.map(function (entry) {
            return '<li class="cm-audit-row"><span class="cm-audit-time">' + escapeHtml(formatDateTime(entry.time) || "sem horário") + "</span>" +
              '<span class="cm-audit-dot" aria-hidden="true"></span><span class="cm-audit-copy"><strong>' + escapeHtml(entry.title) + "</strong><span>" + escapeHtml(entry.copy) + "</span></span></li>";
          }).join("") + "</ol>"
        : '<p class="cm-empty-note">Nenhuma observação com valor chegou para este produto.</p>') +
      '<p class="cm-empty-note">Status canônico: <strong>' + escapeHtml(item.status) + "</strong>" + (reasons.length ? " · " + escapeHtml(reasons.join(" · ")) : "") + "</p>" +
      '<div class="cm-technical-grid">' +
      techCard("identity.itemId", audit.itemId || item.itemId) +
      techCard("marketplace", (audit.marketplace || item.marketplace || "").toUpperCase()) +
      techCard("sourceMode", state.data && state.data.sourceMode) +
      techCard("última atualização", state.data && formatDateTime(state.data.lastUpdated)) +
      techCard("última venda", formatDateTime(audit.lastSoldAt)) +
      techCard("pedido mais recente", item.latestOrderId) +
      techCard("snapshot calculado em", item.snapshot ? formatDateTime(item.snapshot.calculatedAt) : null) +
      "</div></details>";
  }

  // --- Evidências (enxuta) ----------------------------------------------------

  var EVIDENCE_ORDER = ["price", "cost", "tax", "commission", "freight", "fixedFee"];

  /** Uma linha por variável: selecionada × alternativa × diferença × confiança × horário. */
  function evidenceSummaryRow(item, variableKey) {
    var bucket = item.sources[variableKey];
    var chosenSource = state.selection[variableKey];
    var chosen = bucket.entries[chosenSource];
    var alternative = null;
    bucket.order.forEach(function (source) {
      if (alternative || source === chosenSource) return;
      var entry = bucket.entries[source];
      if (entry && entry.available) alternative = entry;
    });
    var diff = chosen && chosen.available && alternative ? alternative.value - chosen.value : null;
    var flagged = contract.hasSourceDisagreement(item, variableKey, chosenSource);
    var level = variableConfidence(item, variableKey).level;
    var meta = CONFIDENCE_META[level] || CONFIDENCE_META.UNKNOWN;
    return '<tr class="' + (variableKey === state.evidenceVariable ? "is-active" : "") + (flagged ? " is-flagged" : "") + '" data-evidence-var="' + variableKey + '" tabindex="0">' +
      "<th>" + escapeHtml(contract.VARIABLE_META[variableKey].label) + (flagged ? ' <span class="cm-cell-diff" title="Outra fonte diverge"></span>' : "") + "</th>" +
      "<td>" + escapeHtml(contract.SOURCE_SHORT_LABELS[chosenSource] || chosenSource) + '</td><td class="num">' +
      (chosen && chosen.available ? escapeHtml(formatByVariable(variableKey, chosen.value)) : unavailable("—")) + "</td>" +
      "<td>" + escapeHtml(alternative ? alternative.sourceShort : "—") + '</td><td class="num">' + escapeHtml(alternative ? formatByVariable(variableKey, alternative.value) : "—") + "</td>" +
      '<td class="num">' + escapeHtml(diff === null ? "—" : (contract.VARIABLE_META[variableKey].format === "percent" ? formatPp(diff * 100) : formatMoney(diff, true))) + "</td>" +
      '<td><span class="vf-status ' + meta.className + '">' + escapeHtml(meta.label) + "</span></td>" +
      '<td class="cm-ev-time">' + escapeHtml(formatDateTime(chosen && chosen.observedAt) || "—") + "</td></tr>";
  }

  function renderEvidenceTab(item) {
    if (item.stub) {
      refs.drawerBody.innerHTML = '<p class="cm-empty-note">Evidências completas ficam disponíveis quando o produto é aberto pela tabela (esta linha veio de Oportunidades, fora da página atual).</p>';
      return;
    }
    var variableKey = contract.VARIABLE_META[state.evidenceVariable] ? state.evidenceVariable : "price";
    var bucket = item.sources[variableKey];
    var chosenSource = state.selection[variableKey];
    var chosen = bucket.entries[chosenSource];
    var motor = (item.motorChoice && item.motorChoice[variableKey]) || { available: false, source: null, value: null, sourceLabel: null };
    var disagreement = contract.hasSourceDisagreement(item, variableKey, chosenSource);

    var summary = '<div class="vf-table-wrap"><table class="vf-table vf-table--compact cm-ev-table" role="grid"><thead><tr>' +
      "<th>Variável</th><th>Fonte selecionada</th><th class=\"num\">Valor</th><th>Alternativa</th><th class=\"num\">Valor</th><th class=\"num\">Diferença</th><th>Confiança</th><th>Observado</th>" +
      "</tr></thead><tbody>" + EVIDENCE_ORDER.map(function (key) { return evidenceSummaryRow(item, key); }).join("") + "</tbody></table></div>";

    var cards = bucket.order.map(function (source) {
      var entry = bucket.entries[source];
      var role = evidenceRole(item, variableKey, source, chosenSource);
      return '<article class="cm-evidence-card ' + role.className + '">' +
        '<p class="cm-evidence-card__source">' + escapeHtml(entry.sourceLabel) + ' <span class="cm-evidence-role">' + escapeHtml(role.label) + "</span></p>" +
        '<p class="cm-evidence-card__value">' + (entry.available ? escapeHtml(formatByVariable(variableKey, entry.value)) : unavailable("Sem observação")) + "</p>" +
        '<dl class="cm-evidence-card__meta"><dt>observedAt</dt><dd>' + escapeHtml(formatDateTime(entry.observedAt) || "Não informado") + "</dd>" +
        "<dt>effectiveAt</dt><dd>Não informado</dd>" +
        "<dt>Momento</dt><dd>" + escapeHtml(entry.kind === "REALIZED" ? "Realizado" : entry.kind === "PROJECTED" ? "Projetado" : "Não informado") + "</dd>" +
        "<dt>Qualidade</dt><dd>" + escapeHtml(entry.quality || "Não informada") + "</dd>" +
        (entry.note ? "<dt>Detalhe</dt><dd>" + escapeHtml(entry.note) + "</dd>" : "") + "</dl></article>";
    }).join("");

    var why = (EVIDENCE_WHY[variableKey] && EVIDENCE_WHY[variableKey][chosenSource]) || "Fonte selecionada para esta variável.";
    if (!chosen || !chosen.available) why = "Esta fonte não observou a variável nesta leitura: o valor fica indisponível — não é zero.";
    else if (disagreement) why += " Outra fonte informa valor diferente além da tolerância do Motor.";

    var detail = '<div class="cm-ev-detail"><div class="cm-evidence-cards">' + cards + "</div>" +
      '<aside class="cm-motor-decision"><span>Evidências de ' + escapeHtml(contract.VARIABLE_META[variableKey].label) + "</span>" +
      "<strong>" + (chosen && chosen.available ? escapeHtml(formatByVariable(variableKey, chosen.value)) : unavailable("Indisponível")) + "</strong>" +
      "<p>" + escapeHtml(why) + "</p>" +
      "<dl><dt>Selecionada</dt><dd>" + escapeHtml(contract.sourceLabel(chosenSource)) + "</dd>" +
      "<dt>Conflito</dt><dd>" + (disagreement ? "Sim" : "Não") + "</dd>" +
      (motor.available && motor.source !== chosenSource
        ? "<dt>Escolha do Motor</dt><dd>" + escapeHtml(formatByVariable(variableKey, motor.value)) + " · " + escapeHtml(motor.sourceLabel) + "</dd>"
        : "<dt>Escolha do Motor</dt><dd>" + (motor.available ? "mesma fonte" : "sem valor selecionado") + "</dd>") +
      "</dl></aside></div>";

    var receipt = '<div class="cm-receipt-line"><span>Recebimento líquido: ' + unavailable("Não integrado", "Mercado Pago não integrado ao backend.") + "</span>" +
      "<span>Conciliação: " + escapeHtml(item.reconciliation || "Pendente") + "</span>" +
      '<button class="vf-btn vf-btn--ghost vf-btn--sm" type="button" disabled title="Integração de recebimentos indisponível no backend.">Mercado Pago</button></div>';

    refs.drawerBody.innerHTML = panel("Evidências por variável", "clique numa linha para o detalhe", summary + detail) +
      comparisonPanelHtml(item) + receipt;

    Array.prototype.forEach.call(refs.drawerBody.querySelectorAll("[data-evidence-var]"), function (row) {
      function choose() { state.evidenceVariable = row.getAttribute("data-evidence-var"); renderDrawer(); }
      row.addEventListener("click", choose);
      row.addEventListener("keydown", function (event) { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); choose(); } });
    });
  }

  var COMPARISON_ROWS = [
    { key: "price", label: "Preço (médio vendido no realizado)", format: "money" },
    { key: "commission", label: "Comissão / un.", format: "money" },
    { key: "freight", label: "Frete / un.", format: "money" },
    { key: "cost", label: "Custo / un.", format: "money" },
    { key: "taxRate", label: "Imposto", format: "percent" },
    { key: "fixedFee", label: "Taxa fixa / un.", format: "money" },
  ];

  function cmpValue(format, value) {
    if (value === null || value === undefined) return null;
    return format === "percent" ? formatPercent(value) : formatMoney(value);
  }

  function cmpDrift(format, row, drift) {
    if (!drift) return null;
    if (format === "percent") return drift.taxRatePp === null || drift.taxRatePp === undefined ? null : formatPp(drift.taxRatePp);
    var v = drift[row.key];
    return v === null || v === undefined ? null : formatMoney(v, true);
  }

  /** Painel Projetado × Realizado — exibe o bloco do Motor, sem recalcular. */
  function comparisonPanelHtml(item) {
    var cmp = item.comparison;
    var periodo = (state.data && state.data.period && state.data.period.label) || (state.realizado && state.realizado.period && state.realizado.period.label) || "período do realizado";
    if (!cmp) {
      return panel("Projetado × Realizado", periodo, '<p class="cm-empty-note">O backend não enviou a comparação para este item.</p>');
    }
    if (cmp.status === "NO_SALES") {
      return panel("Projetado × Realizado", periodo,
        '<p class="cm-empty-note" data-cm-cmp-panel="NO_SALES">Sem venda deste anúncio no período. O realizado não existe — não é zero. Projetado atual: ' +
        escapeHtml(cmp.projected.margin === null ? "indisponível" : formatPercent(cmp.projected.margin)) + ".</p>");
    }
    var drift = cmp.drift || {};
    var linhas = COMPARISON_ROWS.map(function (row) {
      var proj = cmpValue(row.format, cmp.projected[row.key]);
      var real = cmpValue(row.format, cmp.realized[row.key]);
      var semHistorico = row.key === "fixedFee" && cmp.notComparable.some(function (n) { return n.field === "fixedFee"; });
      return "<tr><td>" + escapeHtml(row.label) + '</td><td class="num">' + (proj === null ? unavailable("—") : escapeHtml(proj)) +
        '</td><td class="num">' + (real === null ? unavailable(semHistorico ? "sem histórico" : "—", semHistorico ? "A Central de Vendas não guarda taxa fixa histórica: o realizado não a desconta." : null) : escapeHtml(real)) +
        '</td><td class="num">' + escapeHtml(cmpDrift(row.format, row, drift) || "—") + "</td></tr>";
    }).join("");
    var margemRow = '<tr class="cm-cmp-total"><td>Lucro / un.</td><td class="num">' + escapeHtml(formatMoney(cmp.projected.profit) || "—") +
      '</td><td class="num">' + escapeHtml(formatMoney(cmp.realized.profit) || "—") + '</td><td class="num">' + escapeHtml(formatMoney(drift.profit, true) || "—") + "</td></tr>" +
      '<tr class="cm-cmp-total"><td>Margem</td><td class="num">' + escapeHtml(cmp.projected.margin === null ? "—" : formatPercent(cmp.projected.margin)) +
      '</td><td class="num">' + escapeHtml(cmp.realized.margin === null ? "—" : formatPercent(cmp.realized.margin)) +
      '</td><td class="num"><strong>' + escapeHtml(formatPp(drift.marginPp) || "—") + "</strong></td></tr>";
    var sales = item.sales || {};
    var parcial = partialCoverage(cmp.realized.coverage);
    var fatos = [
      "<li>" + escapeHtml(formatInt(cmp.realized.units) + " unidade(s) · " + formatInt(cmp.realized.orders || 0) + " pedido(s) · receita " + (formatMoney(cmp.realized.revenue) || "—") +
        (cmp.realized.lastSaleAt ? " · última venda " + formatDateBr(cmp.realized.lastSaleAt) : "")) + "</li>",
    ];
    if (cmp.status === "REALIZED_NOT_COMPUTABLE") {
      fatos.push("<li>Margem realizada indisponível: falta " + escapeHtml((cmp.realized.missing || []).map(variableLabel).join(", ")) + " histórico nas vendas do período.</li>");
    }
    if (cmp.realized.assumed && cmp.realized.assumed.length) {
      fatos.push("<li>Assumido 0 no realizado: " + escapeHtml(cmp.realized.assumed.map(variableLabel).join(", ")) + ".</li>");
    }
    fatos.push("<li>" + escapeHtml(parcial.length ? "Cobertura parcial — " + parcial.join("; ") + ". Valores por unidade são a média das vendas com o dado." : "Cobertura completa dos componentes nas vendas do período.") + "</li>");
    if (sales.refund && sales.refund.total) {
      fatos.push("<li>Reembolso atribuído ao anúncio: " + escapeHtml(formatMoney(sales.refund.total) + " em " + sales.refund.pedidos + " pedido(s)") + " — conciliação, fora da margem.</li>");
    }
    if (sales.persistedResult !== null && sales.persistedResult !== undefined) {
      fatos.push("<li>Contraprova: resultado persistido pela Central de Vendas " + escapeHtml(formatMoney(sales.persistedResult)) +
        " × recalculado pelo Motor " + escapeHtml(formatMoney(sales.recalculatedResult) || "—") + " (a Central de Vendas não desconta taxa fixa).</li>");
    }
    return panel("Projetado × Realizado", periodo,
      '<div class="vf-table-wrap"><table class="vf-table vf-table--compact cm-cmp-table" data-cm-cmp-panel="' + escapeHtml(cmp.status) + '"><thead><tr><th>Componente</th><th class="num">Projetado</th><th class="num">Realizado</th><th class="num">Desvio</th></tr></thead><tbody>' +
      linhas + margemRow + "</tbody></table></div>" +
      '<ul class="cm-cmp-facts">' + fatos.join("") + "</ul>");
  }

  var EVIDENCE_WHY = {
    price: {
      MELI_API: "O preço da API representa o anúncio neste momento.",
      MELI_ORDER: "A última venda representa o preço efetivamente praticado no pedido.",
      EXTENSION_DOM: "A extensão é evidência visual e funciona como verificação independente.",
    },
    cost: {
      VENFORCE_BASE: "Custo declarado HOJE na Base vinculada. A Central apenas lê esse valor.",
      VENFORCE_BASE_HIST: "Custo que a Base tinha no momento da venda, gravado pela Central de Vendas. Mudar a Base hoje não altera este valor.",
    },
    tax: {
      VENFORCE_BASE: "Percentual de imposto declarado HOJE na Base vinculada.",
      VENFORCE_BASE_HIST: "Alíquota histórica: imposto gravado na venda ÷ receita das mesmas vendas.",
    },
    commission: {
      MELI_API: "Tarifa prevista da API, usada para projetar a margem do anúncio.",
      MELI_ORDER: "Tarifa realizada do pedido: evidência do que foi efetivamente cobrado.",
    },
    freight: {
      MELI_API: "Frete previsto serve para projeção e comparação com o realizado.",
      MELI_ORDER: "Frete realizado é evidência do que ocorreu no shipment.",
      EXTENSION_DOM: "Leitura visual do frete exibido na página do anúncio.",
    },
    fixedFee: {
      VENFORCE_BASE: "Taxa fixa declarada na Base vinculada.",
      VENFORCE_BASE_HIST: "Não existe taxa fixa histórica: o realizado não a desconta.",
    },
  };

  function evidenceRole(item, variableKey, source, chosenSource) {
    var bucket = item.sources[variableKey];
    var entry = bucket.entries[source];
    var chosen = bucket.entries[chosenSource];
    if (source === chosenSource) return { label: "Selecionada", className: "is-selected" };
    if (!entry || !entry.available) return { label: "Ausente", className: "is-absent" };
    if (!chosen || !chosen.available) return { label: "Disponível", className: "" };
    return contract.hasSourceDisagreement(item, variableKey, chosenSource) &&
      Math.abs(entry.value - chosen.value) > 0
      ? { label: "Conflito", className: "is-conflict" }
      : { label: "Confirma", className: "" };
  }

  function techCard(label, value) {
    return '<div class="cm-tech"><span>' + escapeHtml(label) + "</span><strong>" +
      (value === null || value === undefined || value === "" ? "Não informado" : escapeHtml(value)) + "</strong></div>";
  }


  // ---------------------------------------------------------------------------

  function init() {
    cacheRefs();
    state.token = root.localStorage && root.localStorage.getItem("vf-token");
    if (typeof root.initLayout === "function") root.initLayout();
    bindEvents();
    syncPresetButtons();
    if (!state.token && !root.__VF_CENTRAL_MARGEM_API_CLIENT__) {
      state.error = "Sessão não encontrada. Faça login novamente.";
      renderAll();
      return;
    }
    renderAll();
    document.addEventListener("vf:context", function (event) { aplicarContextoDoShell(event.detail); });
  }

  root.VFCentralMargemUi = {
    getState: function () { return state; },
    filteredItems: filteredItems,
    openDrawer: openDrawer,
    closeDrawer: closeDrawer,
    setDrawerTab: setDrawerTab,
    applyPreset: applyPreset,
    reload: loadCentral,
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})(window);
