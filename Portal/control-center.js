(function () {
  "use strict";

  const STORAGE_KEY = "vf-token";
  const USER_KEY = "vf-user";
  const CONTROL_CENTER_MODE = "mock";
  const API_BASE_HINT = "https://venforce-server.onrender.com";
  const SLOW_LIMIT_MS = 1000;

  initLayout();

  const state = {
    entries: [],
    selectedId: null,
    statusFilter: "all",
    screenFilter: "all",
    search: "",
    activeTab: "request",
    debug: true,
    user: readUserSafe(),
    token: localStorage.getItem(STORAGE_KEY) || ""
  };

  const els = {};

  document.addEventListener("DOMContentLoaded", initControlCenter);

  async function initControlCenter() {
    cacheElements();
    renderSessionContext();
    bindEvents();

    const rawEntries = CONTROL_CENTER_MODE === "mock"
      ? loadMockData()
      : await loadBackendData();

    state.entries = rawEntries.map(normalizeEntry);
    state.selectedId = state.entries[0]?.id || null;
    hydrateScreenFilter();
    renderAll();
  }

  function cacheElements() {
    els.rows = document.querySelector("[data-vfc-rows]");
    els.detail = document.querySelector("[data-vfc-detail]");
    els.visibleCount = document.querySelector("[data-vfc-visible-count]");
    els.statusButtons = Array.from(document.querySelectorAll("[data-vfc-status-filter]"));
    els.screenFilter = document.querySelector("[data-vfc-screen-filter]");
    els.search = document.querySelector("[data-vfc-search]");
    els.clear = document.querySelector("[data-vfc-clear]");
    els.debug = document.querySelector("[data-vfc-debug]");
    els.userName = document.querySelector("[data-vfc-user-name]");
    els.userRole = document.querySelector("[data-vfc-user-role]");
    els.tokenState = document.querySelector("[data-vfc-token-state]");
    els.apiBase = document.querySelector("[data-vfc-api-base]");
    els.summary = {
      total: document.querySelector('[data-vfc-summary="total"]'),
      ok: document.querySelector('[data-vfc-summary="ok"]'),
      "4xx": document.querySelector('[data-vfc-summary="4xx"]'),
      "5xx": document.querySelector('[data-vfc-summary="5xx"]'),
      slow: document.querySelector('[data-vfc-summary="slow"]'),
      avg: document.querySelector('[data-vfc-summary="avg"]'),
      lastError: document.querySelector('[data-vfc-summary="lastError"]')
    };
  }

  function bindEvents() {
    els.statusButtons.forEach((button) => {
      button.addEventListener("click", () => {
        state.statusFilter = button.dataset.vfcStatusFilter || "all";
        els.statusButtons.forEach((item) => item.classList.toggle("is-active", item === button));
        renderAll();
      });
    });

    els.screenFilter.addEventListener("change", () => {
      state.screenFilter = els.screenFilter.value;
      renderAll();
    });

    els.search.addEventListener("input", () => {
      state.search = els.search.value.trim().toLowerCase();
      renderAll();
    });

    els.clear.addEventListener("click", () => {
      state.entries = [];
      state.selectedId = null;
      renderAll();
    });

    els.debug.addEventListener("click", () => {
      state.debug = !state.debug;
      els.debug.textContent = `debug mock: ${state.debug ? "on" : "off"}`;
      els.debug.setAttribute("aria-pressed", String(state.debug));

      if (state.debug && state.entries.length === 0) {
        state.entries = loadMockData().map(normalizeEntry);
        state.selectedId = state.entries[0]?.id || null;
      }

      renderAll();
    });

    document.addEventListener("keydown", (event) => {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "d") {
        event.preventDefault();
        els.debug.click();
      }
    });
  }

  function renderSessionContext() {
    const userName = state.user.nome || state.user.email || "Usuário";
    const role = state.user.role || "sem role";

    els.userName.textContent = sanitizeText(userName);
    els.userRole.textContent = sanitizeText(role);
    els.tokenState.textContent = state.token ? maskSensitive(`Bearer ${state.token}`) : "ausente";
    els.apiBase.textContent = API_BASE_HINT;
  }

  function hydrateScreenFilter() {
    const screens = Array.from(new Set(state.entries.map((entry) => entry.screen))).sort();
    els.screenFilter.innerHTML = '<option value="all">Todas</option>';
    screens.forEach((screen) => {
      const option = document.createElement("option");
      option.value = screen;
      option.textContent = screen;
      els.screenFilter.appendChild(option);
    });
  }

  function renderAll() {
    renderSummary();
    renderRows();
    renderDetail();
  }

  function renderSummary() {
    const total = state.entries.length;
    const ok = state.entries.filter((entry) => entry.status >= 200 && entry.status < 300).length;
    const four = state.entries.filter((entry) => entry.status >= 400 && entry.status < 500).length;
    const five = state.entries.filter((entry) => entry.status >= 500).length;
    const slow = state.entries.filter((entry) => entry.duration >= SLOW_LIMIT_MS).length;
    const timed = state.entries.filter((entry) => entry.duration > 0);
    const avg = timed.length
      ? Math.round(timed.reduce((sum, entry) => sum + entry.duration, 0) / timed.length)
      : 0;
    const lastError = state.entries.filter((entry) => entry.status >= 400 || entry.status === 0).at(-1);

    els.summary.total.textContent = String(total);
    els.summary.ok.textContent = String(ok);
    els.summary["4xx"].textContent = String(four);
    els.summary["5xx"].textContent = String(five);
    els.summary.slow.textContent = String(slow);
    els.summary.avg.textContent = `${avg}ms`;
    els.summary.lastError.textContent = lastError ? `${lastError.status || "NET"} ${lastError.endpoint}` : "none";
  }

  function getVisibleEntries() {
    return state.entries.filter((entry) => {
      if (state.statusFilter === "ok" && !isOk(entry)) return false;
      if (state.statusFilter === "4xx" && !is4xx(entry)) return false;
      if (state.statusFilter === "5xx" && !is5xx(entry)) return false;
      if (state.statusFilter === "slow" && !isSlow(entry)) return false;
      if (state.screenFilter !== "all" && entry.screen !== state.screenFilter) return false;

      if (state.search) {
        const haystack = [
          entry.endpoint,
          entry.method,
          entry.screen,
          entry.description,
          String(entry.status),
          JSON.stringify(entry.payload || {}),
          JSON.stringify(entry.response || {}),
          JSON.stringify(entry.error || {})
        ].join(" ").toLowerCase();

        if (!haystack.includes(state.search)) return false;
      }

      return true;
    });
  }

  function renderRows() {
    const rows = getVisibleEntries();
    els.visibleCount.textContent = `${rows.length} visíveis`;

    if (!rows.length) {
      els.rows.innerHTML = '<tr><td class="vfc-empty-table" colspan="7">nenhuma request corresponde aos filtros atuais</td></tr>';
      return;
    }

    els.rows.innerHTML = rows.map((entry) => {
      const selected = entry.id === state.selectedId ? " is-selected" : "";
      const timeClass = isSlow(entry) ? " is-slow" : "";

      return `
        <tr class="${selected}" data-vfc-request-id="${escapeHtml(entry.id)}">
          <td class="vfc-mono">${escapeHtml(entry.time)}</td>
          <td>${escapeHtml(entry.screen)}</td>
          <td><span class="vfc-method">${escapeHtml(entry.method)}</span></td>
          <td><span class="vfc-endpoint">${escapeHtml(entry.endpoint)}</span></td>
          <td><span class="vfc-status ${getStatusClass(entry)}">${formatStatus(entry.status)}</span></td>
          <td><span class="vfc-time${timeClass}">${formatDuration(entry.duration)}</span></td>
          <td>${escapeHtml(entry.description)}</td>
        </tr>
      `;
    }).join("");

    els.rows.querySelectorAll("[data-vfc-request-id]").forEach((row) => {
      row.addEventListener("click", () => {
        state.selectedId = row.dataset.vfcRequestId;
        state.activeTab = "request";
        renderAll();
      });
    });
  }

  function renderDetail() {
    const selected = state.entries.find((entry) => entry.id === state.selectedId);

    if (!selected) {
      els.detail.innerHTML = `
        <div class="vfc-detail-empty">
          <span class="vfc-empty-dot"></span>
          <p>Selecione uma request para inspecionar payload, response e contexto seguro.</p>
        </div>
      `;
      return;
    }

    els.detail.innerHTML = `
      <div class="vfc-detail-head">
        <div class="vfc-detail-title">
          <h2>${escapeHtml(selected.endpoint)}</h2>
          <span>${escapeHtml(selected.screen)} · ${escapeHtml(selected.time)}</span>
        </div>
        <span class="vfc-status ${getStatusClass(selected)}">${formatStatus(selected.status)}</span>
      </div>
      <div class="vfc-chip-row">
        <span class="vfc-chip">${escapeHtml(selected.method)}</span>
        <span class="vfc-chip ${getChipClass(selected)}">${formatDuration(selected.duration)}</span>
        <span class="vfc-chip">auth masked</span>
        <span class="vfc-chip">${state.debug ? "debug on" : "debug off"}</span>
      </div>
      <div class="vfc-tabs" role="tablist" aria-label="Detalhes da request">
        ${["request", "response", "contexto", "erro"].map((tab) => `
          <button class="vfc-tab ${state.activeTab === tab ? "is-active" : ""}" type="button" data-vfc-tab="${tab}">
            ${tab}
          </button>
        `).join("")}
      </div>
      <div class="vfc-detail-body">
        ${renderTab(selected)}
      </div>
    `;

    els.detail.querySelectorAll("[data-vfc-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        state.activeTab = button.dataset.vfcTab;
        renderDetail();
      });
    });
  }

  function renderTab(entry) {
    if (state.activeTab === "request") {
      return `
        ${renderKv({
          url: API_BASE_HINT + entry.endpoint,
          método: entry.method,
          status: formatStatus(entry.status),
          duração: formatDuration(entry.duration),
          origem: entry.screen,
          authorization: state.token ? maskSensitive(`Bearer ${state.token}`) : "ausente"
        })}
        <p class="vfc-code-label">payload enviado</p>
        <pre class="vfc-code">${escapeHtml(formatJson(sanitizePayload(entry.payload || { empty: true })))}</pre>
      `;
    }

    if (state.activeTab === "response") {
      return `
        ${renderKv({
          status: formatStatus(entry.status),
          tipo: entry.status === 0 ? "network" : "application/json",
          cache: "no-store",
          request_id: `mock-${entry.id}`
        })}
        <p class="vfc-code-label">response json</p>
        <pre class="vfc-code">${escapeHtml(formatJson(sanitizePayload(entry.response || { ok: false, network: "sem resposta HTTP" })))}</pre>
      `;
    }

    if (state.activeTab === "contexto") {
      return `
        ${renderKv({
          usuário: state.user.nome || state.user.email || "Usuário",
          role: state.user.role || "sem role",
          ambiente: "mock/frontend",
          api_base: API_BASE_HINT,
          token: state.token ? maskSensitive(`Bearer ${state.token}`) : "ausente",
          localStorage: "vf-token, vf-user",
          origem: entry.screen
        })}
        <p class="vfc-code-label">contexto seguro</p>
        <pre class="vfc-code">${escapeHtml(formatJson(sanitizePayload({
          user: {
            id: state.user.id || "mock-user",
            nome: state.user.nome || state.user.email || "Usuário",
            role: state.user.role || "sem role"
          },
          screen: entry.screen,
          routeGuard: entry.endpoint.includes("/admin") ? "admin-only" : "authenticated",
          token: state.token ? "presente" : "ausente",
          tokenMasked: state.token ? maskSensitive(`Bearer ${state.token}`) : "ausente",
          tokenFull: "nunca exibir token completo"
        })))}</pre>
      `;
    }

    return `
      ${renderKv({
        tipo: entry.error?.type || "none",
        severidade: getErrorSeverity(entry),
        último_erro: entry.error?.message || "sem erro",
        ação_sugerida: entry.error?.action || entry.error?.hint || "nenhuma"
      })}
      <p class="vfc-code-label">erro formatado</p>
      <pre class="vfc-code ${entry.error ? "vfc-error-box" : ""}">${escapeHtml(formatJson(sanitizePayload(entry.error || { ok: true, message: "request sem erro" })))}</pre>
    `;
  }

  function renderKv(map) {
    return `<dl class="vfc-kv-grid">${
      Object.entries(map).map(([key, value]) => `
        <dt>${escapeHtml(key)}</dt>
        <dd>${escapeHtml(String(value))}</dd>
      `).join("")
    }</dl>`;
  }

  function loadMockData() {
    return [
      {
        id: "req-001",
        time: "09:41:03",
        screen: "bases.html",
        method: "GET",
        endpoint: "/bases",
        status: 200,
        duration: 84,
        description: "bases carregadas",
        payload: null,
        response: {
          ok: true,
          bases: [
            { id: 41, slug: "loja-meli-principal", nome: "Loja ML Principal", ativo: true, updated_at: "2026-06-08T12:34:01.000Z" },
            { id: 42, slug: "loja-shopee-outlet", nome: "Loja Shopee Outlet", ativo: true, updated_at: "2026-05-14T18:03:18.000Z" }
          ]
        }
      },
      {
        id: "req-002",
        time: "09:41:04",
        screen: "bases.html",
        method: "GET",
        endpoint: "/base-vinculos",
        status: 200,
        duration: 126,
        description: "vínculos + sugestões",
        payload: null,
        response: {
          ok: true,
          bases: [
            {
              id: 41,
              slug: "loja-meli-principal",
              vinculo: { cliente_slug: "alpha-store", cliente_nome: "Alpha Store", marketplace: "meli", origem: "manual" },
              sugestao: null
            },
            {
              id: 42,
              slug: "loja-shopee-outlet",
              vinculo: null,
              sugestao: { cliente_slug: "outlet-sp", marketplace: "shopee", confianca: 76 }
            }
          ]
        }
      },
      {
        id: "req-003",
        time: "09:42:18",
        screen: "bases.html",
        method: "POST",
        endpoint: "/importar-base",
        status: 201,
        duration: 612,
        description: "base importada",
        payload: {
          formData: true,
          arquivo: "custos-junho-alpha.xlsx",
          baseSlug: "loja-meli-principal",
          rows: 1842
        },
        response: {
          ok: true,
          mensagem: "Base importada com sucesso",
          base: { slug: "loja-meli-principal", custos_importados: 1842, custos_atualizados: 391 }
        }
      },
      {
        id: "req-004",
        time: "09:45:50",
        screen: "relatorios.html",
        method: "GET",
        endpoint: "/automacoes/relatorios",
        status: 200,
        duration: 173,
        description: "relatórios recentes",
        payload: null,
        response: {
          ok: true,
          total: 3,
          relatorios: [
            { id: 882, cliente_slug: "alpha-store", status: "concluido", itens_criticos: 12, itens_sem_base: 44, mc_media: 0.183 },
            { id: 881, cliente_slug: "beta-home", status: "concluido", itens_criticos: 0, itens_sem_base: 3, mc_media: 0.216 }
          ]
        }
      },
      {
        id: "req-005",
        time: "09:47:12",
        screen: "automacoes.html",
        method: "POST",
        endpoint: "/automacoes/diagnostico-completo/start",
        status: 200,
        duration: 2400,
        description: "diagnóstico iniciado · lento",
        payload: {
          clienteSlug: "alpha-store",
          baseSlug: "loja-meli-principal",
          margemAlvo: 0.18,
          marketplace: "meli"
        },
        response: {
          ok: true,
          id: 883,
          status: "processando",
          estimativa: "2-4 min"
        }
      },
      {
        id: "req-006",
        time: "09:48:19",
        screen: "automacoes.html",
        method: "GET",
        endpoint: "/automacoes/diagnostico-completo/883",
        status: 200,
        duration: 311,
        description: "polling diagnóstico",
        payload: null,
        response: {
          ok: true,
          relatorio: {
            id: 883,
            status: "processando",
            progresso: 62,
            processados: 392,
            total: 628
          }
        }
      },
      {
        id: "req-007",
        time: "09:49:02",
        screen: "dashboard.html",
        method: "GET",
        endpoint: "/admin/ml-tokens",
        status: 403,
        duration: 68,
        description: "sem permissão admin",
        payload: null,
        response: {
          ok: false,
          erro: "Acesso restrito a administradores."
        },
        error: {
          type: "permission",
          message: "Usuário membro tentou acessar rota admin-only.",
          hint: "Ocultar bloco sensível ou degradar para score parcial."
        }
      },
      {
        id: "req-008",
        time: "09:50:44",
        screen: "dashboard.html",
        method: "GET",
        endpoint: "/operacao/base-cobertura",
        status: 401,
        duration: 42,
        description: "token inválido",
        payload: null,
        response: {
          ok: false,
          erro: "Token inválido ou expirado"
        },
        error: {
          type: "auth",
          message: "JWT expirado ou ausente no localStorage.",
          action: "Limpar sessão e redirecionar para index.html."
        }
      },
      {
        id: "req-009",
        time: "09:52:11",
        screen: "clickup-executivo.html",
        method: "GET",
        endpoint: "/api/clickup/executivo/resumo",
        status: 500,
        duration: 934,
        description: "erro ClickUp upstream",
        payload: null,
        response: {
          ok: false,
          motivo: "Erro ao carregar resumo executivo."
        },
        error: {
          type: "server",
          message: "ClickUp API respondeu 502 durante agregação.",
          requestId: "mock-cc-9f7a"
        }
      },
      {
        id: "req-010",
        time: "09:53:27",
        screen: "financeiro.html",
        method: "POST",
        endpoint: "/fechamentos/financeiro",
        status: 200,
        duration: 1480,
        description: "fechamento processado",
        payload: {
          formData: true,
          sales: "vendas-ml-maio.xlsx",
          costs: "custos-maio.xlsx",
          ordersAll: "orders-all-shopee.xlsx"
        },
        response: {
          ok: true,
          resumo: {
            meli: { pedidos: 481, divergencias: 7 },
            shopee: { pedidos: 112, divergencias: 2 },
            totalLiquido: 94732.18
          }
        }
      },
      {
        id: "req-011",
        time: "09:54:38",
        screen: "metricas.html",
        method: "GET",
        endpoint: "/metricas/resumo?clienteSlug=alpha-store&dateFrom=2026-06-01&dateTo=2026-06-08",
        status: 0,
        duration: 0,
        description: "network error",
        payload: null,
        response: null,
        error: {
          type: "network",
          message: "Failed to fetch",
          hint: "Verificar conexão, CORS, Render cold start ou DNS."
        }
      }
    ];
  }

  async function loadBackendData() {
    // TODO: integrar futuramente com endpoint interno de observabilidade.
    // Regras futuras: nunca retornar tokens completos, access_token, refresh_token,
    // api_key ou Authorization completo. A tela deve consumir apenas payload
    // sanitizado e normalizar com normalizeEntry(entry).
    return [];
  }

  function normalizeEntry(entry) {
    return {
      id: String(entry.id || cryptoRandomId()),
      time: String(entry.time || formatClock(new Date())),
      screen: String(entry.screen || "portal"),
      method: String(entry.method || "GET").toUpperCase(),
      endpoint: String(entry.endpoint || "/"),
      status: Number(entry.status || 0),
      duration: Number(entry.duration || 0),
      description: String(entry.description || entry.label || "request"),
      payload: sanitizePayload(entry.payload || null),
      response: sanitizePayload(entry.response || null),
      error: sanitizePayload(entry.error || null)
    };
  }

  function sanitizePayload(data) {
    if (data === null || data === undefined) return data;

    if (typeof data === "string") {
      return looksSensitiveValue(data) ? maskSensitive(data) : data;
    }

    if (Array.isArray(data)) {
      return data.map((item) => sanitizePayload(item));
    }

    if (typeof data === "object") {
      return Object.entries(data).reduce((acc, [key, value]) => {
        const lower = key.toLowerCase();
        if (
          lower.includes("access_token") ||
          lower.includes("refresh_token") ||
          lower.includes("authorization") ||
          lower.includes("api_key") ||
          lower.includes("apikey") ||
          lower === "token"
        ) {
          acc[key] = maskSensitive(value);
          return acc;
        }
        acc[key] = sanitizePayload(value);
        return acc;
      }, {});
    }

    return data;
  }

  function maskSensitive(value) {
    const text = String(value || "");
    if (!text) return "ausente";

    if (/^Bearer\s+/i.test(text)) {
      const token = text.replace(/^Bearer\s+/i, "");
      if (!token) return "Bearer ausente";
      return `Bearer ${token.slice(0, 3)}...****`;
    }

    if (text.length <= 8) return "****";
    return `${text.slice(0, 4)}...****`;
  }

  function looksSensitiveValue(value) {
    const text = String(value || "").trim();
    if (/^Bearer\s+/i.test(text)) return true;
    if (/^eyJ[a-zA-Z0-9_-]+\./.test(text)) return true;
    if (/^vf_[a-f0-9]{16,}$/i.test(text)) return true;
    return text.length > 80 && /^[a-zA-Z0-9._-]+$/.test(text);
  }

  function readUserSafe() {
    try {
      return JSON.parse(localStorage.getItem(USER_KEY) || "{}") || {};
    } catch {
      return {};
    }
  }

  function getStatusClass(entry) {
    if (entry.status === 0) return "vfc-status--network";
    if (is5xx(entry)) return "vfc-status--error";
    if (is4xx(entry)) return "vfc-status--warn";
    return "vfc-status--ok";
  }

  function getChipClass(entry) {
    if (isSlow(entry)) return "vfc-chip--slow";
    if (is5xx(entry) || entry.status === 0) return "vfc-chip--error";
    if (is4xx(entry)) return "vfc-chip--warn";
    return "vfc-chip--ok";
  }

  function getErrorSeverity(entry) {
    if (entry.status === 0) return "network";
    if (is5xx(entry)) return "alta";
    if (is4xx(entry)) return "média";
    return "none";
  }

  function isOk(entry) {
    return entry.status >= 200 && entry.status < 300;
  }

  function is4xx(entry) {
    return entry.status >= 400 && entry.status < 500;
  }

  function is5xx(entry) {
    return entry.status >= 500;
  }

  function isSlow(entry) {
    return entry.duration >= SLOW_LIMIT_MS;
  }

  function formatStatus(status) {
    return status === 0 ? "NETWORK" : String(status);
  }

  function formatDuration(duration) {
    return duration ? `${duration}ms` : "n/a";
  }

  function formatJson(value) {
    return JSON.stringify(value, null, 2);
  }

  function formatClock(date) {
    return [
      String(date.getHours()).padStart(2, "0"),
      String(date.getMinutes()).padStart(2, "0"),
      String(date.getSeconds()).padStart(2, "0")
    ].join(":");
  }

  function cryptoRandomId() {
    return `req-${Math.random().toString(16).slice(2, 10)}`;
  }

  function sanitizeText(value) {
    return String(value || "").trim() || "—";
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
})();
