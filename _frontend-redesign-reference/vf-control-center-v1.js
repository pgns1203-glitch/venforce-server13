(function () {
  "use strict";

  const API_URL = "https://venforce-server.onrender.com";
  const TOKEN_MASK = "vf_mock_jwt_9e2f.••••••••••••.a41c";
  const SLOW_LIMIT = 1000;

  const baseRequests = [
    {
      id: "req-001",
      time: "09:41:03",
      screen: "bases.html",
      method: "GET",
      endpoint: "/bases",
      status: 200,
      duration: 84,
      label: "bases carregadas",
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
      label: "vinculos + sugestoes",
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
      label: "base importada",
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
      label: "relatorios recentes",
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
      label: "diagnostico iniciado · lento",
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
      label: "polling diagnostico",
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
      label: "sem permissao admin",
      payload: null,
      response: {
        ok: false,
        erro: "Acesso restrito a administradores."
      },
      error: {
        type: "permission",
        message: "Usuario membro tentou acessar rota admin-only.",
        hint: "Ocultar bloco sensivel ou degradar para score parcial."
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
      label: "token invalido",
      payload: null,
      response: {
        ok: false,
        erro: "Token invalido ou expirado"
      },
      error: {
        type: "auth",
        message: "JWT expirado ou ausente no localStorage.",
        action: "Limpar sessao e redirecionar para index.html."
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
      label: "erro clickup upstream",
      payload: null,
      response: {
        ok: false,
        motivo: "Erro ao carregar resumo executivo."
      },
      error: {
        type: "server",
        message: "ClickUp API respondeu 502 durante agregacao.",
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
      label: "fechamento processado",
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
      label: "network error",
      payload: null,
      response: null,
      error: {
        type: "network",
        message: "Failed to fetch",
        hint: "Verificar conexao, CORS, Render cold start ou DNS."
      }
    }
  ];

  const state = {
    requests: baseRequests.slice(),
    selectedId: "req-001",
    statusFilter: "all",
    screenFilter: "all",
    search: "",
    activeTab: "request",
    debug: true
  };

  const els = {};

  function init() {
    cache();
    hydrateScreenFilter();
    bind();
    renderAll();
  }

  function cache() {
    els.rows = document.querySelector("[data-vfc-rows]");
    els.detail = document.querySelector("[data-vfc-detail]");
    els.visibleCount = document.querySelector("[data-vfc-visible-count]");
    els.statusButtons = Array.from(document.querySelectorAll("[data-vfc-status-filter]"));
    els.screenFilter = document.querySelector("[data-vfc-screen-filter]");
    els.search = document.querySelector("[data-vfc-search]");
    els.clear = document.querySelector("[data-vfc-clear]");
    els.debug = document.querySelector("[data-vfc-debug]");
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

  function bind() {
    els.statusButtons.forEach((button) => {
      button.addEventListener("click", () => {
        state.statusFilter = button.dataset.vfcStatusFilter || "all";
        els.statusButtons.forEach((b) => b.classList.toggle("is-active", b === button));
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
      state.requests = [];
      state.selectedId = null;
      renderAll();
    });

    els.debug.addEventListener("click", () => {
      state.debug = !state.debug;
      els.debug.textContent = `debug mock: ${state.debug ? "on" : "off"}`;
      els.debug.setAttribute("aria-pressed", String(state.debug));
      if (state.debug && state.requests.length === 0) {
        state.requests = baseRequests.slice();
        state.selectedId = "req-001";
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

  function hydrateScreenFilter() {
    const screens = Array.from(new Set(baseRequests.map((item) => item.screen))).sort();
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
    const total = state.requests.length;
    const ok = state.requests.filter((item) => item.status >= 200 && item.status < 300).length;
    const four = state.requests.filter((item) => item.status >= 400 && item.status < 500).length;
    const five = state.requests.filter((item) => item.status >= 500).length;
    const slow = state.requests.filter((item) => item.duration >= SLOW_LIMIT).length;
    const timed = state.requests.filter((item) => item.duration > 0);
    const avg = timed.length ? Math.round(timed.reduce((sum, item) => sum + item.duration, 0) / timed.length) : 0;
    const lastError = state.requests.filter((item) => item.status >= 400 || item.status === 0).at(-1);

    els.summary.total.textContent = String(total);
    els.summary.ok.textContent = String(ok);
    els.summary["4xx"].textContent = String(four);
    els.summary["5xx"].textContent = String(five);
    els.summary.slow.textContent = String(slow);
    els.summary.avg.textContent = `${avg}ms`;
    els.summary.lastError.textContent = lastError ? `${lastError.status || "NET"} ${lastError.endpoint}` : "none";
  }

  function getVisibleRequests() {
    return state.requests.filter((item) => {
      const isOk = item.status >= 200 && item.status < 300;
      const is4xx = item.status >= 400 && item.status < 500;
      const is5xx = item.status >= 500;
      const isSlow = item.duration >= SLOW_LIMIT;

      if (state.statusFilter === "ok" && !isOk) return false;
      if (state.statusFilter === "4xx" && !is4xx) return false;
      if (state.statusFilter === "5xx" && !is5xx) return false;
      if (state.statusFilter === "slow" && !isSlow) return false;
      if (state.screenFilter !== "all" && item.screen !== state.screenFilter) return false;

      if (state.search) {
        const haystack = [
          item.endpoint,
          item.method,
          item.screen,
          item.label,
          String(item.status),
          JSON.stringify(item.payload || {}),
          JSON.stringify(item.response || {}),
          JSON.stringify(item.error || {})
        ].join(" ").toLowerCase();
        if (!haystack.includes(state.search)) return false;
      }

      return true;
    });
  }

  function renderRows() {
    const rows = getVisibleRequests();
    els.visibleCount.textContent = `${rows.length} visiveis`;

    if (!rows.length) {
      els.rows.innerHTML = '<tr><td class="vfc-empty-table" colspan="7">nenhuma request corresponde aos filtros atuais</td></tr>';
      return;
    }

    els.rows.innerHTML = rows.map((item) => {
      const statusClass = getStatusClass(item);
      const timeClass = item.duration >= SLOW_LIMIT ? " is-slow" : "";
      const selected = item.id === state.selectedId ? " is-selected" : "";
      return `
        <tr class="${selected}" data-vfc-request-id="${escapeHtml(item.id)}">
          <td class="vfc-mono">${escapeHtml(item.time)}</td>
          <td>${escapeHtml(item.screen)}</td>
          <td><span class="vfc-method">${escapeHtml(item.method)}</span></td>
          <td><span class="vfc-endpoint">${escapeHtml(item.endpoint)}</span></td>
          <td><span class="vfc-status ${statusClass}">${formatStatus(item.status)}</span></td>
          <td><span class="vfc-time${timeClass}">${formatDuration(item.duration)}</span></td>
          <td>${escapeHtml(item.label)}</td>
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
    const selected = state.requests.find((item) => item.id === state.selectedId);

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

  function renderTab(item) {
    if (state.activeTab === "request") {
      return `
        ${renderKv({
          url: API_URL + item.endpoint,
          metodo: item.method,
          status: formatStatus(item.status),
          duracao: formatDuration(item.duration),
          origem: item.screen,
          authorization: `Bearer ${TOKEN_MASK}`
        })}
        <p class="vfc-code-label">payload enviado</p>
        <pre class="vfc-code">${escapeHtml(formatJson(item.payload || { empty: true }))}</pre>
      `;
    }

    if (state.activeTab === "response") {
      return `
        ${renderKv({
          status: formatStatus(item.status),
          tipo: item.status === 0 ? "network" : "application/json",
          cache: "no-store",
          request_id: `mock-${item.id}`
        })}
        <p class="vfc-code-label">response json</p>
        <pre class="vfc-code">${escapeHtml(formatJson(item.response || { ok: false, network: "sem resposta HTTP" }))}</pre>
      `;
    }

    if (state.activeTab === "contexto") {
      return `
        ${renderKv({
          usuario: "Marina Ops",
          role: "admin",
          ambiente: "mock/local",
          api_url: API_URL,
          token: TOKEN_MASK,
          localStorage: "vf-token, vf-user",
          origem: item.screen
        })}
        <p class="vfc-code-label">contexto seguro</p>
        <pre class="vfc-code">${escapeHtml(formatJson({
          user: { id: 7, nome: "Marina Ops", role: "admin" },
          screen: item.screen,
          routeGuard: item.endpoint.includes("/admin") ? "admin-only" : "authenticated",
          tokenMasked: TOKEN_MASK,
          tokenFull: "nunca exibir token completo"
        }))}</pre>
      `;
    }

    return `
      ${renderKv({
        tipo: item.error?.type || "none",
        severidade: getErrorSeverity(item),
        ultimo_erro: item.error?.message || "sem erro",
        acao_sugerida: item.error?.action || item.error?.hint || "nenhuma"
      })}
      <p class="vfc-code-label">erro formatado</p>
      <pre class="vfc-code ${item.error ? "vfc-error-box" : ""}">${escapeHtml(formatJson(item.error || { ok: true, message: "request sem erro" }))}</pre>
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

  function getStatusClass(item) {
    if (item.status === 0) return "vfc-status--network";
    if (item.status >= 500) return "vfc-status--error";
    if (item.status >= 400) return "vfc-status--warn";
    return "vfc-status--ok";
  }

  function getChipClass(item) {
    if (item.duration >= SLOW_LIMIT) return "vfc-chip--slow";
    if (item.status >= 500 || item.status === 0) return "vfc-chip--error";
    if (item.status >= 400) return "vfc-chip--warn";
    return "vfc-chip--ok";
  }

  function getErrorSeverity(item) {
    if (item.status === 0) return "network";
    if (item.status >= 500) return "alta";
    if (item.status >= 400) return "media";
    return "none";
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

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  document.addEventListener("DOMContentLoaded", init);
})();
