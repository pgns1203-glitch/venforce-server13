/* Central de Margem — experiência operacional em JavaScript puro. */
(function (root) {
  "use strict";

  var contract = root.VFCentralMargemApi;
  if (!contract) return;

  var api = root.__VF_CENTRAL_MARGEM_API_CLIENT__ || contract.createClient();
  var STATUS_META = {
    HEALTHY: { label: "Saudável", icon: "✓", className: "is-success" },
    LOW_MARGIN: { label: "Margem baixa", icon: "!", className: "is-warning" },
    LOSS: { label: "Prejuízo", icon: "−", className: "is-danger" },
    UNVALIDATED: { label: "Não validado", icon: "?", className: "is-neutral" },
    SUSPECT_DATA: { label: "Dado suspeito", icon: "!", className: "is-warning" },
    RECONCILING: { label: "Em conciliação", icon: "↻", className: "is-info" },
  };
  var CONFIDENCE_META = {
    HIGH: { label: "Alta", className: "is-success" },
    MEDIUM: { label: "Média", className: "is-warning" },
    LOW: { label: "Baixa", className: "is-danger" },
    UNKNOWN: { label: "Desconhecida", className: "is-neutral" },
  };
  var VIEW_META = {
    general: {
      eyebrow: "Visão geral",
      title: "Quais produtos precisam de ação?",
      description: "Margem ruim e dado ruim são problemas diferentes. A fila prioriza ambos sem esconder a origem.",
    },
    price: {
      eyebrow: "Preço",
      title: "Os preços das fontes concordam?",
      description: "Compare preço atual, evidência da extensão e o último preço efetivamente vendido.",
    },
    cost: {
      eyebrow: "Custo",
      title: "O Motor tem um custo confiável?",
      description: "A Central apenas lê a Base vinculada. Qualquer correção continua sendo feita na tela de Bases.",
    },
    tax: {
      eyebrow: "Imposto",
      title: "Qual imposto sustenta a margem?",
      description: "Confira percentual, origem e confiança antes de agir sobre o preço.",
    },
    commission: {
      eyebrow: "Comissão",
      title: "A comissão usada está explicada?",
      description: "Diferencie tarifa atual da API e estimativas derivadas do histórico de pedidos.",
    },
    freight: {
      eyebrow: "Frete",
      title: "O frete previsto se confirmou no pedido?",
      description: "Divergências entre previsto e realizado ficam visíveis sem ocultar dados ausentes.",
    },
    receipt: {
      eyebrow: "Recebimento",
      title: "A venda foi recebida e conciliada?",
      description: "Separe valor vendido, recebimento líquido e evidência do Mercado Pago.",
    },
  };

  var state = {
    token: null,
    clients: [],
    client: null,
    marketplace: "meli",
    search: "",
    status: "",
    confidence: "",
    view: "general",
    page: 1,
    limit: 20,
    loading: false,
    clientsLoading: false,
    data: null,
    error: null,
    errorCode: null,
    searchTimer: null,
    requestSequence: 0,
    abortController: null,
    selectedItemId: null,
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

  function formatDateTime(value) {
    if (!value) return "—";
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleDateString("pt-BR") + " às " + date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }

  function statusHtml(status) {
    var meta = STATUS_META[status] || STATUS_META.UNVALIDATED;
    return '<span class="vf-status cm-status ' + meta.className + '"><span class="cm-status__icon" aria-hidden="true">' +
      meta.icon + "</span>" + meta.label + "</span>";
  }

  function confidenceHtml(confidence, compact) {
    var normalized = contract.normalizeConfidence(confidence);
    var meta = CONFIDENCE_META[normalized.level] || CONFIDENCE_META.UNKNOWN;
    var score = normalized.score === null || normalized.score === undefined ? "" : " · " + escapeHtml(normalized.score) + "%";
    var title = normalized.explanation ? ' title="' + escapeHtml(normalized.explanation) + '"' : "";
    return '<span class="vf-status ' + meta.className + '"' + title + ">" + meta.label + score + (compact ? "" : "") + "</span>";
  }

  function unavailable(label, title) {
    return '<span class="cm-unavailable"' + (title ? ' title="' + escapeHtml(title) + '"' : "") + ">" + escapeHtml(label || "Indisponível") + "</span>";
  }

  function moneyHtml(value, support, unavailableLabel) {
    var formatted = formatMoney(value);
    if (formatted === null) return unavailable(unavailableLabel || "Indisponível");
    return '<span class="cm-value"><span>' + formatted + "</span>" +
      (support ? '<span class="cm-value__support">' + escapeHtml(support) + "</span>" : "") + "</span>";
  }

  function percentHtml(value, support, unavailableLabel) {
    var formatted = formatPercent(value);
    if (formatted === null) return unavailable(unavailableLabel || "Pendente");
    return '<span class="cm-value"><span>' + formatted + "</span>" +
      (support ? '<span class="cm-value__support">' + escapeHtml(support) + "</span>" : "") + "</span>";
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
    refs.pageState = el("cm-page-state");
    refs.summary = el("cm-summary");
    refs.summaryScope = el("cm-summary-scope");
    refs.clearStatus = el("cm-clear-status");
    refs.tabs = el("cm-tabs");
    refs.viewEyebrow = el("cm-view-eyebrow");
    refs.viewTitle = el("cm-view-title");
    refs.viewDescription = el("cm-view-description");
    refs.confidence = el("cm-confidence-filter");
    refs.resultCount = el("cm-result-count");
    refs.activeFilters = el("cm-active-filters");
    refs.tableHost = el("cm-table-host");
    refs.pagination = el("cm-pagination");
    refs.drawer = el("cm-drawer");
    refs.drawerBackdrop = el("cm-drawer-backdrop");
    refs.drawerTitle = el("cm-drawer-title");
    refs.drawerBody = el("cm-drawer-body");
    refs.drawerPrev = el("cm-drawer-prev");
    refs.drawerNext = el("cm-drawer-next");
    refs.drawerPosition = el("cm-drawer-position");
    refs.toasts = el("cm-toasts");
  }

  function bindEvents() {
    refs.client.addEventListener("change", function () {
      var selected = state.clients.find(function (client) { return client.slug === refs.client.value; }) || null;
      state.client = selected;
      state.page = 1;
      state.status = "";
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

    refs.confidence.addEventListener("change", function () {
      state.confidence = refs.confidence.value;
      renderTableAndPagination();
      renderActiveFilters();
    });

    refs.clearStatus.addEventListener("click", function () {
      state.status = "";
      renderSummary();
      renderTableAndPagination();
      renderActiveFilters();
    });

    refs.tabs.addEventListener("click", function (event) {
      var button = event.target.closest("[data-view]");
      if (!button) return;
      setView(button.getAttribute("data-view"));
    });

    refs.summary.addEventListener("click", function (event) {
      var button = event.target.closest("[data-status-filter]");
      if (!button || !state.data) return;
      var value = button.getAttribute("data-status-filter");
      state.status = state.status === value ? "" : value;
      renderSummary();
      renderTableAndPagination();
      renderActiveFilters();
    });

    refs.activeFilters.addEventListener("click", function (event) {
      var button = event.target.closest("[data-clear-filter]");
      if (!button) return;
      if (button.getAttribute("data-clear-filter") === "status") state.status = "";
      if (button.getAttribute("data-clear-filter") === "confidence") {
        state.confidence = "";
        refs.confidence.value = "";
      }
      renderSummary();
      renderTableAndPagination();
      renderActiveFilters();
    });

    refs.tableHost.addEventListener("click", function (event) {
      var trigger = event.target.closest("[data-open-item]");
      var row = event.target.closest("tr[data-item-id]");
      if (trigger) {
        event.preventDefault();
        event.stopPropagation();
        openDrawer(trigger.getAttribute("data-open-item"), trigger);
      } else if (row && !event.target.closest("a, button, input, select")) {
        openDrawer(row.getAttribute("data-item-id"), row);
      }
    });

    refs.tableHost.addEventListener("keydown", function (event) {
      var row = event.target.closest("tr[data-item-id]");
      if (row && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        openDrawer(row.getAttribute("data-item-id"), row);
      }
    });

    refs.drawerBackdrop.addEventListener("click", closeDrawer);
    el("cm-drawer-close").addEventListener("click", closeDrawer);
    el("cm-drawer-close-footer").addEventListener("click", closeDrawer);
    refs.drawerPrev.addEventListener("click", function () { moveDrawer(-1); });
    refs.drawerNext.addEventListener("click", function () { moveDrawer(1); });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && refs.drawer.classList.contains("is-open")) closeDrawer();
    });
  }

  function syncUrl() {
    try {
      var params = new URLSearchParams(root.location.search || "");
      if (state.client) params.set("cliente", state.client.slug);
      else params.delete("cliente");
      root.history.replaceState({}, "", root.location.pathname + (params.toString() ? "?" + params.toString() : ""));
    } catch (_) { /* history pode estar bloqueado */ }
  }

  function setView(view) {
    if (!VIEW_META[view]) return;
    state.view = view;
    Array.prototype.forEach.call(refs.tabs.querySelectorAll("[data-view]"), function (button) {
      var active = button.getAttribute("data-view") === view;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    var meta = VIEW_META[view];
    refs.viewEyebrow.textContent = meta.eyebrow;
    refs.viewTitle.textContent = meta.title;
    refs.viewDescription.textContent = meta.description;
    renderTableAndPagination();
  }

  function loadClients() {
    state.clientsLoading = true;
    refs.client.disabled = true;
    refs.client.innerHTML = '<option value="">Carregando clientes…</option>';
    return api.getClients().then(function (result) {
      state.clientsLoading = false;
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

    return api.getCentral({
      clientSlug: state.client.slug,
      clientName: state.client.name,
      marketplace: state.marketplace,
      search: state.search,
      status: state.status,
      view: state.view,
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

  function renderAll() {
    refs.refresh.disabled = state.loading || !state.client;
    refs.refresh.classList.toggle("is-loading", state.loading);
    refs.search.disabled = !state.client;
    refs.marketplace.disabled = !state.client;
    renderContext();
    renderPageState();
    renderSummary();
    renderActiveFilters();
    renderTableAndPagination();
  }

  function renderContext() {
    var data = state.data;
    refs.updated.innerHTML = '<span class="cm-updated__label">Última atualização</span><strong>' +
      (data && data.lastUpdated ? escapeHtml(formatDateTime(data.lastUpdated)) : "—") + "</strong>";
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
        escapeHtml(state.error) + '</p></div><div class="vf-banner__actions">' + (contextError ? contextError.action : '') + '<button class="vf-btn vf-btn--secondary vf-btn--sm" type="button" id="cm-retry">Tentar novamente</button></div></div>';
      if (contextError) refs.pageState.querySelector('.vf-banner__title').textContent = contextError.title;
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

  function summaryCards() {
    var summary = state.data && state.data.summary || { monitored: 0, counts: {} };
    var counts = summary.counts || {};
    return [
      { status: "", label: "Monitorados", value: summary.monitored || 0, foot: "Todo o catálogo", modifier: "" },
      { status: "HEALTHY", label: "Saudáveis", value: counts.HEALTHY || 0, foot: "Sem exceção", modifier: "" },
      { status: "LOW_MARGIN", label: "Margem baixa", value: counts.LOW_MARGIN || 0, foot: "Abaixo da meta", modifier: "vf-kpi--warning" },
      { status: "LOSS", label: "Prejuízo", value: counts.LOSS || 0, foot: "Margem negativa", modifier: "vf-kpi--danger" },
      { status: "UNVALIDATED", label: "Não validados", value: counts.UNVALIDATED || 0, foot: "Dados ausentes", modifier: "" },
      { status: "SUSPECT_DATA", label: "Dados suspeitos", value: counts.SUSPECT_DATA || 0, foot: "Investigar fonte", modifier: "vf-kpi--warning" },
      { status: "RECONCILING", label: "Em conciliação", value: counts.RECONCILING || 0, foot: "Processamento pendente", modifier: "" },
    ];
  }

  function renderSummary() {
    var cards = summaryCards();
    refs.summary.innerHTML = cards.map(function (card) {
      var active = state.data && state.status === card.status;
      return '<button type="button" class="vf-kpi vf-kpi--interactive ' + card.modifier + (active ? " is-active" : "") + '" data-status-filter="' + card.status + '" aria-pressed="' + (active ? "true" : "false") + '"' + (!state.data || state.loading ? " disabled" : "") + ">" +
        '<span class="vf-kpi__label">' + card.label + '</span><strong class="vf-kpi__value">' + card.value + '</strong><span class="vf-kpi__foot">' + card.foot + "</span></button>";
    }).join("");
    refs.clearStatus.hidden = !state.status;
    if (!state.client) refs.summaryScope.textContent = "Selecione um cliente para iniciar a análise.";
    else if (state.loading) refs.summaryScope.textContent = "Atualizando o resumo…";
    else if (state.data && state.data.summary.scope === "page") refs.summaryScope.textContent = "Monitorados considera o catálogo; estados refletem os produtos desta página.";
    else refs.summaryScope.textContent = "Contagem operacional informada pelo Motor de Margem.";
  }

  function renderActiveFilters() {
    var chips = [];
    if (state.status) {
      chips.push('<span class="vf-active-filter">Status: ' + escapeHtml((STATUS_META[state.status] || STATUS_META.UNVALIDATED).label) +
        '<button type="button" class="vf-active-filter__remove" data-clear-filter="status" aria-label="Remover filtro de status">×</button></span>');
    }
    if (state.confidence) {
      chips.push('<span class="vf-active-filter">Confiança: ' + escapeHtml((CONFIDENCE_META[state.confidence] || CONFIDENCE_META.UNKNOWN).label) +
        '<button type="button" class="vf-active-filter__remove" data-clear-filter="confidence" aria-label="Remover filtro de confiança">×</button></span>');
    }
    refs.activeFilters.innerHTML = chips.join("");
  }

  function filteredItems() {
    var items = state.data ? state.data.items || [] : [];
    return items.filter(function (item) {
      if (state.status && item.status !== state.status) return false;
      if (state.confidence && item.confidence.level !== state.confidence) return false;
      return true;
    });
  }

  function productHtml(item) {
    var image = item.image
      ? '<img class="cm-product__image" src="' + escapeHtml(item.image) + '" alt="" loading="lazy">'
      : '<span class="cm-product__placeholder" aria-hidden="true">sem foto</span>';
    return '<div class="cm-product">' + image + '<div><span class="cm-product__title">' + escapeHtml(item.title) + '</span><span class="cm-product__meta"><span class="vf-mono">' +
      escapeHtml(item.itemId || "—") + "</span> · SKU <span class=\"vf-mono\">" + escapeHtml(item.sku || "—") + "</span></span></div></div>";
  }

  function actionHtml(item) {
    return '<button type="button" class="vf-btn vf-btn--ghost vf-btn--sm" data-open-item="' + escapeHtml(item.id) + '">Analisar</button>';
  }

  function rowClass(item, extraWarning) {
    if (item.status === "LOSS") return "row--danger";
    if (extraWarning || ["LOW_MARGIN", "SUSPECT_DATA", "RECONCILING"].indexOf(item.status) !== -1) return "row--warning";
    return "";
  }

  function difference(a, b) {
    var first = contract.numberOrNull(a);
    var second = contract.numberOrNull(b);
    return first === null || second === null ? null : first - second;
  }

  function deltaHtml(value, format) {
    var number = contract.numberOrNull(value);
    if (number === null) return unavailable("Sem comparação");
    var label = format === "percent" ? formatPercent(number, true) : formatMoney(number, true);
    var className = Math.abs(number) < 0.000001 ? "is-neutral" : "is-warning";
    return '<span class="cm-delta ' + className + '">' + (number === 0 ? "=" : number > 0 ? "↑" : "↓") + " " + label + "</span>";
  }

  function generalRows(items) {
    var head = "<tr><th>Status</th><th>Produto</th><th>Item ID</th><th class=\"num\">Preço</th><th class=\"num\">Margem projetada</th><th class=\"num\">Margem real</th><th>Confiança</th><th>Problema</th><th><span class=\"vf-visually-hidden\">Ação</span></th></tr>";
    var body = items.map(function (item) {
      return '<tr class="' + rowClass(item) + '" data-item-id="' + escapeHtml(item.id) + '" tabindex="0"><td>' + statusHtml(item.status) + "</td><td>" + productHtml(item) +
        '</td><td class="vf-mono">' + escapeHtml(item.itemId || "—") + '</td><td class="num">' + moneyHtml(item.variables.price.value) +
        '</td><td class="num">' + percentHtml(item.projected.margin, item.projected.estimated ? "estimada" : "") +
        '</td><td class="num">' + percentHtml(item.realized.margin, "", "Pendente") + "</td><td>" + confidenceHtml(item.confidence, true) +
        '</td><td><div class="cm-problem">' + escapeHtml(item.problem || "Sem problema informado") + '</div></td><td class="vf-table__actions">' + actionHtml(item) + "</td></tr>";
    }).join("");
    return { head: head, body: body };
  }

  function priceRows(items) {
    var head = "<tr><th>Produto</th><th class=\"num\">Preço API</th><th class=\"num\">Preço observado</th><th class=\"num\">Último vendido</th><th class=\"num\">Diferença</th><th>Confiança</th><th>Situação</th><th><span class=\"vf-visually-hidden\">Ação</span></th></tr>";
    var body = items.map(function (item) {
      var comparison = item.variables.observedPrice.value !== null ? item.variables.observedPrice.value : item.variables.lastSoldPrice.value;
      var delta = difference(item.variables.price.value, comparison);
      return '<tr class="' + rowClass(item, item.divergences.length > 0) + '" data-item-id="' + escapeHtml(item.id) + '" tabindex="0"><td>' + productHtml(item) +
        '</td><td class="num">' + moneyHtml(item.variables.price.value) + '</td><td class="num">' + moneyHtml(item.variables.observedPrice.value, "", "Indisponível") +
        '</td><td class="num">' + moneyHtml(item.variables.lastSoldPrice.value, "", "Sem venda") + '</td><td class="num">' + deltaHtml(delta, "money") +
        "</td><td>" + confidenceHtml(item.variables.price.confidence, true) + "</td><td>" + statusHtml(item.status) + '</td><td class="vf-table__actions">' + actionHtml(item) + "</td></tr>";
    }).join("");
    return { head: head, body: body };
  }

  function costRows(items) {
    var head = "<tr><th>Produto</th><th class=\"num\">Custo</th><th>Base / origem</th><th>Atualização</th><th>Confiança</th><th>Situação</th><th><span class=\"vf-visually-hidden\">Ação</span></th></tr>";
    var body = items.map(function (item) {
      var source = item.variables.cost.available ? item.variables.cost.sourceLabel : "Sem custo exposto";
      return '<tr class="' + rowClass(item, !item.variables.cost.available) + '" data-item-id="' + escapeHtml(item.id) + '" tabindex="0"><td>' + productHtml(item) +
        '</td><td class="num">' + moneyHtml(item.variables.cost.value, "", "Sem custo") + "</td><td>" + escapeHtml(source) +
        "</td><td>" + escapeHtml(formatDateTime(item.variables.cost.updatedAt)) + "</td><td>" + confidenceHtml(item.variables.cost.confidence, true) +
        "</td><td>" + statusHtml(item.status) + '</td><td class="vf-table__actions">' + actionHtml(item) + "</td></tr>";
    }).join("");
    return { head: head, body: body };
  }

  function taxRows(items) {
    var head = "<tr><th>Produto</th><th class=\"num\">Imposto</th><th>Fonte</th><th>Confiança</th><th>Situação</th><th><span class=\"vf-visually-hidden\">Ação</span></th></tr>";
    var body = items.map(function (item) {
      return '<tr class="' + rowClass(item, !item.variables.tax.available) + '" data-item-id="' + escapeHtml(item.id) + '" tabindex="0"><td>' + productHtml(item) +
        '</td><td class="num">' + percentHtml(item.variables.tax.value, "", "Indisponível") + "</td><td>" + escapeHtml(item.variables.tax.sourceLabel) +
        "</td><td>" + confidenceHtml(item.variables.tax.confidence, true) + "</td><td>" + statusHtml(item.status) + '</td><td class="vf-table__actions">' + actionHtml(item) + "</td></tr>";
    }).join("");
    return { head: head, body: body };
  }

  function commissionRows(items) {
    var head = "<tr><th>Produto</th><th class=\"num\">Comissão</th><th class=\"num\">Percentual</th><th>Fonte</th><th>Confiança</th><th>Situação</th><th><span class=\"vf-visually-hidden\">Ação</span></th></tr>";
    var body = items.map(function (item) {
      var commission = item.variables.commission;
      return '<tr class="' + rowClass(item, !commission.available) + '" data-item-id="' + escapeHtml(item.id) + '" tabindex="0"><td>' + productHtml(item) +
        '</td><td class="num">' + moneyHtml(commission.value, commission.estimated ? "estimada" : "", "Indisponível") + '</td><td class="num">' + percentHtml(commission.rate, "", "Indisponível") +
        "</td><td>" + escapeHtml(commission.sourceLabel) + "</td><td>" + confidenceHtml(commission.confidence, true) + "</td><td>" + statusHtml(item.status) +
        '</td><td class="vf-table__actions">' + actionHtml(item) + "</td></tr>";
    }).join("");
    return { head: head, body: body };
  }

  function freightRows(items) {
    var head = "<tr><th>Produto</th><th class=\"num\">Frete previsto / API</th><th class=\"num\">Frete realizado / pedido</th><th class=\"num\">Diferença</th><th>Confiança</th><th>Situação</th><th><span class=\"vf-visually-hidden\">Ação</span></th></tr>";
    var body = items.map(function (item) {
      var expected = item.variables.freightExpected;
      var actual = item.variables.freightActual;
      var delta = difference(actual.value, expected.value);
      var divergence = item.divergences.some(function (entry) { return String(entry.variable).toLowerCase().indexOf("fre") !== -1; });
      return '<tr class="' + rowClass(item, divergence) + '" data-item-id="' + escapeHtml(item.id) + '" tabindex="0"><td>' + productHtml(item) +
        '</td><td class="num">' + moneyHtml(expected.value, "", "Aguardando Motor") + '</td><td class="num">' + moneyHtml(actual.value, actual.detail || "", "Sem pedido") +
        '</td><td class="num">' + deltaHtml(delta, "money") + "</td><td>" + confidenceHtml(actual.available ? actual.confidence : expected.confidence, true) +
        "</td><td>" + statusHtml(item.status) + '</td><td class="vf-table__actions">' + actionHtml(item) + "</td></tr>";
    }).join("");
    return { head: head, body: body };
  }

  function receiptRows(items) {
    var head = "<tr><th>Produto</th><th class=\"num\">Valor vendido</th><th class=\"num\">Recebimento líquido</th><th class=\"num\">Mercado Pago</th><th class=\"num\">Margem realizada</th><th>Conciliação</th><th>Situação</th><th><span class=\"vf-visually-hidden\">Ação</span></th></tr>";
    var body = items.map(function (item) {
      return '<tr class="' + rowClass(item, item.reconciliation === "Parcial" || item.reconciliation === "Bloqueada") + '" data-item-id="' + escapeHtml(item.id) + '" tabindex="0"><td>' + productHtml(item) +
        '</td><td class="num">' + moneyHtml(item.variables.soldValue.value, "", "Sem venda") + '</td><td class="num">' + moneyHtml(item.variables.netReceipt.value, "", "Pendente") +
        '</td><td class="num">' + moneyHtml(item.variables.mercadoPago.value, "", "Não integrado") + '</td><td class="num">' + percentHtml(item.realized.margin, "", "Pendente") +
        "</td><td>" + escapeHtml(item.reconciliation || "Pendente") + "</td><td>" + statusHtml(item.status) + '</td><td class="vf-table__actions">' + actionHtml(item) + "</td></tr>";
    }).join("");
    return { head: head, body: body };
  }

  function tableParts(items) {
    if (state.view === "price") return priceRows(items);
    if (state.view === "cost") return costRows(items);
    if (state.view === "tax") return taxRows(items);
    if (state.view === "commission") return commissionRows(items);
    if (state.view === "freight") return freightRows(items);
    if (state.view === "receipt") return receiptRows(items);
    return generalRows(items);
  }

  function loadingTable() {
    var rows = "";
    for (var i = 0; i < 6; i += 1) {
      rows += '<tr class="vf-table__loading"><td><div class="vf-skeleton vf-skeleton--row"></div></td><td><div class="vf-skeleton vf-skeleton--row"></div></td><td><div class="vf-skeleton vf-skeleton--row"></div></td><td><div class="vf-skeleton vf-skeleton--row"></div></td></tr>';
    }
    return '<div class="vf-table-wrap cm-table-wrap" aria-busy="true"><table class="vf-table cm-table"><thead><tr><th>Carregando produtos</th><th>Valores</th><th>Fontes</th><th>Situação</th></tr></thead><tbody>' + rows + "</tbody></table></div>";
  }

  function renderTableAndPagination() {
    if (state.loading) {
      refs.tableHost.innerHTML = loadingTable();
      refs.pagination.hidden = true;
      refs.resultCount.textContent = "Carregando…";
      return;
    }
    if (!state.client) {
      refs.tableHost.innerHTML = stateHtml("empty", "Nenhum cliente selecionado", "Escolha um cliente no cabeçalho para carregar a fila operacional.");
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
      var hasFilters = state.search || state.status || state.confidence;
      refs.tableHost.innerHTML = stateHtml("empty", hasFilters ? "Nenhum resultado" : "Nenhum item monitorado",
        hasFilters ? "Ajuste a busca ou remova os filtros operacionais." : "Sincronize o catálogo em Anúncios ML e atualize esta leitura.",
        hasFilters ? '<div class="vf-empty__actions"><button class="vf-btn vf-btn--secondary" type="button" id="cm-clear-all">Limpar filtros</button></div>' : "");
      var clear = el("cm-clear-all");
      if (clear) clear.addEventListener("click", clearAllFilters);
      refs.pagination.hidden = true;
      return;
    }
    var parts = tableParts(items);
    refs.tableHost.innerHTML = '<div class="vf-table-wrap cm-table-wrap"><table class="vf-table vf-table--compact cm-table"><thead>' + parts.head + "</thead><tbody>" + parts.body + "</tbody></table></div>";
    renderPagination();
  }

  function clearAllFilters() {
    state.status = "";
    state.confidence = "";
    state.search = "";
    state.page = 1;
    refs.search.value = "";
    refs.confidence.value = "";
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

  function selectedItems() { return filteredItems(); }

  function findSelectedItem() {
    var items = state.data ? state.data.items || [] : [];
    return items.find(function (item) { return item.id === state.selectedItemId; }) || null;
  }

  function openDrawer(itemId, trigger) {
    var items = selectedItems();
    var item = items.find(function (entry) { return entry.id === itemId; });
    if (!item) return;
    if (!refs.drawer.classList.contains("is-open")) state.previousFocus = trigger || document.activeElement;
    state.selectedItemId = item.id;
    renderDrawer(item);
    refs.drawerBackdrop.classList.add("is-open");
    refs.drawer.classList.add("is-open");
    document.body.classList.add("vf-no-scroll");
    refs.drawer.focus();
  }

  function closeDrawer() {
    if (!refs.drawer || !refs.drawer.classList.contains("is-open")) return;
    refs.drawer.classList.remove("is-open");
    refs.drawerBackdrop.classList.remove("is-open");
    document.body.classList.remove("vf-no-scroll");
    state.selectedItemId = null;
    if (state.previousFocus && typeof state.previousFocus.focus === "function" && document.contains(state.previousFocus)) state.previousFocus.focus();
    state.previousFocus = null;
  }

  function moveDrawer(direction) {
    var items = selectedItems();
    var index = items.findIndex(function (item) { return item.id === state.selectedItemId; });
    var next = index + direction;
    if (next < 0 || next >= items.length) return;
    state.selectedItemId = items[next].id;
    renderDrawer(items[next]);
    refs.drawerBody.scrollTop = 0;
  }

  function miniKpi(label, valueHtml) {
    return '<div class="cm-mini-kpi"><span class="cm-mini-kpi__label">' + escapeHtml(label) + '</span><span class="cm-mini-kpi__value">' + valueHtml + "</span></div>";
  }

  function variableDisplay(entry) {
    if (!entry || entry.value === null) return unavailable("Indisponível", entry && entry.confidence && entry.confidence.explanation);
    if (entry.format === "percent") return percentHtml(entry.value);
    var support = entry.rate !== null ? formatPercent(entry.rate) : entry.estimated ? "estimado" : "";
    return moneyHtml(entry.value, support);
  }

  function variableRow(label, entry) {
    entry = entry || { value: null, sourceLabel: "Fonte não informada", confidence: { level: "UNKNOWN" } };
    return '<tr><td><span class="cm-variable-name">' + escapeHtml(label) + "</span>" +
      (entry.detail ? '<span class="cm-source-detail">' + escapeHtml(entry.detail) + "</span>" : "") +
      '</td><td class="num">' + variableDisplay(entry) + "</td><td>" + escapeHtml(entry.sourceLabel || "Fonte não informada") +
      (entry.updatedAt ? '<span class="cm-source-detail">' + escapeHtml(formatDateTime(entry.updatedAt)) + "</span>" : "") +
      "</td><td>" + confidenceHtml(entry.confidence, true) + "</td></tr>";
  }

  function divergencesHtml(item) {
    if (!item.divergences.length) {
      return '<div class="vf-alert is-success">Nenhuma divergência foi explicitada pelas fontes disponíveis.</div>';
    }
    return '<div class="cm-divergence-list">' + item.divergences.map(function (entry) {
      var values = entry.valueA === null || entry.valueB === null ? "Valores não informados" :
        (entry.format === "percent" ? formatPercent(entry.valueA) + " × " + formatPercent(entry.valueB) : formatMoney(entry.valueA) + " × " + formatMoney(entry.valueB));
      return '<article class="cm-divergence"><div class="cm-divergence__title"><span>' + escapeHtml(entry.variable) + '</span><span class="vf-tag is-warning">' + escapeHtml(entry.type) + "</span></div><p><strong>" +
        escapeHtml(entry.sourceA) + " × " + escapeHtml(entry.sourceB) + ":</strong> " + escapeHtml(values) + ". " + escapeHtml(entry.explanation) + "</p></article>";
    }).join("") + "</div>";
  }

  function actionButton(label, options) {
    var opts = options || {};
    if (opts.href && !opts.disabled) return '<a class="vf-btn vf-btn--secondary vf-btn--sm" href="' + escapeHtml(opts.href) + '"' + (opts.external ? ' target="_blank" rel="noopener"' : "") + ">" + escapeHtml(label) + "</a>";
    return '<button class="vf-btn vf-btn--secondary vf-btn--sm" type="button"' + (opts.id ? ' id="' + opts.id + '"' : "") +
      (opts.disabled ? " disabled" : "") + (opts.title ? ' title="' + escapeHtml(opts.title) + '"' : "") + ">" + escapeHtml(label) + "</button>";
  }

  function renderDrawer(item) {
    var items = selectedItems();
    var index = items.findIndex(function (entry) { return entry.id === item.id; });
    refs.drawerTitle.textContent = item.title;
    refs.drawerPrev.disabled = index <= 0;
    refs.drawerNext.disabled = index < 0 || index >= items.length - 1;
    refs.drawerPosition.textContent = index >= 0 ? (index + 1) + " de " + items.length + " produtos neste recorte" : "";
    var image = item.image
      ? '<img class="cm-identification__image" src="' + escapeHtml(item.image) + '" alt="Imagem do produto">'
      : '<span class="cm-identification__placeholder">Sem foto</span>';
    var baseHref = "bases.html?busca=" + encodeURIComponent(item.itemId || item.sku || "");
    var orderHref = "fechamentos-api.html?cliente=" + encodeURIComponent(state.client.slug) + (item.latestOrderId ? "&search=" + encodeURIComponent(item.latestOrderId) : "");
    var variables = item.variables;

    refs.drawerBody.innerHTML =
      '<section class="cm-drawer-section"><div class="cm-identification">' + image + '<div><h3 class="cm-identification__title">' + escapeHtml(item.title) + '</h3><div class="cm-identification__meta"><span>MLB/item <strong class="vf-mono">' +
      escapeHtml(item.itemId || "—") + '</strong></span><span>SKU <strong class="vf-mono">' + escapeHtml(item.sku || "—") + "</strong></span><span>Cliente <strong>" + escapeHtml(state.client.name) + "</strong></span></div></div></div></section>" +

      '<section class="cm-drawer-section"><div class="cm-drawer-section__header"><h3 class="cm-drawer-section__title">Resumo</h3></div><div class="cm-drawer-kpis">' +
      miniKpi("Status", statusHtml(item.status)) +
      miniKpi("Margem projetada", percentHtml(item.projected.margin, item.projected.estimated ? "estimada" : "")) +
      miniKpi("Margem real", percentHtml(item.realized.margin, "", "Pendente")) +
      miniKpi("Margem alvo", percentHtml(item.targetMargin, "", "Não informada")) +
      miniKpi("Confiança geral", confidenceHtml(item.confidence, true)) +
      '</div><p class="cm-simulator__note">' + escapeHtml(item.problem || "Sem problema principal informado.") + "</p></section>" +

      '<section class="cm-drawer-section" id="cm-source-investigation"><div class="cm-drawer-section__header"><h3 class="cm-drawer-section__title">Variáveis e fontes</h3><span class="vf-tag is-neutral">Somente leitura</span></div><div class="vf-table-wrap"><table class="vf-table vf-table--compact cm-variable-table"><thead><tr><th>Variável</th><th class="num">Valor</th><th>Fonte / atualização</th><th>Confiança</th></tr></thead><tbody>' +
      variableRow("Preço atual", variables.price) +
      variableRow("Preço observado / extensão", variables.observedPrice) +
      variableRow("Último preço vendido", variables.lastSoldPrice) +
      variableRow("Custo", variables.cost) +
      variableRow("Imposto", variables.tax) +
      variableRow("Comissão", variables.commission) +
      variableRow("Frete previsto", variables.freightExpected) +
      variableRow("Frete realizado", variables.freightActual) +
      variableRow("Valor vendido", variables.soldValue) +
      variableRow("Recebimento líquido", variables.netReceipt) +
      "</tbody></table></div></section>" +

      '<section class="cm-drawer-section"><div class="cm-drawer-section__header"><h3 class="cm-drawer-section__title">Divergências</h3><span class="vf-badge">' + item.divergences.length + "</span></div>" + divergencesHtml(item) + "</section>" +

      '<section class="cm-drawer-section"><div class="cm-drawer-section__header"><h3 class="cm-drawer-section__title">Simulação de preço</h3></div><div class="cm-simulator"><form class="cm-simulator__form" id="cm-simulator-form"><div class="vf-field"><label class="vf-field__label" for="cm-simulator-price">Novo preço</label><div class="vf-input-group"><span class="vf-input-prefix">R$</span><input class="vf-input" id="cm-simulator-price" inputmode="decimal" autocomplete="off" value="' +
      escapeHtml(variables.price.value !== null ? Number(variables.price.value).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "") + '" placeholder="0,00"></div><span class="vf-field__hint">A simulação não altera o anúncio.</span></div><button class="vf-btn vf-btn--primary" type="submit">Calcular</button><button class="vf-btn vf-btn--secondary" type="button" disabled title="AGUARDANDO_MOTOR: escrita segura ainda não disponível">Aplicar preço</button></form><div class="cm-simulator__result" id="cm-simulator-result"><div class="vf-alert is-info">Informe um preço para calcular quando custo, imposto, comissão e frete estiverem disponíveis.</div></div></div></section>' +

      '<section class="cm-drawer-section"><div class="cm-drawer-section__header"><h3 class="cm-drawer-section__title">Ações de investigação</h3></div><div class="cm-action-grid">' +
      actionButton("Ver na Base", { href: baseHref }) +
      actionButton("Ver pedido", { href: orderHref, disabled: !item.latestOrderId }) +
      actionButton("Ver Mercado Pago", { disabled: true, title: "AGUARDANDO_MOTOR: integração Mercado Pago indisponível" }) +
      actionButton("Investigar fontes", { id: "cm-investigate" }) +
      actionButton("Registrar divergência", { disabled: true, title: "AGUARDANDO_MOTOR: endpoint de auditoria ainda não disponível" }) +
      (item.permalink ? actionButton("Abrir anúncio", { href: item.permalink, external: true }) : "") +
      "</div></section>";

    bindDrawerContent(item);
  }

  function parsePrice(value) {
    var text = String(value || "").trim().replace(/\s/g, "").replace(/^R\$/, "");
    if (!text) return null;
    if (text.indexOf(",") !== -1) text = text.replace(/\./g, "").replace(",", ".");
    var number = Number(text);
    return Number.isFinite(number) ? number : null;
  }

  function missingLabels(missing) {
    var labels = { price: "preço", cost: "custo", taxRate: "imposto", commissionRate: "comissão", freight: "frete" };
    return (missing || []).map(function (key) { return labels[key] || key; }).join(", ");
  }

  function bindDrawerContent(item) {
    var form = el("cm-simulator-form");
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var result = contract.simulatePrice(item, parsePrice(el("cm-simulator-price").value));
      var host = el("cm-simulator-result");
      if (!result.computable) {
        host.innerHTML = '<div class="vf-alert is-warning">Simulação pendente. Faltam: ' + escapeHtml(missingLabels(result.missing)) + ".</div>";
        return;
      }
      host.innerHTML = '<div class="cm-simulator__metrics">' +
        miniKpi("Margem projetada", percentHtml(result.margin)) +
        miniKpi("Lucro projetado", moneyHtml(result.profit)) +
        miniKpi("Vs. margem atual", result.deltaCurrentPp === null ? unavailable("Sem comparação") : '<span class="cm-delta ' + (result.deltaCurrentPp < 0 ? "is-danger" : "is-neutral") + '">' + (result.deltaCurrentPp > 0 ? "+" : "") + escapeHtml(result.deltaCurrentPp.toLocaleString("pt-BR")) + " pp</span>") +
        miniKpi("Vs. meta", result.deltaTargetPp === null ? unavailable("Meta não informada") : '<span class="cm-delta ' + (result.deltaTargetPp < 0 ? "is-danger" : "is-neutral") + '">' + (result.deltaTargetPp > 0 ? "+" : "") + escapeHtml(result.deltaTargetPp.toLocaleString("pt-BR")) + " pp</span>") +
        '</div><p class="cm-simulator__note">Fonte dos coeficientes: ' + escapeHtml(result.source) + ". Resultado apenas informativo; nenhuma escrita foi executada.</p>";
    });
    var investigate = el("cm-investigate");
    if (investigate) investigate.addEventListener("click", function () {
      var target = el("cm-source-investigation");
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      toast("Fontes abertas para investigação. Nenhuma alteração foi registrada.");
    });
  }

  function init() {
    cacheRefs();
    state.token = root.localStorage && root.localStorage.getItem("vf-token");
    if (typeof root.initLayout === "function") root.initLayout();
    bindEvents();
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
    setView: setView,
    openDrawer: openDrawer,
    closeDrawer: closeDrawer,
    reload: loadCentral,
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})(window);
