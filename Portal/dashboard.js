const STORAGE_KEY = "vf-token";
const API_BASE = "https://venforce-server.onrender.com";
const REQUEST_TIMEOUT_MS = 15000;

if (typeof window.initLayout === "function") window.initLayout();

const state = {
  loading: false,
  summary: null,
  authorizedClients: [],
  appliedSlugs: new Set(),
  draftSlugs: new Set(),
  selectionInitialized: false,
  expandedSlug: null,
};

function byId(id) {
  return document.getElementById(id);
}

function getToken() {
  const token = localStorage.getItem(STORAGE_KEY);
  if (!token) window.location.replace("index.html");
  return token;
}

const TOKEN = getToken();

function clearSession() {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem("vf-user");
  window.location.replace("index.html");
}

function currentUser() {
  try {
    return JSON.parse(localStorage.getItem("vf-user") || "{}") || {};
  } catch {
    return {};
  }
}

function escapeHTML(value) {
  const element = document.createElement("div");
  element.textContent = value == null ? "" : String(value);
  return element.innerHTML;
}

function safeSlug(value) {
  const slug = String(value || "").trim();
  return /^[a-zA-Z0-9_-]{1,160}$/.test(slug) ? slug : "";
}

async function fetchSummary(path) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${TOKEN}` },
      signal: controller.signal,
    });
    if (response.status === 401) {
      clearSession();
      return null;
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) throw new Error(payload.erro || `HTTP ${response.status}`);
    return payload;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("Tempo limite excedido");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function renderGreeting() {
  const user = currentUser();
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
  const name = String(user.nome || user.email || "").trim().split("@")[0];
  byId("dash-greeting").textContent = name ? `${greeting}, ${name}` : "Meu trabalho";
}

function roleLabel(role) {
  return ({ admin: "Admin", user: "Gestor", membro: "Membro", seller: "Seller" })[String(role || "").toLowerCase()] || "Usuário";
}

function formatCurrency(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(number);
}

function formatPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(number);
}

function formatDateTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Atualização indisponível";
  return date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function coverageText(metric) {
  if (!metric || metric.value == null) return metric?.reason || "Dado indisponível no período";
  const coverage = Number(metric.coverage);
  return Number.isFinite(coverage) ? `${Math.round(coverage * 100)}% dos clientes com evidência` : "Fonte consolidada";
}

function setBusy(isBusy) {
  state.loading = isBusy;
  ["dash-kpis", "dash-priorities", "dash-health", "dash-portfolio-wrap"].forEach((id) => {
    byId(id)?.setAttribute("aria-busy", String(isBusy));
  });
  const refresh = byId("dash-refresh");
  if (refresh) {
    refresh.disabled = isBusy;
    refresh.textContent = isBusy ? "Atualizando…" : "Atualizar";
  }
}

function renderDataState(summary) {
  const element = byId("dash-data-state");
  element.className = "vf-banner vf-dashboard-state";
  if (summary.data_status === "complete") {
    element.hidden = true;
    return;
  }
  if (summary.data_status === "empty") {
    element.textContent = summary.scope?.total_authorized
      ? "Nenhum cliente autorizado foi selecionado. Selecione ao menos um cliente para continuar."
      : "Este login ainda não possui clientes disponíveis no escopo atual.";
  } else if (summary.data_status === "partial") {
    element.classList.add("vf-dashboard-state--warning");
    element.textContent = "Algumas fontes estão indisponíveis. Os dados conhecidos continuam visíveis e os demais aparecem como indisponíveis.";
  } else {
    element.classList.add("vf-dashboard-state--danger");
    element.textContent = "Não foi possível consolidar as fontes do Dashboard agora.";
  }
  element.hidden = false;
}

function syncSelectionFromSummary(summary) {
  state.authorizedClients = Array.isArray(summary.scope?.clients) ? summary.scope.clients : [];
  const authorized = new Set(state.authorizedClients.map((client) => client.slug));
  if (!state.selectionInitialized) {
    state.appliedSlugs = new Set((summary.scope?.selected_slugs || []).filter((slug) => authorized.has(slug)));
    if (!state.appliedSlugs.size) state.appliedSlugs = new Set(authorized);
    state.selectionInitialized = true;
  } else {
    state.appliedSlugs = new Set([...state.appliedSlugs].filter((slug) => authorized.has(slug)));
  }
  state.draftSlugs = new Set(state.appliedSlugs);
  renderClientPicker();
}

function selectedLabel(selected, total) {
  if (total === 0) return "Nenhum cliente disponível";
  if (selected === total) return `Todos os meus clientes (${total})`;
  return `${selected} de ${total} clientes`;
}

function renderClientPicker() {
  const total = state.authorizedClients.length;
  byId("dash-client-trigger-text").textContent = selectedLabel(state.appliedSlugs.size, total);
  byId("dash-client-counter").textContent = `${state.draftSlugs.size} de ${total} selecionados`;
  renderClientOptions();
}

function renderClientOptions() {
  const list = byId("dash-client-list");
  const query = String(byId("dash-client-search")?.value || "").trim().toLocaleLowerCase("pt-BR");
  const clients = state.authorizedClients.filter((client) => {
    if (!query) return true;
    return String(client.nome || "").toLocaleLowerCase("pt-BR").includes(query)
      || String(client.slug || "").toLocaleLowerCase("pt-BR").includes(query);
  });
  if (!clients.length) {
    list.innerHTML = '<p class="vf-dashboard-empty">Nenhum cliente encontrado.</p>';
    return;
  }
  list.innerHTML = clients.map((client) => {
    const slug = safeSlug(client.slug);
    return `<label class="vf-dashboard-client-option">
      <input type="checkbox" value="${escapeHTML(slug)}" ${state.draftSlugs.has(slug) ? "checked" : ""}>
      <span>${escapeHTML(client.nome || slug)}</span>
    </label>`;
  }).join("");
}

function openClientPicker() {
  state.draftSlugs = new Set(state.appliedSlugs);
  const popover = byId("dash-client-popover");
  const trigger = byId("dash-client-picker");
  popover.hidden = false;
  trigger.setAttribute("aria-expanded", "true");
  byId("dash-client-search").value = "";
  renderClientPicker();
  byId("dash-client-search").focus();
}

function closeClientPicker({ restore = false } = {}) {
  if (restore) state.draftSlugs = new Set(state.appliedSlugs);
  byId("dash-client-popover").hidden = true;
  byId("dash-client-picker").setAttribute("aria-expanded", "false");
}

function toggleClientPicker() {
  if (byId("dash-client-popover").hidden) openClientPicker();
  else closeClientPicker({ restore: true });
}

function renderScope(summary) {
  const scope = summary.scope || {};
  const selected = Number(scope.selected_count || 0);
  const total = Number(scope.total_authorized || 0);
  byId("dash-scope-chip").textContent = scope.squad?.nome || "Minha carteira";
  byId("dash-role-chip").textContent = `${roleLabel(scope.role)} · ${total} ${total === 1 ? "cliente autorizado" : "clientes autorizados"}`;
  byId("dash-scope-note").textContent = selected === total
    ? `Você está vendo os ${total} ${total === 1 ? "cliente" : "clientes"} da sua carteira. O filtro nunca amplia seu acesso.`
    : `Você está vendo ${selected} dos ${total} clientes autorizados para este login.`;
}

function renderMetrics(metrics = {}) {
  const revenue = metrics.revenue || {};
  const margin = metrics.margin || {};
  const attention = metrics.attention_clients || {};
  const pending = metrics.pending_actions || {};
  byId("dash-revenue-value").textContent = formatCurrency(revenue.value);
  byId("dash-revenue-meta").textContent = coverageText(revenue);
  byId("dash-margin-value").textContent = formatPercent(margin.value);
  byId("dash-margin-meta").textContent = coverageText(margin);
  byId("dash-attention-value").textContent = attention.value == null ? "—" : String(attention.value);
  byId("dash-attention-meta").textContent = attention.value == null
    ? "Prontidão indisponível"
    : `${Number(attention.critical || 0)} crítico${Number(attention.critical || 0) === 1 ? "" : "s"} · ${Number(attention.attention || 0)} em atenção`;
  byId("dash-pending-value").textContent = pending.value == null ? "—" : String(pending.value);
  byId("dash-pending-meta").textContent = pending.value == null ? "Ações indisponíveis" : "Requisitos operacionais abertos";
  byId("dash-kpis").setAttribute("aria-busy", "false");
}

function renderPriorities(priorities = []) {
  const container = byId("dash-priorities");
  const count = byId("dash-priority-count");
  if (!priorities.length) {
    container.innerHTML = '<p class="vf-dashboard-empty">Nenhuma prioridade para os clientes selecionados.</p>';
    count.hidden = true;
  } else {
    container.innerHTML = priorities.slice(0, 5).map((priority) => {
      const slug = safeSlug(priority.slug);
      const severity = priority.severity === "danger" ? "danger" : "warning";
      return `<article class="vf-dashboard-priority vf-dashboard-priority--${severity}">
        <span class="vf-dashboard-priority__marker" aria-hidden="true"></span>
        <div>
          <p class="vf-dashboard-priority__client">${escapeHTML(priority.client_name || slug)}</p>
          <p class="vf-dashboard-priority__problem">${escapeHTML(priority.problem || "Pendência operacional")} · ${Number(priority.pending || 0)} pendência${Number(priority.pending || 0) === 1 ? "" : "s"}</p>
        </div>
        <a class="vf-btn vf-btn--sm vf-btn--secondary" href="cliente-operacao.html?cliente=${encodeURIComponent(slug)}">Abrir</a>
      </article>`;
    }).join("");
    count.textContent = `${priorities.length} prioridade${priorities.length === 1 ? "" : "s"}`;
    count.hidden = false;
  }
  container.setAttribute("aria-busy", "false");
}

function renderHealth(health = {}) {
  const coverage = Number(health.data_coverage);
  const rows = [
    ["Cobertura do escopo", Number.isFinite(coverage) ? `${Math.round(coverage * 100)}%` : "—"],
    ["Bases em atenção", health.bases_attention == null ? "—" : String(health.bases_attention)],
    ["Margens críticas", health.critical_margin == null ? "—" : String(health.critical_margin)],
    ["Clientes selecionados", health.selected_clients == null ? "—" : String(health.selected_clients)],
  ];
  byId("dash-health").innerHTML = rows.map(([label, value]) => `<div class="vf-dashboard-health-row"><span>${escapeHTML(label)}</span><strong>${escapeHTML(value)}</strong></div>`).join("");
  byId("dash-health").setAttribute("aria-busy", "false");
}

function donutSvg(score, size, label) {
  const number = Number(score);
  if (!Number.isFinite(number)) return '<span aria-label="Prontidão indisponível">—</span>';
  const normalized = Math.max(0, Math.min(100, number));
  const radius = size <= 32 ? 11 : 46;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - normalized / 100);
  const tone = normalized < 60 ? "critical" : normalized < 90 ? "attention" : "healthy";
  const center = size / 2;
  return `<svg class="vf-dashboard-donut vf-dashboard-donut--${tone}" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${escapeHTML(label)}: ${normalized}%">
    <circle class="vf-dashboard-donut__track" cx="${center}" cy="${center}" r="${radius}"></circle>
    <circle class="vf-dashboard-donut__value" cx="${center}" cy="${center}" r="${radius}" stroke-dasharray="${circumference}" stroke-dashoffset="${offset}"></circle>
  </svg>`;
}

function readinessTone(status) {
  return status === "critical" ? "danger" : status === "attention" ? "warning" : status === "healthy" ? "success" : "neutral";
}

function renderReadinessPanel(client) {
  const readiness = client.readiness || {};
  const score = Number.isFinite(Number(readiness.score)) ? Number(readiness.score) : null;
  const pointsText = score == null
    ? "Pontuação indisponível"
    : readiness.missing_points > 0 ? `${readiness.missing_points} pontos restantes para pronto` : "Setup operacional pronto";
  const instruction = (readiness.items || []).some((item) => !item.done)
    ? '<p class="vf-dashboard-readiness-instruction">Resolva o que está crítico primeiro:</p>' : "";
  const items = (readiness.items || []).map((item) => `<div class="vf-dashboard-readiness-item vf-dashboard-readiness-item--${escapeHTML(item.severity || "warning")}">
    <span class="vf-dashboard-readiness-item__dot" aria-hidden="true"></span>
    <span>${escapeHTML(item.label || "Requisito")}</span>
    <strong>${item.done ? "+" : "−"}${Number(item.points || 0)} pts</strong>
  </div>`).join("");
  const slug = safeSlug(client.slug);
  const copyButton = client.has_ml === true && client.ml_grant_connected === false && readiness.can_copy_ml_link === true
    ? `<button class="vf-btn vf-btn--sm vf-btn--secondary" type="button" data-copy-ml="${escapeHTML(slug)}">Copiar link ML</button>` : "";
  return `<div class="vf-dashboard-readiness-panel" id="dash-readiness-${escapeHTML(slug)}">
    <div class="vf-dashboard-readiness-head"><span>Prontidão</span><strong>Prontidão operacional</strong></div>
    <div class="vf-dashboard-readiness-body">
      <div class="vf-dashboard-readiness-score">
        <div class="vf-dashboard-readiness-score-visual">
          ${donutSvg(score, 104, `Prontidão de ${client.nome || slug}`)}
          <span class="vf-dashboard-readiness-score-value">${score == null ? "—" : `${score}%`}</span>
        </div>
        <span class="vf-dashboard-readiness-setup">SETUP</span>
      </div>
      <div>
        <div class="vf-dashboard-readiness-summary">
          <span class="vf-status vf-status--${readinessTone(readiness.status)}">${escapeHTML(readiness.status_label || "Indisponível")}</span>
          <p>${escapeHTML(pointsText)}</p>
        </div>
        ${instruction}
        <div class="vf-dashboard-readiness-items">${items || '<p class="vf-dashboard-empty">Prontidão indisponível.</p>'}</div>
      </div>
    </div>
    <div class="vf-dashboard-readiness-footer">
      <p class="vf-dashboard-readiness-note">${escapeHTML(readiness.note || "Prontidão calculada conforme o setup operacional disponível.")}</p>
      <div class="vf-dashboard-readiness-actions">
        ${copyButton}
        <a class="vf-btn vf-btn--sm vf-btn--ghost" href="bases.html">Bases →</a>
        <a class="vf-btn vf-btn--sm vf-btn--ghost" href="automacoes.html">Diagnóstico →</a>
        <a class="vf-btn vf-btn--sm vf-btn--ghost" href="financeiro.html">Fechamento →</a>
      </div>
    </div>
  </div>`;
}

function renderPortfolio(portfolio = {}) {
  const body = byId("dash-portfolio-body");
  const clients = Array.isArray(portfolio.clients) ? portfolio.clients : [];
  if (!clients.length) {
    body.innerHTML = '<tr><td colspan="7"><p class="vf-dashboard-empty">Nenhum cliente para exibir na seleção atual.</p></td></tr>';
    byId("dash-portfolio-wrap").setAttribute("aria-busy", "false");
    return;
  }
  body.innerHTML = clients.map((client) => {
    const slug = safeSlug(client.slug);
    const expanded = state.expandedSlug === slug;
    const score = Number.isFinite(Number(client.readiness?.score)) ? Number(client.readiness.score) : null;
    return `<tr>
      <td><span class="vf-dashboard-client-name">${escapeHTML(client.nome || slug)}</span></td>
      <td class="num vf-dashboard-money">${escapeHTML(formatCurrency(client.revenue))}</td>
      <td class="num vf-dashboard-percent">${escapeHTML(formatPercent(client.margin))}</td>
      <td class="num">${Number(client.pending || 0)}</td>
      <td><span class="vf-dashboard-status vf-dashboard-status--${escapeHTML(client.status?.key || "unknown")}">${escapeHTML(client.status?.label || "Indisponível")}</span></td>
      <td><span class="vf-dashboard-readiness-compact">${donutSvg(score, 28, `Prontidão de ${client.nome || slug}`)}<span>${score == null ? "—" : `${score}%`}</span></span></td>
      <td><button class="vf-dashboard-expand-button" type="button" data-expand-readiness="${escapeHTML(slug)}" aria-expanded="${expanded}" aria-controls="dash-readiness-${escapeHTML(slug)}">${expanded ? "Ocultar" : "Ver prontidão"}<span aria-hidden="true">${expanded ? "⌃" : "⌄"}</span></button></td>
    </tr>
    ${expanded ? `<tr class="vf-dashboard-readiness-row"><td colspan="7">${renderReadinessPanel(client)}</td></tr>` : ""}`;
  }).join("");
  byId("dash-portfolio-wrap").setAttribute("aria-busy", "false");
}

function renderSummary(summary) {
  state.summary = summary;
  syncSelectionFromSummary(summary);
  renderScope(summary);
  renderDataState(summary);
  renderMetrics(summary.metrics);
  renderPriorities(summary.priorities);
  renderHealth(summary.operational_health);
  renderPortfolio(summary.portfolio);
  byId("dash-updated").textContent = `Atualizado em ${formatDateTime(summary.as_of)}`;
}

function renderFatalError(error) {
  const element = byId("dash-data-state");
  element.className = "vf-banner vf-dashboard-state vf-dashboard-state--danger";
  element.textContent = error?.message === "Tempo limite excedido"
    ? "O resumo demorou mais que o esperado. Tente atualizar novamente."
    : "Não foi possível carregar o Dashboard. Tente novamente.";
  element.setAttribute("role", "alert");
  element.hidden = false;
  byId("dash-priorities").innerHTML = '<p class="vf-dashboard-empty">Prioridades indisponíveis.</p>';
  byId("dash-health").innerHTML = '<p class="vf-dashboard-empty">Saúde operacional indisponível.</p>';
  byId("dash-portfolio-body").innerHTML = '<tr><td colspan="7">Carteira indisponível.</td></tr>';
}

function summaryPath() {
  const params = new URLSearchParams({ period: byId("dash-period")?.value || "30d" });
  if (state.selectionInitialized && state.appliedSlugs.size < state.authorizedClients.length) {
    params.set("clientes", [...state.appliedSlugs].join(","));
  }
  return `/dashboard/summary?${params.toString()}`;
}

async function loadDashboard() {
  if (!TOKEN || state.loading) return;
  setBusy(true);
  try {
    const summary = await fetchSummary(summaryPath());
    if (summary) renderSummary(summary);
  } catch (error) {
    renderFatalError(error);
  } finally {
    setBusy(false);
  }
}

async function copyMlLink(slug, button) {
  const safe = safeSlug(slug);
  if (!safe) return;
  const link = `${API_BASE}/ml/conectar/${encodeURIComponent(safe)}`;
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(link);
    else {
      const textarea = document.createElement("textarea");
      textarea.value = link;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand("copy");
      textarea.remove();
      if (!copied) throw new Error("copy_failed");
    }
    button.textContent = "Link copiado";
    window.setTimeout(() => { button.textContent = "Copiar link ML"; }, 1400);
  } catch {
    button.textContent = "Não foi possível copiar";
    window.setTimeout(() => { button.textContent = "Copiar link ML"; }, 1800);
  }
}

byId("dash-client-picker")?.addEventListener("click", toggleClientPicker);
byId("dash-client-search")?.addEventListener("input", renderClientOptions);
byId("dash-client-list")?.addEventListener("change", (event) => {
  const input = event.target.closest('input[type="checkbox"]');
  if (!input) return;
  if (input.checked) state.draftSlugs.add(input.value);
  else state.draftSlugs.delete(input.value);
  byId("dash-client-counter").textContent = `${state.draftSlugs.size} de ${state.authorizedClients.length} selecionados`;
});
byId("dash-client-all")?.addEventListener("click", () => {
  state.draftSlugs = new Set(state.authorizedClients.map((client) => client.slug));
  renderClientPicker();
});
byId("dash-client-clear")?.addEventListener("click", () => {
  state.draftSlugs.clear();
  renderClientPicker();
});
byId("dash-client-apply")?.addEventListener("click", () => {
  state.appliedSlugs = state.draftSlugs.size
    ? new Set(state.draftSlugs)
    : new Set(state.authorizedClients.map((client) => client.slug));
  state.expandedSlug = null;
  closeClientPicker();
  renderClientPicker();
  loadDashboard();
});

document.addEventListener("click", (event) => {
  const filter = event.target.closest(".vf-dashboard-client-filter");
  if (!filter && !byId("dash-client-popover").hidden) closeClientPicker({ restore: true });
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !byId("dash-client-popover").hidden) {
    closeClientPicker({ restore: true });
    byId("dash-client-picker").focus();
  }
});
byId("dash-portfolio-body")?.addEventListener("click", (event) => {
  const expand = event.target.closest("[data-expand-readiness]");
  if (expand) {
    const slug = safeSlug(expand.dataset.expandReadiness);
    state.expandedSlug = state.expandedSlug === slug ? null : slug;
    renderPortfolio(state.summary?.portfolio || {});
    return;
  }
  const copy = event.target.closest("[data-copy-ml]");
  if (copy) copyMlLink(copy.dataset.copyMl, copy);
});
byId("dash-refresh")?.addEventListener("click", loadDashboard);
byId("dash-period")?.addEventListener("change", () => {
  state.expandedSlug = null;
  loadDashboard();
});

renderGreeting();
if (TOKEN) loadDashboard();
