/*
 * Central de Margem — experiência operacional em JavaScript puro.
 *
 * A tela tem quatro camadas, nesta ordem de leitura:
 *   PLANILHA    trabalhar com muitos produtos
 *   RESUMO      entender o problema de um produto
 *   CENÁRIO     testar uma hipótese
 *   EVIDÊNCIAS  entender por que o Motor escolheu cada dado
 *   AUDITORIA   descobrir de onde os dados vieram
 *
 * Todo número vem de `central-margem-api.js`, que é o contrato único.
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
    realized: "Último preço vendido + comissão e frete realizados do pedido. Custo, imposto e taxa fixa continuam vindo da Base: o Motor não possui versão realizada dessas variáveis declaradas.",
    custom: "Uma ou mais fontes foram alteradas manualmente no cabeçalho. A composição exibida não corresponde a nenhum preset.",
  };

  var SOURCE_STATE_META = {
    OK: { label: "OK", className: "is-ok" },
    PARTIAL: { label: "Parcial", className: "is-warn" },
    PENDING: { label: "Pendente", className: "is-off" },
    UNAVAILABLE: { label: "Indisponível", className: "is-off" },
  };

  var PRESET_LABELS = { projected: "Projetado", realized: "Realizado", custom: "Personalizado" };

  var DRAWER_TABS = ["summary", "scenario", "evidence", "audit"];

  var state = {
    token: null,
    clients: [],
    client: null,
    marketplace: "meli",
    search: "",
    financial: "",
    integrity: "",
    selection: contract.clonePreset("projected"),
    preset: "projected",
    criticalOnly: false,
    page: 1,
    limit: 20,
    loading: false,
    data: null,
    error: null,
    errorCode: null,
    searchTimer: null,
    requestSequence: 0,
    abortController: null,
    selectedItemId: null,
    drawerTab: "summary",
    evidenceVariable: "price",
    scenario: null,
    scenarioItemId: null,
    previousFocus: null,
  };

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

  function formatDateTime(value) {
    if (!value) return null;
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleDateString("pt-BR") + " às " + date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }

  /** Ausência é informação: nunca vira zero, nunca vira traço mudo. */
  function unavailable(label, title) {
    return '<span class="cm-unavailable"' + (title ? ' title="' + escapeHtml(title) + '"' : "") +
      ">" + escapeHtml(label || "Indisponível") + "</span>";
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
    refs.client = el("cm-client");
    refs.marketplace = el("cm-marketplace");
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
    refs.kpisFinancial = el("cm-kpis-financial");
    refs.kpisIntegrity = el("cm-kpis-integrity");
    refs.summaryScope = el("cm-summary-scope");
    refs.restoreSources = el("cm-restore-sources");
    refs.financialFilter = el("cm-financial-filter");
    refs.integrityFilter = el("cm-integrity-filter");
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
    refs.scenarioReset = el("cm-scenario-reset");
    refs.applyScenario = el("cm-apply-scenario");
    refs.toasts = el("cm-toasts");
  }

  // ---------------------------------------------------------------------------
  // Eventos
  // ---------------------------------------------------------------------------

  function bindEvents() {
    refs.client.addEventListener("change", function () {
      var selected = state.clients.find(function (client) { return client.slug === refs.client.value; }) || null;
      state.client = selected;
      state.page = 1;
      closeDrawer();
      try {
        if (selected) root.localStorage.setItem("vf-central-margem-cliente", selected.slug);
        else root.localStorage.removeItem("vf-central-margem-cliente");
      } catch (_) { /* armazenamento opcional */ }
      syncUrl();
      if (selected) loadCentral();
      else {
        state.data = null;
        state.error = null;
        renderAll();
      }
    });

    refs.marketplace.addEventListener("change", function () {
      state.marketplace = refs.marketplace.value || "meli";
      state.page = 1;
      if (state.client) loadCentral();
    });

    refs.search.addEventListener("input", function () {
      state.search = refs.search.value.trim();
      state.page = 1;
      if (state.searchTimer) root.clearTimeout(state.searchTimer);
      state.searchTimer = root.setTimeout(function () {
        if (state.client) loadCentral();
        else renderAll();
      }, 350);
    });

    refs.refresh.addEventListener("click", function () {
      if (state.client) loadCentral(true);
      else renderAll();
    });

    refs.presets.addEventListener("click", function (event) {
      var button = event.target.closest("[data-preset]");
      if (!button) return;
      applyPreset(button.getAttribute("data-preset"));
    });

    refs.restoreSources.addEventListener("click", function () { applyPreset("projected"); });

    refs.financialFilter.addEventListener("change", function () {
      state.financial = refs.financialFilter.value;
      renderSummary();
      renderSheet();
      renderDivergences();
      renderActiveFilters();
    });

    refs.integrityFilter.addEventListener("change", function () {
      state.integrity = refs.integrityFilter.value;
      renderSummary();
      renderSheet();
      renderDivergences();
      renderActiveFilters();
    });

    refs.activeFilters.addEventListener("click", function (event) {
      var button = event.target.closest("[data-clear-filter]");
      if (!button) return;
      var target = button.getAttribute("data-clear-filter");
      if (target === "financial") { state.financial = ""; refs.financialFilter.value = ""; }
      if (target === "integrity") { state.integrity = ""; refs.integrityFilter.value = ""; }
      renderSummary();
      renderSheet();
      renderDivergences();
      renderActiveFilters();
    });

    refs.kpisFinancial.addEventListener("click", function (event) {
      var button = event.target.closest("[data-financial-filter]");
      if (!button || !state.data) return;
      var value = button.getAttribute("data-financial-filter");
      state.financial = state.financial === value ? "" : value;
      refs.financialFilter.value = state.financial;
      renderSummary();
      renderSheet();
      renderDivergences();
      renderActiveFilters();
    });

    refs.kpisIntegrity.addEventListener("click", function (event) {
      var button = event.target.closest("[data-integrity-filter]");
      if (!button || !state.data) return;
      var value = button.getAttribute("data-integrity-filter");
      state.integrity = state.integrity === value ? "" : value;
      refs.integrityFilter.value = state.integrity;
      renderSummary();
      renderSheet();
      renderDivergences();
      renderActiveFilters();
    });

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
      var trigger = event.target.closest("[data-open-item]");
      var row = event.target.closest("tr[data-item-id]");
      if (trigger) {
        event.preventDefault();
        event.stopPropagation();
        openDrawer(trigger.getAttribute("data-open-item"), "summary", null, trigger);
      } else if (row && !event.target.closest("a, button, input, select")) {
        openDrawer(row.getAttribute("data-item-id"), "summary", null, row);
      }
    });

    refs.tableHost.addEventListener("keydown", function (event) {
      var row = event.target.closest("tr[data-item-id]");
      if (row && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        openDrawer(row.getAttribute("data-item-id"), "summary", null, row);
      }
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
    refs.scenarioReset.addEventListener("click", function () {
      var item = findSelectedItem();
      if (!item) return;
      initScenario(item);
      renderDrawer();
      toast("Cenário restaurado para a composição da planilha.");
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && refs.drawer.classList.contains("is-open")) closeDrawer();
      if (event.key === "Tab" && refs.drawer.classList.contains("is-open")) trapFocus(event);
    });
  }

  /** O drawer é modal: o Tab não pode escapar para a página atrás dele. */
  function trapFocus(event) {
    var focusable = refs.drawer.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
    if (!focusable.length) return;
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (!refs.drawer.contains(document.activeElement)) {
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

  function syncUrl() {
    try {
      var params = new URLSearchParams(root.location.search || "");
      if (state.client) params.set("cliente", state.client.slug);
      else params.delete("cliente");
      root.history.replaceState({}, "", root.location.pathname + (params.toString() ? "?" + params.toString() : ""));
    } catch (_) { /* history pode estar bloqueado */ }
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

  function loadClients() {
    refs.client.disabled = true;
    refs.client.innerHTML = '<option value="">Carregando clientes…</option>';
    return api.getClients().then(function (result) {
      refs.client.disabled = false;
      if (!result.ok) {
        state.error = result.error || "Não foi possível carregar os clientes.";
        state.errorCode = result.code || null;
        refs.client.innerHTML = '<option value="">Falha ao carregar</option>';
        renderAll();
        return;
      }
      state.clients = result.clients || [];
      var options = '<option value="">Selecione um cliente</option>';
      state.clients.forEach(function (client) {
        options += '<option value="' + escapeHtml(client.slug) + '">' + escapeHtml(client.name) +
          (client.mlConnected ? "" : " · ML não conectado") + "</option>";
      });
      refs.client.innerHTML = options;

      var requested = null;
      try { requested = new URLSearchParams(root.location.search || "").get("cliente"); } catch (_) { /* ignora */ }
      var saved = null;
      try { saved = root.localStorage.getItem("vf-central-margem-cliente"); } catch (_) { /* ignora */ }
      var preferred = requested || saved;
      var match = state.clients.find(function (client) { return client.slug === preferred; }) || null;
      if (match) {
        state.client = match;
        refs.client.value = match.slug;
        loadCentral();
      } else {
        state.client = null;
        state.error = null;
        state.errorCode = null;
        renderAll();
      }
    });
  }

  function loadCentral(manual) {
    if (!state.client) return;
    state.requestSequence += 1;
    var sequence = state.requestSequence;
    if (state.abortController) state.abortController.abort();
    state.abortController = typeof AbortController !== "undefined" ? new AbortController() : null;
    state.loading = true;
    state.error = null;
    state.errorCode = null;
    renderAll();

    // Uma única leitura agregada por página. Nenhuma chamada por linha, nem na
    // abertura do drawer.
    return api.getCentral({
      clientSlug: state.client.slug,
      clientName: state.client.name,
      marketplace: state.marketplace,
      search: state.search,
      page: state.page,
      limit: state.limit,
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

  function renderAll() {
    refs.refresh.disabled = state.loading || !state.client;
    refs.refresh.classList.toggle("is-loading", state.loading);
    refs.search.disabled = !state.client;
    refs.marketplace.disabled = !state.client;
    renderContext();
    renderPageState();
    syncPresetButtons();
    renderSourceStrip();
    renderSummary();
    renderActiveFilters();
    renderSheet();
    renderDivergences();
  }

  function renderContext() {
    var data = state.data;
    refs.updated.innerHTML = '<span class="cm-updated__label">Última atualização</span><strong>' +
      escapeHtml((data && formatDateTime(data.lastUpdated)) || "—") + "</strong>";
    refs.monitoredTag.textContent = data ? (data.summary.monitored || 0) + " monitorados" : "—";
    refs.sourceTag.textContent = data ? data.sourceLabel + " · leitura" : "Motor · leitura";
    if (!data || !state.client) {
      refs.contextMeta.innerHTML = state.client ? '<span><strong>Cliente:</strong> ' + escapeHtml(state.client.name) + "</span>" : "";
      return;
    }
    var period = data.period || {};
    refs.contextMeta.innerHTML =
      '<span><strong>Cliente:</strong> ' + escapeHtml(state.client.name) + "</span>" +
      '<span><strong>Marketplace:</strong> Mercado Livre</span>' +
      '<span><strong>Fonte:</strong> ' + escapeHtml(data.sourceLabel) + "</span>" +
      '<span><strong>Realizado:</strong> ' + escapeHtml(period.label || "últimos 30 dias") + "</span>" +
      '<span><strong>Modo:</strong> somente leitura</span>';
  }

  function renderPageState() {
    if (!state.client && !state.error) {
      refs.pageState.innerHTML = '<div class="vf-banner is-info"><div class="vf-banner__content"><p class="vf-banner__title">Selecione o contexto da análise</p><p class="vf-banner__description">Escolha um cliente para carregar anúncios, dados financeiros e cobertura de Base.</p></div></div>';
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
      if (retry) retry.addEventListener("click", function () { state.client ? loadCentral() : loadClients(); });
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
    refs.pageState.innerHTML = '<div class="vf-banner is-info"><div class="vf-banner__content"><p class="vf-banner__title">Leitura parcial e rastreável</p><p class="vf-banner__description">Os valores exibidos são reais ou derivados de fontes reais; campos sem fonte permanecem indisponíveis.</p>' +
      (warnings ? "<ul>" + warnings + "</ul>" : "") + "</div></div>";
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

  function financialCards() {
    var summary = state.data ? contract.summarizeItems(state.data.items) : { financial: {} };
    var counts = summary.financial || {};
    var monitored = state.data ? state.data.summary.monitored || 0 : 0;
    return [
      { filter: null, label: "Monitorados", value: monitored, foot: "universo do catálogo", modifier: "" },
      { filter: "HEALTHY", label: "Saudáveis", value: counts.HEALTHY || 0, foot: "sem ação imediata", modifier: "is-success" },
      { filter: "LOW_MARGIN", label: "Margem baixa", value: counts.LOW_MARGIN || 0, foot: "abaixo da meta", modifier: "is-warning" },
      { filter: "LOSS", label: "Prejuízo", value: counts.LOSS || 0, foot: "ação prioritária", modifier: "is-danger" },
    ];
  }

  function integrityCards() {
    var summary = state.data ? contract.summarizeItems(state.data.items) : { integrity: {} };
    var counts = summary.integrity || {};
    return [
      { filter: "MISSING", label: "Não validados", value: counts.MISSING || 0, foot: "dado obrigatório ausente", modifier: "" },
      { filter: "SUSPECT", label: "Dados suspeitos", value: counts.SUSPECT || 0, foot: "fontes em conflito", modifier: "is-warning" },
      { filter: "RECONCILING", label: "Em conciliação", value: counts.RECONCILING || 0, foot: "realizado ainda aberto", modifier: "is-info" },
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

    if (!state.client) refs.summaryScope.textContent = "Selecione um cliente para iniciar a análise.";
    else if (state.loading) refs.summaryScope.textContent = "Atualizando a leitura…";
    else if (!state.data) refs.summaryScope.textContent = "";
    else {
      refs.summaryScope.textContent = "Resultado financeiro e integridade do dado são leituras diferentes: um produto pode ter prejuízo com dado confiável, e margem aparentemente saudável com dado suspeito. " +
        "Monitorados considera o catálogo; os dois placares refletem os " + (state.data.items || []).length + " produtos carregados nesta página.";
    }
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
    refs.activeFilters.innerHTML = chips.join("");
  }

  function filteredItems() {
    var items = state.data ? state.data.items || [] : [];
    return items.filter(function (item) {
      if (state.financial && contract.financialResult(item).key !== state.financial) return false;
      if (state.integrity && contract.dataIntegrity(item).key !== state.integrity) return false;
      return true;
    });
  }

  // ---------------------------------------------------------------------------
  // Planilha
  // ---------------------------------------------------------------------------

  function sourceSelectHtml(variableKey) {
    var meta = contract.VARIABLE_META[variableKey];
    var selected = state.selection[variableKey];
    var options = contract.SOURCE_SLOTS[variableKey].map(function (source) {
      return '<option value="' + source + '"' + (source === selected ? " selected" : "") + ">" +
        escapeHtml(contract.SOURCE_SHORT_LABELS[source] || source) + "</option>";
    }).join("");
    var changed = state.preset === "custom" && selected !== contract.PRESETS.projected[variableKey];
    return '<th class="cm-var-head"><span class="cm-head-label">' + escapeHtml(meta.label) + "</span>" +
      '<select class="cm-head-select' + (changed ? " is-changed" : "") + '" data-source-select="' + variableKey +
      '" aria-label="Fonte de ' + escapeHtml(meta.label) + '">' + options + "</select></th>";
  }

  function sheetHead() {
    return "<tr>" +
      '<th class="vf-table__sticky-cell cm-product-head"><span class="cm-head-label">Produto</span></th>' +
      contract.VARIABLES.map(sourceSelectHtml).join("") +
      '<th class="num cm-calc-head"><span class="cm-head-label">LC</span></th>' +
      '<th class="num cm-calc-head"><span class="cm-head-label">MC</span></th>' +
      '<th><span class="cm-head-label">Resultado</span></th>' +
      '<th><span class="cm-head-label">Integridade</span></th>' +
      '<th><span class="cm-head-label">Problema</span></th>' +
      '<th><span class="cm-head-label">Próxima ação</span></th>' +
      "</tr>";
  }

  function valueCell(item, variableKey) {
    var source = state.selection[variableKey];
    var entry = contract.sourceEntry(item, variableKey, source);
    if (!entry || !entry.available) {
      return '<td class="num">' + unavailable("Indisponível", "Nenhuma observação de " +
        contract.VARIABLE_META[variableKey].label.toLowerCase() + " por " + contract.sourceLabel(source) + ".") + "</td>";
    }
    var differs = contract.hasSourceDisagreement(item, variableKey, source);
    return '<td class="num"><span class="cm-cell-value">' + escapeHtml(formatByVariable(variableKey, entry.value)) + "</span>" +
      '<span class="cm-cell-meta">' + escapeHtml(entry.sourceShort) + "</span>" +
      (differs ? '<span class="cm-cell-diff">outra fonte difere</span>' : "") + "</td>";
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

  function rowHtml(item) {
    var composition = contract.resolveComposition(item, state.selection);
    var financial = contract.financialResult(item);
    var integrity = contract.dataIntegrity(item);
    var action = nextAction(item, integrity, financial, composition);
    var rowClass = financial.key === "LOSS" ? "row--danger"
      : integrity.key === "SUSPECT" || financial.key === "LOW_MARGIN" ? "row--warning" : "";
    var assumed = composition.computable && composition.assumed.length
      ? '<span class="cm-cell-meta">assumido 0: ' + escapeHtml(composition.assumed.map(variableLabel).join(", ")) + "</span>"
      : "";

    return '<tr class="' + rowClass + (state.selectedItemId === item.id ? " row--selected" : "") + '" data-item-id="' + escapeHtml(item.id) + '" tabindex="0">' +
      '<td class="vf-table__sticky-cell cm-product-cell"><span class="cm-prod-title">' + escapeHtml(item.title) + "</span>" +
      '<span class="cm-prod-meta">' + escapeHtml(item.itemId || "—") + " · " + escapeHtml(item.sku || "sem SKU") + "</span></td>" +
      contract.VARIABLES.map(function (variableKey) { return valueCell(item, variableKey); }).join("") +
      '<td class="num">' + (composition.computable
        ? '<span class="cm-cell-value ' + (composition.profit < 0 ? "cm-negative" : "") + '">' + escapeHtml(formatMoney(composition.profit)) + "</span>" + assumed
        : unavailable("Indisponível", "Falta " + composition.missing.map(variableLabel).join(", ") + " na composição selecionada.")) + "</td>" +
      '<td class="num">' + (composition.computable
        ? '<span class="cm-cell-value ' + marginClass(composition.margin, item) + '">' + escapeHtml(formatPercent(composition.margin)) + "</span>"
        : unavailable("Indisponível")) + "</td>" +
      "<td>" + statusTag(financial) + "</td>" +
      "<td>" + statusTag(integrity) + "</td>" +
      '<td><p class="cm-problem">' + escapeHtml(item.problem || "Sem problema informado") + "</p></td>" +
      '<td><div class="cm-next-action"><strong>' + escapeHtml(action.title) + "</strong><span>" + escapeHtml(action.detail) + "</span></div></td>" +
      "</tr>";
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
    var items = filteredItems();
    refs.resultCount.textContent = items.length + (items.length === 1 ? " produto" : " produtos");
    if (!items.length) {
      var hasFilters = state.search || state.financial || state.integrity;
      refs.tableHost.innerHTML = stateHtml("empty", hasFilters ? "Nenhum resultado" : "Nenhum item monitorado",
        hasFilters ? "Ajuste a busca ou remova os filtros operacionais." : "Sincronize o catálogo em Anúncios ML e atualize esta leitura.",
        hasFilters ? '<div class="vf-empty__actions"><button class="vf-btn vf-btn--secondary" type="button" id="cm-clear-all">Limpar filtros</button></div>' : "");
      var clear = el("cm-clear-all");
      if (clear) clear.addEventListener("click", clearAllFilters);
      refs.pagination.hidden = true;
      return;
    }
    refs.tableHost.innerHTML = '<div class="vf-table-wrap cm-table-wrap"><table class="vf-table vf-table--compact cm-table"><thead>' +
      sheetHead() + "</thead><tbody>" + items.map(rowHtml).join("") + "</tbody></table></div>";
    renderPagination();
  }

  function clearAllFilters() {
    state.financial = "";
    state.integrity = "";
    state.search = "";
    state.page = 1;
    refs.search.value = "";
    refs.financialFilter.value = "";
    refs.integrityFilter.value = "";
    loadCentral();
  }

  function renderPagination() {
    var pagination = state.data && state.data.pagination;
    if (!pagination) {
      refs.pagination.hidden = true;
      return;
    }
    var start = pagination.total ? (pagination.page - 1) * pagination.limit + 1 : 0;
    var end = Math.min(pagination.page * pagination.limit, pagination.total);
    refs.pagination.hidden = false;
    refs.pagination.innerHTML = '<span class="vf-pagination__info">' + start + "–" + end + " de " + pagination.total + '</span><label class="vf-page-size">Por página <select class="vf-select vf-select--sm" id="cm-page-size"><option value="10">10</option><option value="20">20</option></select></label><div class="vf-pagination__actions"><button class="vf-btn vf-btn--secondary vf-btn--sm" type="button" id="cm-page-prev"' +
      (pagination.page <= 1 ? " disabled" : "") + '>Anterior</button><span class="vf-tag is-neutral">Página ' + pagination.page + " de " + pagination.totalPages + '</span><button class="vf-btn vf-btn--secondary vf-btn--sm" type="button" id="cm-page-next"' +
      (pagination.page >= pagination.totalPages ? " disabled" : "") + ">Próxima</button></div>";
    var size = el("cm-page-size");
    size.value = String(state.limit);
    size.addEventListener("change", function () {
      state.limit = Number(size.value) || 20;
      state.page = 1;
      loadCentral();
    });
    el("cm-page-prev").addEventListener("click", function () {
      if (state.page > 1) { state.page -= 1; loadCentral(); }
    });
    el("cm-page-next").addEventListener("click", function () {
      if (state.page < pagination.totalPages) { state.page += 1; loadCentral(); }
    });
  }

  // ---------------------------------------------------------------------------
  // Fila de divergências
  // ---------------------------------------------------------------------------

  function divergenceRows() {
    var rows = contract.divergenceQueue(filteredItems(), state.selection);
    return state.criticalOnly ? rows.filter(function (row) { return row.severity === "CRITICA"; }) : rows;
  }

  function renderDivergences() {
    if (!state.data || state.loading) {
      refs.divergenceCount.textContent = "";
      refs.divergences.innerHTML = state.loading
        ? stateHtml("loading", "Comparando fontes…")
        : stateHtml("empty", "Sem leitura carregada", "A fila de divergências acompanha a página carregada da planilha.");
      return;
    }
    var rows = divergenceRows();
    refs.divergenceCount.textContent = rows.length + (rows.length === 1 ? " divergência" : " divergências");
    if (!rows.length) {
      refs.divergences.innerHTML = stateHtml("empty", "Nenhuma divergência nesta página",
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
  // Drawer
  // ---------------------------------------------------------------------------

  /**
   * Marca a linha aberta sem redesenhar a planilha: redesenhar destruiria o
   * elemento que abriu o drawer e o foco não teria para onde voltar.
   */
  function markSelectedRow() {
    Array.prototype.forEach.call(refs.tableHost.querySelectorAll("tr[data-item-id]"), function (row) {
      row.classList.toggle("row--selected", row.getAttribute("data-item-id") === state.selectedItemId);
    });
  }

  function findSelectedItem() {
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

  function openDrawer(itemId, tab, variableKey, trigger) {
    var items = filteredItems();
    var item = items.find(function (entry) { return entry.id === itemId; });
    if (!item) return;
    if (!refs.drawer.classList.contains("is-open")) state.previousFocus = trigger || document.activeElement;
    state.selectedItemId = item.id;
    if (DRAWER_TABS.indexOf(tab) !== -1) state.drawerTab = tab;
    if (variableKey && contract.VARIABLE_META[variableKey]) state.evidenceVariable = variableKey;
    if (state.scenarioItemId !== item.id) initScenario(item);
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
    state.selectedItemId = null;
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
    initScenario(items[next]);
    renderDrawer();
    markSelectedRow();
    refs.drawerBody.scrollTop = 0;
  }

  function setDrawerTab(tab) {
    if (DRAWER_TABS.indexOf(tab) === -1) return;
    state.drawerTab = tab;
    renderDrawer();
  }

  function miniKpi(label, valueHtml, foot) {
    return '<div class="cm-mini-kpi"><span class="cm-mini-kpi__label">' + escapeHtml(label) + "</span>" +
      '<span class="cm-mini-kpi__value">' + valueHtml + "</span>" +
      (foot ? '<span class="cm-mini-kpi__foot">' + escapeHtml(foot) + "</span>" : "") + "</div>";
  }

  function panel(title, note, body) {
    return '<section class="cm-panel"><header class="cm-panel__head"><h3>' + escapeHtml(title) + "</h3>" +
      (note ? "<span>" + escapeHtml(note) + "</span>" : "") + "</header>" +
      '<div class="cm-panel__body">' + body + "</div></section>";
  }

  function renderDrawer() {
    var item = findSelectedItem();
    if (!item) return;
    var items = filteredItems();
    var index = items.findIndex(function (entry) { return entry.id === item.id; });
    var financial = contract.financialResult(item);
    var integrity = contract.dataIntegrity(item);

    refs.drawerTitle.textContent = item.title;
    refs.drawerMeta.innerHTML = '<span class="vf-mono">' + escapeHtml(item.itemId || "—") + "</span>" +
      '<span>SKU <span class="vf-mono">' + escapeHtml(item.sku || "—") + "</span></span>" +
      statusTag(financial) + statusTag(integrity);
    refs.drawerPrev.disabled = index <= 0;
    refs.drawerNext.disabled = index < 0 || index >= items.length - 1;
    refs.drawerPosition.textContent = index >= 0 ? (index + 1) + " de " + items.length + " produtos neste recorte" : "";

    Array.prototype.forEach.call(refs.drawerTabs.querySelectorAll("[data-tab]"), function (button) {
      var active = button.getAttribute("data-tab") === state.drawerTab;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });

    if (state.drawerTab === "scenario") renderScenarioTab(item);
    else if (state.drawerTab === "evidence") renderEvidenceTab(item);
    else if (state.drawerTab === "audit") renderAuditTab(item);
    else renderSummaryTab(item, financial, integrity);

    updateFooter(item);
  }

  /**
   * Leitura do Motor: a primeira coisa que o operador deve ler. Deriva do
   * estado real do item, com a mesma prioridade do backend — qualidade do dado
   * antes do resultado financeiro.
   */
  function motorDecision(item, financial, integrity, composition) {
    if (integrity.key === "MISSING") {
      return { title: "Completar dado antes de validar margem", copy: "Falta variável obrigatória. O cálculo pode até ter outras variáveis disponíveis, mas sem ela nenhuma decisão financeira é defensável.", tag: "Bloqueado por dado" };
    }
    if (integrity.key === "SUSPECT") {
      return { title: "Investigar a variável divergente antes de agir", copy: (item.problem ? item.problem + " " : "") + "O Motor mantém a margem calculável, mas separa cálculo de confiança.", tag: "Revisão necessária" };
    }
    if (integrity.key === "RECONCILING") {
      return { title: "Não tratar o realizado como fechado", copy: "Há evidências de venda, mas a conciliação financeira ainda está incompleta. Projeção e realizado permanecem separados.", tag: "Em conciliação" };
    }
    if (!composition.computable) {
      return { title: "Completar a composição selecionada", copy: "A fonte escolhida não observou " + composition.missing.map(variableLabel).join(", ") + ". Troque a fonte no cabeçalho ou complete o dado na origem.", tag: "Composição incompleta" };
    }
    if (financial.key === "LOSS") {
      return { title: "Revisar preço e composição", copy: (item.problem ? item.problem + " " : "") + "Os dados disponíveis permitem simular alternativas sem alterar o marketplace.", tag: "Ação prioritária" };
    }
    if (financial.key === "LOW_MARGIN") {
      return { title: "Testar cenário para recuperar margem", copy: (item.problem ? item.problem + " " : "") + "O cenário mede o impacto antes de qualquer escrita.", tag: "Simulação recomendada" };
    }
    return { title: "Produto sem exceção crítica", copy: "O item permanece monitorado. O drawer serve para auditar composição, fontes e rastro da leitura.", tag: "Monitoramento" };
  }

  function gatesHtml(item, composition, scenarioMode) {
    var complete = composition.computable;
    var conflicts = (item.divergences || []).length;
    var gates = [
      {
        tone: complete ? "is-ok" : "is-block",
        icon: complete ? "✓" : "!",
        text: complete
          ? "Variáveis obrigatórias completas" + (composition.assumed.length ? " (assumido 0: " + composition.assumed.map(variableLabel).join(", ") + ")" : "")
          : "Há variável obrigatória ausente: " + composition.missing.map(variableLabel).join(", "),
      },
      {
        tone: conflicts ? "is-warn" : "is-ok",
        icon: conflicts ? "!" : "✓",
        text: conflicts ? "Existem " + conflicts + " evidência(s) divergente(s)" : "Sem divergência material entre as fontes",
      },
      {
        tone: integrityTone(item),
        icon: contract.dataIntegrity(item).key === "RELIABLE" ? "✓" : "!",
        text: "Integridade: " + contract.dataIntegrity(item).label.toLowerCase(),
      },
    ];
    if (scenarioMode) {
      var changed = composition.changed && composition.changed.length;
      gates.push({ tone: changed ? "is-ok" : "is-warn", icon: changed ? "✓" : "•", text: changed ? "Cenário difere da composição da planilha" : "Nenhuma alteração no cenário" });
    }
    gates.push({ tone: "is-block", icon: "×", text: "Escrita real indisponível: não existe endpoint autorizado e auditável para aplicar preço" });
    return '<ul class="cm-gates">' + gates.map(function (gate) {
      return '<li class="cm-gate ' + gate.tone + '"><span class="cm-gate__icon" aria-hidden="true">' + gate.icon + "</span><span>" + escapeHtml(gate.text) + "</span></li>";
    }).join("") + "</ul>";
  }

  function integrityTone(item) {
    var key = contract.dataIntegrity(item).key;
    if (key === "RELIABLE") return "is-ok";
    if (key === "MISSING") return "is-block";
    return "is-warn";
  }

  function attentionRows(item, composition) {
    var rows = [];
    composition.missing.forEach(function (variableKey) {
      rows.push({ name: contract.VARIABLE_META[variableKey].label, copy: "Valor obrigatório ausente na fonte selecionada.", status: "Bloqueia", tone: "is-neutral" });
    });
    composition.assumed.forEach(function (variableKey) {
      rows.push({ name: contract.VARIABLE_META[variableKey].label, copy: "Sem observação: entrou no cálculo como zero declarado.", status: "Assumido", tone: "is-neutral" });
    });
    (item.divergences || []).forEach(function (divergence) {
      rows.push({
        name: divergence.variable,
        copy: divergence.sourceA + " × " + divergence.sourceB + ": " +
          (formatByVariable(divergence.variableKey, divergence.valueA) || "—") + " × " +
          (formatByVariable(divergence.variableKey, divergence.valueB) || "—") + ".",
        status: divergence.type === "CONFLICT" ? "Conflito" : "Desvio",
        tone: divergence.type === "CONFLICT" ? "is-danger" : "is-warning",
      });
    });
    contract.VARIABLES.forEach(function (variableKey) {
      var entry = composition.entries[variableKey];
      if (!entry || !entry.available) return;
      var level = variableConfidence(item, variableKey).level;
      if (level === "LOW") {
        rows.push({ name: contract.VARIABLE_META[variableKey].label, copy: "Confiança baixa informada pelo Motor para esta variável.", status: "Baixa confiança", tone: "is-warning" });
      }
    });
    if (!rows.length) {
      rows.push({ name: "Nenhuma", copy: "As fontes disponíveis não apresentam exceção material.", status: "OK", tone: "is-success" });
    }
    return rows;
  }

  function renderSummaryTab(item, financial, integrity) {
    var composition = contract.resolveComposition(item, state.selection);
    var decision = motorDecision(item, financial, integrity, composition);
    var baseHref = "bases.html?busca=" + encodeURIComponent(item.itemId || item.sku || "");
    var orderHref = "fechamentos-api.html?cliente=" + encodeURIComponent(state.client.slug) + (item.latestOrderId ? "&search=" + encodeURIComponent(item.latestOrderId) : "");

    refs.drawerBody.innerHTML =
      '<section class="cm-decision"><div class="cm-decision__top"><div>' +
      '<p class="cm-decision__label">Leitura do Motor</p>' +
      '<p class="cm-decision__title">' + escapeHtml(decision.title) + "</p>" +
      '<p class="cm-decision__copy">' + escapeHtml(decision.copy) + "</p></div>" +
      '<div class="cm-decision__tags"><span class="cm-mini-tag">' + escapeHtml(decision.tag) + "</span>" +
      '<span class="cm-mini-tag">' + (item.divergences || []).length + " divergência(s)</span></div></div></section>" +

      '<div class="cm-kpis5">' +
      miniKpi("LC atual", composition.computable ? escapeHtml(formatMoney(composition.profit)) : unavailable("Indisponível"), "composição da planilha") +
      miniKpi("MC atual", composition.computable ? escapeHtml(formatPercent(composition.margin)) : unavailable("Indisponível"), "modo " + (PRESET_LABELS[state.preset] || state.preset)) +
      miniKpi("Meta", item.targetMargin === null || item.targetMargin === undefined ? unavailable("Não informada") : escapeHtml(formatPercent(item.targetMargin)), "referência do Motor") +
      miniKpi("Resultado", statusTag(financial), financial.origin === "backend" ? "status do Motor" : "derivado das margens") +
      miniKpi("Integridade", statusTag(integrity), integrity.origin === "backend" ? "status do Motor" : "derivado das evidências") +
      "</div>" +

      '<div class="cm-summary-grid">' +
      panel("Variáveis que merecem atenção", "priorizadas pelo estado real", '<div class="cm-critical-list">' +
        attentionRows(item, composition).map(function (row) {
          return '<div class="cm-critical"><strong>' + escapeHtml(row.name) + "</strong>" +
            "<p>" + escapeHtml(row.copy) + "</p>" +
            '<span class="vf-status ' + row.tone + '">' + escapeHtml(row.status) + "</span></div>";
        }).join("") + "</div>") +
      panel("Gates de segurança", "antes de qualquer ação", gatesHtml(item, composition, false)) +
      "</div>" +

      panel("Recebimento e conciliação", "o que a venda entregou", '<div class="cm-receipt-grid">' +
        miniKpi("Valor vendido", item.variables.soldValue.value === null ? unavailable("Sem venda") : escapeHtml(formatMoney(item.variables.soldValue.value))) +
        miniKpi("Margem realizada", item.realized.margin === null ? unavailable("Pendente") : escapeHtml(formatPercent(item.realized.margin))) +
        miniKpi("Recebimento líquido", item.variables.netReceipt.value === null ? unavailable("Indisponível", "Mercado Pago não integrado ao backend.") : escapeHtml(formatMoney(item.variables.netReceipt.value))) +
        miniKpi("Mercado Pago", unavailable("Não integrado", "Nenhum client, rota ou token de Mercado Pago existe no backend.")) +
        miniKpi("Conciliação", escapeHtml(item.reconciliation || "Pendente")) +
        "</div>") +

      panel("Próxima ação", "atalhos operacionais", '<div class="cm-links">' +
        '<a class="vf-btn vf-btn--sm" href="' + escapeHtml(baseHref) + '">Ver na Base</a>' +
        (item.latestOrderId
          ? '<a class="vf-btn vf-btn--sm" href="' + escapeHtml(orderHref) + '">Ver pedido</a>'
          : '<button class="vf-btn vf-btn--sm" type="button" disabled title="Nenhum pedido do período foi associado a este produto.">Ver pedido</button>') +
        '<button class="vf-btn vf-btn--sm" type="button" data-goto-tab="scenario">Simular cenário</button>' +
        '<button class="vf-btn vf-btn--sm" type="button" data-goto-tab="evidence">Investigar evidências</button>' +
        '<button class="vf-btn vf-btn--sm" type="button" disabled title="Integração de recebimentos indisponível no backend.">Mercado Pago</button>' +
        (item.permalink ? '<a class="vf-btn vf-btn--sm" href="' + escapeHtml(item.permalink) + '" target="_blank" rel="noopener">Abrir anúncio</a>' : "") +
        "</div>");

    Array.prototype.forEach.call(refs.drawerBody.querySelectorAll("[data-goto-tab]"), function (button) {
      button.addEventListener("click", function () { setDrawerTab(button.getAttribute("data-goto-tab")); });
    });
  }

  // --- Cenário ---------------------------------------------------------------

  function scenarioConfidence(item, variableKey, entry, override) {
    if (override.manual) return { label: "CENÁRIO", tone: "is-warning" };
    if (!entry || !entry.available) return { label: "UNKNOWN", tone: "is-neutral" };
    var level = variableConfidence(item, variableKey).level;
    var meta = CONFIDENCE_META[level] || CONFIDENCE_META.UNKNOWN;
    return { label: level, tone: meta.className };
  }

  function renderScenarioTab(item) {
    var simulation = contract.simulateScenario(item, state.scenario, state.selection);
    var values = simulation.values;
    var taxAmount = values.price !== null && values.tax !== null ? values.price * values.tax : null;

    var rows = contract.VARIABLES.map(function (variableKey) {
      var override = state.scenario[variableKey];
      var entry = simulation.entries[variableKey];
      var baseValue = simulation.baseline.values[variableKey];
      var changed = simulation.changed.indexOf(variableKey) !== -1;
      var confidence = scenarioConfidence(item, variableKey, entry, override);
      var options = contract.SOURCE_SLOTS[variableKey].map(function (source) {
        var candidate = contract.sourceEntry(item, variableKey, source);
        return '<option value="' + source + '"' + (source === override.source ? " selected" : "") + ">" +
          escapeHtml(contract.SOURCE_SHORT_LABELS[source] || source) + (candidate && candidate.available ? "" : " · indisponível") + "</option>";
      }).join("");
      var inputValue = values[variableKey] === null ? "" : String(values[variableKey]);
      return "<tr>" +
        '<td class="cm-scenario-name"><strong>' + escapeHtml(contract.VARIABLE_META[variableKey].label) +
        (changed ? '<span class="cm-changed">alterada</span>' : "") + "</strong>" +
        "<small>planilha: " + escapeHtml(formatByVariable(variableKey, baseValue) || "Indisponível") + "</small></td>" +
        '<td><input class="cm-scenario-input" type="number" step="0.0001" value="' + escapeHtml(inputValue) +
        '" data-scenario-value="' + variableKey + '" aria-label="Valor de ' + escapeHtml(contract.VARIABLE_META[variableKey].label) + ' no cenário"></td>' +
        '<td><select class="cm-scenario-source" data-scenario-source="' + variableKey +
        '" aria-label="Fonte de ' + escapeHtml(contract.VARIABLE_META[variableKey].label) + ' no cenário">' + options + "</select></td>" +
        '<td><span class="vf-status ' + confidence.tone + ' cm-confidence">' + escapeHtml(confidence.label) + "</span></td>" +
        '<td><button class="vf-btn vf-btn--ghost vf-btn--sm" type="button" data-scenario-reset="' + variableKey +
        '" aria-label="Restaurar ' + escapeHtml(contract.VARIABLE_META[variableKey].label) + '">↺</button></td>' +
        "</tr>";
    }).join("");

    function line(label, operator, value) {
      return "<tr><td>" + escapeHtml(label) + '</td><td class="cm-formula__op">' + operator +
        '</td><td class="cm-formula__amount">' + escapeHtml(formatMoney(value) || "—") + "</td></tr>";
    }

    refs.drawerBody.innerHTML =
      '<div class="cm-scenario-grid"><div>' +
      panel("Composição do cenário", "não persistido · apenas simulação",
        '<div class="vf-table-wrap"><table class="vf-table vf-table--compact cm-scenario-table"><thead><tr><th>Variável</th><th>Valor</th><th>Fonte</th><th>Confiança</th><th><span class="vf-visually-hidden">Restaurar</span></th></tr></thead><tbody>' +
        rows + "</tbody></table></div>") +
      panel("Gates do cenário", "o backend revalidaria tudo", gatesHtml(item, {
        computable: simulation.computable,
        missing: simulation.missing,
        assumed: simulation.assumed,
        changed: simulation.changed,
      }, true)) +
      "</div>" +

      '<aside class="cm-scenario-side">' +
      '<div class="cm-scenario-result"><p class="cm-scenario-result__label">Resultado do cenário</p>' +
      '<div class="cm-scenario-result__main">' +
      '<div class="cm-scenario-result__metric"><span>LC</span><strong>' + (simulation.computable ? escapeHtml(formatMoney(simulation.profit)) : "—") + "</strong></div>" +
      '<div class="cm-scenario-result__metric"><span>MC</span><strong>' + (simulation.computable ? escapeHtml(formatPercent(simulation.margin)) : "—") + "</strong></div>" +
      "</div>" +
      '<p class="cm-delta-line">Vs. planilha: ' +
      escapeHtml(simulation.deltaProfit === null ? "—" : formatMoney(simulation.deltaProfit, true)) + " · " +
      escapeHtml(simulation.deltaMarginPp === null ? "—" : formatPp(simulation.deltaMarginPp)) + "</p>" +
      '<p class="cm-delta-line">Vs. meta: ' + escapeHtml(simulation.deltaTargetPp === null ? "meta não informada" : formatPp(simulation.deltaTargetPp)) + "</p>" +
      (simulation.computable
        ? ""
        : '<p class="cm-delta-line">Cenário incompleto: falta ' + escapeHtml(simulation.missing.map(variableLabel).join(", ")) + ".</p>") +
      "</div>" +

      '<div class="cm-formula"><table>' +
      line("Preço", "+", values.price) +
      line("Custo", "−", values.cost) +
      line("Imposto (" + (formatPercent(values.tax) || "—") + ")", "−", taxAmount) +
      line("Comissão", "−", values.commission) +
      line("Frete", "−", values.freight) +
      line("Taxa fixa", "−", values.fixedFee) +
      '<tr class="cm-formula__total"><td>LC</td><td class="cm-formula__op">=</td><td class="cm-formula__amount">' +
      escapeHtml(simulation.computable ? formatMoney(simulation.profit) : "—") + "</td></tr>" +
      "</table></div>" +
      '<p class="cm-scenario-note"><strong>Override manual — apenas cenário.</strong> Valores digitados aqui não viram evidência, não são gravados em Bases, não alteram o produto e não alteram o marketplace. Na escrita real, o backend recalcularia tudo antes de aceitar qualquer valor.</p>' +
      "</aside></div>";

    bindScenarioControls();
  }

  function bindScenarioControls() {
    Array.prototype.forEach.call(refs.drawerBody.querySelectorAll("[data-scenario-source]"), function (select) {
      select.addEventListener("change", function () {
        var key = select.getAttribute("data-scenario-source");
        state.scenario[key] = { source: select.value, value: null, manual: false };
        renderDrawer();
      });
    });
    Array.prototype.forEach.call(refs.drawerBody.querySelectorAll("[data-scenario-value]"), function (input) {
      input.addEventListener("change", function () {
        var key = input.getAttribute("data-scenario-value");
        var raw = input.value.trim();
        var parsed = raw === "" ? null : Number(raw.replace(",", "."));
        state.scenario[key] = {
          source: state.scenario[key].source,
          value: raw === "" || !Number.isFinite(parsed) ? null : parsed,
          manual: true,
        };
        renderDrawer();
      });
    });
    Array.prototype.forEach.call(refs.drawerBody.querySelectorAll("[data-scenario-reset]"), function (button) {
      button.addEventListener("click", function () {
        var key = button.getAttribute("data-scenario-reset");
        state.scenario[key] = { source: state.selection[key], value: null, manual: false };
        renderDrawer();
      });
    });
  }

  // --- Evidências ------------------------------------------------------------

  var EVIDENCE_WHY = {
    price: {
      MELI_API: "O preço da API representa o anúncio neste momento.",
      MELI_ORDER: "A última venda representa o preço efetivamente praticado no pedido.",
      EXTENSION_DOM: "A extensão é evidência visual e funciona como verificação independente.",
    },
    cost: { VENFORCE_BASE: "Custo declarado na Base vinculada. A Central apenas lê esse valor." },
    tax: { VENFORCE_BASE: "Percentual de imposto declarado na Base vinculada." },
    commission: {
      MELI_API: "Tarifa prevista da API, usada para projetar a margem do anúncio.",
      MELI_ORDER: "Tarifa realizada do pedido: evidência do que foi efetivamente cobrado.",
    },
    freight: {
      MELI_API: "Frete previsto serve para projeção e comparação com o realizado.",
      MELI_ORDER: "Frete realizado é evidência do que ocorreu no shipment.",
      EXTENSION_DOM: "Leitura visual do frete exibido na página do anúncio.",
    },
    fixedFee: { VENFORCE_BASE: "Taxa fixa declarada na Base vinculada." },
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

  function renderEvidenceTab(item) {
    var variableKey = contract.VARIABLE_META[state.evidenceVariable] ? state.evidenceVariable : "price";
    var bucket = item.sources[variableKey];
    var chosenSource = state.selection[variableKey];
    var chosen = bucket.entries[chosenSource];
    var motor = (item.motorChoice && item.motorChoice[variableKey]) || { available: false, source: null, value: null, sourceLabel: null };
    var disagreement = contract.hasSourceDisagreement(item, variableKey, chosenSource);

    var selector = '<div class="cm-evidence-vars" role="group" aria-label="Variável investigada">' +
      contract.VARIABLES.map(function (key) {
        var flagged = contract.hasSourceDisagreement(item, key, state.selection[key]);
        return '<button class="cm-evidence-var' + (key === variableKey ? " is-active" : "") + '" type="button" data-evidence-var="' + key +
          '" aria-pressed="' + (key === variableKey ? "true" : "false") + '">' + escapeHtml(contract.VARIABLE_META[key].label) +
          (flagged ? " ·&nbsp;!" : "") + "</button>";
      }).join("") + "</div>";

    var cards = bucket.order.map(function (source) {
      var entry = bucket.entries[source];
      var role = evidenceRole(item, variableKey, source, chosenSource);
      var observed = formatDateTime(entry.observedAt);
      return '<article class="cm-evidence-card ' + role.className + '">' +
        '<p class="cm-evidence-card__source">' + escapeHtml(entry.sourceLabel) + "</p>" +
        '<p class="cm-evidence-card__value">' + (entry.available ? escapeHtml(formatByVariable(variableKey, entry.value)) : unavailable("Sem observação")) + "</p>" +
        '<dl class="cm-evidence-card__meta">' +
        "<dt>observedAt</dt><dd>" + escapeHtml(observed || "Não informado") + "</dd>" +
        "<dt>effectiveAt</dt><dd>Não informado</dd>" +
        "<dt>Momento</dt><dd>" + escapeHtml(entry.kind === "REALIZED" ? "Realizado" : entry.kind === "PROJECTED" ? "Projetado" : "Não informado") + "</dd>" +
        "<dt>Qualidade</dt><dd>" + escapeHtml(entry.quality || "Não informada") + "</dd>" +
        (entry.note ? "<dt>Detalhe</dt><dd>" + escapeHtml(entry.note) + "</dd>" : "") +
        "</dl>" +
        '<span class="cm-evidence-role">' + escapeHtml(role.label) + "</span></article>";
    }).join("");

    var why = (EVIDENCE_WHY[variableKey] && EVIDENCE_WHY[variableKey][chosenSource]) ||
      "Fonte selecionada no cabeçalho da planilha para esta variável.";
    if (!chosen || !chosen.available) {
      why = "Esta fonte não observou a variável nesta leitura, então o valor permanece indisponível — não é zero.";
    } else if (disagreement) {
      why += " Outra fonte disponível informa valor diferente além da tolerância do Motor, por isso a divergência continua visível.";
    }

    var confidenceLevel = variableConfidence(item, variableKey).level;

    refs.drawerBody.innerHTML = selector +
      '<div class="cm-evidence-layout">' +
      panel("Evidências de " + contract.VARIABLE_META[variableKey].label, "fonte × valor × tempo × papel",
        '<div class="cm-evidence-cards">' + cards + "</div>") +
      '<aside class="cm-motor-decision">' +
      "<span>Valor escolhido pela composição</span>" +
      "<strong>" + (chosen && chosen.available ? escapeHtml(formatByVariable(variableKey, chosen.value)) : unavailable("Indisponível")) + "</strong>" +
      "<p>" + escapeHtml(why) + "</p><hr>" +
      "<dl><dt>Fonte</dt><dd>" + escapeHtml(contract.sourceLabel(chosenSource)) + "</dd>" +
      "<dt>Confiança</dt><dd>" + escapeHtml(confidenceLevel) + "</dd>" +
      "<dt>Conflito</dt><dd>" + (disagreement ? "Sim" : "Não") + "</dd>" +
      "<dt>Uso</dt><dd>" + escapeHtml(state.preset === "realized" ? "Realizado / histórico" : state.preset === "custom" ? "Composição personalizada" : "Projeção / leitura") + "</dd>" +
      // O Motor tem a própria escolha (realizado tem precedência sobre
      // projetado). Quando ela difere da composição da planilha, mostrar as
      // duas evita confundir "o que o Motor concluiu" com "o que estou vendo".
      (motor.available && motor.source !== chosenSource
        ? "<dt>Escolha do Motor</dt><dd>" + escapeHtml(formatByVariable(variableKey, motor.value)) + " · " + escapeHtml(motor.sourceLabel) + "</dd>"
        : "<dt>Escolha do Motor</dt><dd>" + (motor.available ? "mesma fonte" : "sem valor selecionado") + "</dd>") +
      "</dl></aside></div>";

    Array.prototype.forEach.call(refs.drawerBody.querySelectorAll("[data-evidence-var]"), function (button) {
      button.addEventListener("click", function () {
        state.evidenceVariable = button.getAttribute("data-evidence-var");
        renderDrawer();
      });
    });
  }

  // --- Auditoria -------------------------------------------------------------

  function techCard(label, value) {
    return '<div class="cm-tech"><span>' + escapeHtml(label) + "</span><strong>" +
      (value === null || value === undefined || value === "" ? "Não informado" : escapeHtml(value)) + "</strong></div>";
  }

  function renderAuditTab(item) {
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
          copy: (entry.kind === "REALIZED" ? "Observação realizada" : "Observação projetada") +
            " de " + (formatByVariable(variableKey, entry.value) || "—") +
            (entry.note ? " — " + entry.note : "."),
        });
      });
    });
    trail.sort(function (a, b) { return String(a.time || "") < String(b.time || "") ? -1 : 1; });

    var reasons = (audit.statusReasons || []).concat(audit.qualityReasons || []);

    refs.drawerBody.innerHTML =
      '<div class="vf-banner is-info"><div class="vf-banner__content"><p class="vf-banner__title">Rastro da leitura disponível nesta resposta</p>' +
      '<p class="vf-banner__description">O backend não persiste histórico de auditoria da Central. O que aparece abaixo é o metadado da leitura atual — observações reais que vieram nesta resposta —, não um log de eventos gravado.</p></div></div>' +

      panel("Observações desta leitura", trail.length + " evidência(s) com valor", trail.length
        ? '<ol class="cm-audit">' + trail.map(function (entry) {
            return '<li class="cm-audit-row"><span class="cm-audit-time">' + escapeHtml(formatDateTime(entry.time) || "sem horário") + "</span>" +
              '<span class="cm-audit-dot" aria-hidden="true"></span>' +
              '<span class="cm-audit-copy"><strong>' + escapeHtml(entry.title) + "</strong><span>" + escapeHtml(entry.copy) + "</span></span></li>";
          }).join("") + "</ol>"
        : '<p class="cm-empty-note">Nenhuma observação com valor chegou para este produto.</p>') +

      panel("Decisão e classificação do Motor", "por que este item está neste estado", reasons.length
        ? "<ul class=\"cm-reason-list\">" + reasons.map(function (reason) { return "<li>" + escapeHtml(reason) + "</li>"; }).join("") + "</ul>" +
          '<p class="cm-empty-note">Status canônico: <strong>' + escapeHtml(item.status) + "</strong>. " +
          "Projetada — faltando: " + escapeHtml((audit.projectedMissing || []).join(", ") || "nada") +
          "; assumido 0: " + escapeHtml((audit.projectedAssumed || []).join(", ") || "nada") + ".</p>"
        : '<p class="cm-empty-note">Status canônico: <strong>' + escapeHtml(item.status) + "</strong>. O Motor não informou motivos adicionais nesta resposta.</p>") +

      panel("Metadados da leitura", "identidade e contexto", '<div class="cm-technical-grid">' +
        techCard("identity.itemId", audit.itemId || item.itemId) +
        techCard("identity.sku", audit.sku || item.sku) +
        techCard("marketplace", (audit.marketplace || item.marketplace || "").toUpperCase()) +
        techCard("cliente", audit.clientSlug || (state.client && state.client.slug)) +
        techCard("sourceMode", state.data.sourceMode) +
        techCard("última atualização", formatDateTime(state.data.lastUpdated)) +
        techCard("última venda", formatDateTime(audit.lastSoldAt)) +
        techCard("pedido mais recente", item.latestOrderId) +
        techCard("snapshot persistido", null) +
        "</div>") +

      panel("Regra de segurança", "não negociável", gatesHtml(item, contract.resolveComposition(item, state.selection), false));
  }

  function updateFooter(item) {
    var simulation = state.scenario ? contract.simulateScenario(item, state.scenario, state.selection) : null;
    refs.scenarioReset.disabled = !simulation || !simulation.changed.length;
    // Aplicação real permanece desabilitada nesta fase: não existe endpoint de
    // escrita, e nenhum endpoint antigo de precificação é reaproveitado aqui.
    refs.applyScenario.disabled = true;
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
    loadClients();
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
