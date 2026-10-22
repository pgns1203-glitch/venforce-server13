/* VenForce · Gestão de Squads. Vanilla, sem alterações de domínio.
 * Mutações: exclusivamente /squads/*. Os catálogos GET /usuarios e
 * GET /clientes são as consultas já existentes nesta tela.
 * O servidor decide autorização, principal único e atribuição/transferência.
 */
"use strict";
const STORAGE_KEY = "vf-token";
const API_BASE = "https://venforce-server.onrender.com";
const $ = (id) => document.getElementById(id);
const TOKEN = localStorage.getItem(STORAGE_KEY);
let SELF = {};
try { SELF = JSON.parse(localStorage.getItem("vf-user") || "{}"); } catch { /* sessão inválida */ }
const ADMIN = SELF.role === "admin";
const STATE = {
  squads: [], membrosPorSquad: {}, clientesPorSquad: {}, errors: {}, allowed: {},
  squadAbertoId: null, usuarios: null, todosClientes: null, catalogsReady: false,
  refreshing: false, busy: false, selection: 0, modal: null, returnFocus: null, initialSelection: false,
  view: "config",
  kpi: null, // filtro da faixa de KPIs: "ativos" | "semcoord" | null
  editingName: false,
  clienteAberto: null, // slug do cliente com a linha expandida
  activityView: {
    period: "hoje", query: "", status: "idle", error: null, gen: 0,
    peopleCache: {}, // user_id -> {userId,nome,email,eventosTotal,falhasTotal,ultimaAtividade,eventosRecentes} — 1 fetch por pessoa, não por Squad
    personModal: { open: false, userId: null, status: "all" },
  },
};
function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
const normal = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const matches = (query, ...values) => normal(values.join(" ")).includes(normal(query));
const squadPorId = id => STATE.squads.find(s => String(s.id) === String(id));
const isLegado = s => Number(s.id) === 8 || normal(s.slug).includes("legado");
const canManage = id => !!STATE.allowed[id];
// Ordem crescente de hierarquia (a lista ordena do fim para o começo).
const FUNCOES = ["membro", "gestor", "coordenador"];
const FUNCAO_ROTULO = { membro: "Membro", gestor: "Gestor", coordenador: "Coordenador" };
const people = id => STATE.membrosPorSquad[id];
const clients = id => STATE.clientesPorSquad[id];
const squadName = id => squadPorId(id)?.nome || "Squad";
const personName = (sid, uid) => people(sid)?.find(m => String(m.user_id) === String(uid))?.user_nome || `Pessoa #${uid}`;
const count = (s, kind) => s[kind === "people" ? "membros_ativos" : "clientes_ativos"] ?? (kind === "people" ? people(s.id)?.length : clients(s.id)?.length) ?? "—";
function feedback(message, type = "success") {
  $("sq-feedback").hidden = !message;
  $("sq-feedback").className = `vf-banner is-${type}`;
  $("sq-feedback").innerHTML = message ? `<span>${esc(message)}</span><button type="button" class="sq-feedback-close" data-action="dismiss" aria-label="Dispensar mensagem">×</button>` : "";
}
async function api(path, { method = "GET", body } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method, signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + TOKEN },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 401) {
      localStorage.removeItem(STORAGE_KEY); localStorage.removeItem("vf-user");
      window.location.replace("index.html");
    }
    const data = await res.json();
    if (!res.ok || data.ok === false) throw Object.assign(new Error(data.erro || `Não foi possível concluir (HTTP ${res.status}).`), { status: res.status });
    return data;
  } catch (err) {
    if (err.name === "AbortError") throw new Error("A resposta demorou demais. Tente novamente.");
    throw err;
  } finally { clearTimeout(timeout); }
}
function listFrom(data, key) {
  if (!Array.isArray(data[key])) throw new Error("Resposta incompleta. Tente atualizar.");
  return data[key];
}
// Limita o fan-out; catálogo e detalhe compartilham o mesmo cache de leitura.
async function eachLimited(items, task) {
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
    while (index < items.length) { const item = items[index++]; await task(item); }
  }));
}
/* Atividade dos membros — reaproveita GET /admin/logs (logsController.js),
 * sem logger novo. "Atividade do Squad" = atividade pessoal de quem
 * pertence ao squad, não uma correlação ação→Squad. */
const ACTIVITY_ACOES = {
  "login.sucesso": "Entrou no Portal",
  "login.falha": "Falha ao entrar no Portal",
  "admin.cliente.criar": "Criou cliente",
  "admin.cliente.desativar": "Desativou cliente",
  "admin.cliente.excluir": "Excluiu cliente",
  "admin.cliente.purgar": "Removeu cliente permanentemente",
  "admin.ml.conectar": "Conectou conta Mercado Livre",
  "admin.ml.desconectar": "Desconectou conta Mercado Livre",
  "admin.usuario.atualizar": "Atualizou usuário",
  "admin.usuario.excluir": "Excluiu usuário",
  "ads_acompanhamento_salvo": "Salvou acompanhamento de Ads",
  "ads_resumo_mensal_salvo": "Salvou resumo mensal de Ads",
  "automacoes.promocoes.diagnostico.start": "Iniciou diagnóstico de promoções",
  "automacoes.relatorio.salvar": "Salvou relatório de automação",
  "automacoes.diagnostico_completo.start": "Iniciou diagnóstico completo",
  "base.custo.upsert": "Atualizou custo de Base",
  "base.importar": "Importou Base",
  "base.desabilitar": "Desabilitou Base",
  "base.excluir": "Excluiu Base",
  "seller.custo_aplicado": "Aplicou custo de vendedor",
  "seller.custo_aprovado": "Aprovou custo de vendedor",
  "seller.custo_rejeitado": "Rejeitou custo de vendedor",
};
const rotuloAcao = acao => ACTIVITY_ACOES[acao] || acao;
/* Mesmo algoritmo de Portal/atividade.js — nunca JSON cru na interface. */
function detalhesPlainText(raw) {
  if (raw == null || raw === "") return "";
  let obj = raw;
  if (typeof raw !== "object") { try { obj = JSON.parse(String(raw)); } catch { return String(raw); } }
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    return Object.entries(obj).map(([k, v]) => `${k}: ${v != null && typeof v === "object" ? JSON.stringify(v) : String(v)}`).join(" · ");
  }
  return typeof obj === "string" ? obj : JSON.stringify(obj);
}
function localDateStr(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function activityRange(period) {
  const today = new Date();
  const de = new Date(today);
  de.setDate(de.getDate() - (period === "7d" ? 6 : period === "30d" ? 29 : 0));
  return { de: localDateStr(de), ate: localDateStr(today) };
}
function activityQuery(params) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== "") qs.set(k, v); });
  return qs.toString();
}
function formatMomento(value, period) {
  if (!value) return "—";
  const dt = new Date(value); if (Number.isNaN(dt.getTime())) return "—";
  const hh = String(dt.getHours()).padStart(2, "0"), min = String(dt.getMinutes()).padStart(2, "0");
  if (period === "hoje") return `${hh}:${min}`;
  return `${String(dt.getDate()).padStart(2, "0")}/${String(dt.getMonth() + 1).padStart(2, "0")} ${hh}:${min}`;
}
function sortActivityPeople(list) {
  return list.slice().sort((a, b) => {
    const aHas = a.eventosTotal > 0, bHas = b.eventosTotal > 0;
    if (aHas !== bHas) return aHas ? -1 : 1;
    if (aHas) {
      const diff = new Date(b.ultimaAtividade).getTime() - new Date(a.ultimaAtividade).getTime();
      if (diff) return diff;
    }
    return String(a.nome).localeCompare(String(b.nome), "pt-BR");
  });
}
/* Timeline do modal da pessoa — tabela V2 (Hora · Ação · Status). */
function renderTimelineList(events, period) {
  if (!events.length) return '<p class="sq-empty">Nenhum evento para este filtro.</p>';
  return `<div class="vf-table-wrap sq-timeline-scroll"><table class="vf-table sq-activity-timeline-list"><thead><tr><th scope="col">Hora</th><th scope="col">Ação</th><th scope="col">Status</th></tr></thead><tbody>${events.map(ev => {
    const label = rotuloAcao(ev.acao), detPlain = detalhesPlainText(ev.detalhes);
    const preview = detPlain.length > 140 ? detPlain.slice(0, 140).trim() + "…" : detPlain;
    const statusKey = String(ev.status || "").toLowerCase();
    const statusClass = statusKey === "falha" ? "is-danger" : statusKey === "sucesso" ? "is-success" : "is-neutral";
    const statusLabel = statusKey === "falha" ? "Falha" : statusKey === "sucesso" ? "Sucesso" : (ev.status || "—");
    return `<tr class="sq-activity-item">
      <td class="sq-activity-item-time">${esc(formatMomento(ev.created_at, period))}</td>
      <td class="sq-activity-item-action">${esc(label)}${label !== ev.acao ? `<span class="sq-activity-item-raw">${esc(ev.acao)}</span>` : ""}
        ${detPlain ? `<details class="sq-activity-detail"><summary>Ver detalhes</summary><p>${esc(preview)}</p>${ev.ip ? `<p class="sq-hint">IP: ${esc(ev.ip)}</p>` : ""}</details>` : ""}</td>
      <td><span class="vf-tag ${statusClass}">${esc(statusLabel)}</span></td>
    </tr>`;
  }).join("")}</tbody></table></div>`;
}
/* Visão ATIVIDADE — comparação lado a lado dos Squads. Um fetch por
 * user_id único (não por vínculo de Squad): pessoa em 3 Squads é buscada
 * 1 vez e o resultado é distribuído para os 3 cards. */
async function loadActivityView() {
  if (!ADMIN) return;
  const gen = ++STATE.activityView.gen;
  STATE.activityView.status = "loading";
  renderActivityView();
  try {
    await loadSquads();
    if (gen !== STATE.activityView.gen) return;
    const range = activityRange(STATE.activityView.period);
    const uniqueUsers = new Map();
    STATE.squads.forEach(s => (people(s.id) || []).forEach(m => { if (!uniqueUsers.has(m.user_id)) uniqueUsers.set(m.user_id, m); }));
    const usersList = [...uniqueUsers.values()];
    const cache = {};
    await eachLimited(usersList, async m => {
      const uid = m.user_id;
      const [recentes, falhas] = await Promise.all([
        api(`/admin/logs?${activityQuery({ user_id: uid, de: range.de, ate: range.ate, page: 1, limit: 20 })}`),
        api(`/admin/logs?${activityQuery({ user_id: uid, status: "falha", de: range.de, ate: range.ate, page: 1, limit: 1 })}`),
      ]);
      const logs = Array.isArray(recentes.logs) ? recentes.logs : [];
      cache[uid] = {
        userId: uid, nome: m.user_nome, email: m.user_email,
        eventosTotal: Number(recentes.total || 0), falhasTotal: Number(falhas.total || 0),
        ultimaAtividade: logs[0]?.created_at || null, eventosRecentes: logs,
      };
    });
    if (gen !== STATE.activityView.gen) return; // troca de período tornou esta resposta obsoleta
    STATE.activityView.peopleCache = cache;
    STATE.activityView.status = "loaded"; STATE.activityView.error = null;
  } catch (err) {
    if (gen !== STATE.activityView.gen) return;
    STATE.activityView.status = "error"; STATE.activityView.error = err;
  }
  renderActivityView();
}
function squadActivityData(squadId) {
  const members = people(squadId) || [];
  const cache = STATE.activityView.peopleCache;
  const peopleList = members.map(m => {
    const c = cache[m.user_id];
    return { userId: m.user_id, nome: m.user_nome, email: m.user_email, funcao: m.funcao,
      eventosTotal: c?.eventosTotal || 0, falhasTotal: c?.falhasTotal || 0, ultimaAtividade: c?.ultimaAtividade || null };
  });
  return {
    membrosTotal: members.length,
    membrosComAtividade: peopleList.filter(p => p.eventosTotal > 0).length,
    eventosTotal: peopleList.reduce((s, p) => s + p.eventosTotal, 0),
    falhasTotal: peopleList.reduce((s, p) => s + p.falhasTotal, 0),
    people: sortActivityPeople(peopleList),
  };
}
function activityGlobalSummary() {
  const cache = STATE.activityView.peopleCache;
  const allUserIds = new Set();
  STATE.squads.forEach(s => (people(s.id) || []).forEach(m => allUserIds.add(m.user_id)));
  let comAtividade = 0, eventos = 0, falhas = 0;
  allUserIds.forEach(uid => { const c = cache[uid]; if (c) { if (c.eventosTotal > 0) comAtividade++; eventos += c.eventosTotal; falhas += c.falhasTotal; } });
  return { squads: STATE.squads.length, pessoas: allUserIds.size, comAtividade, eventos, falhas };
}
function activityMatchesQuery(squad, data, query) {
  if (!query) return true;
  if (matches(query, squad.nome, squad.slug)) return true;
  return data.people.some(p => matches(query, p.nome, p.email));
}
function renderActivityCardPerson(p, query) {
  const highlight = !!query && matches(query, p.nome, p.email);
  return `<li>
    <button type="button" class="sq-activity-card-person${highlight ? " is-match" : ""}" data-action="activity-person" data-uid="${esc(p.userId)}">
      <span class="sq-activity-card-person-name">${esc(p.nome)}</span>
      ${p.eventosTotal ? `<span class="sq-activity-card-person-stats">${p.eventosTotal} ${p.eventosTotal === 1 ? "evento" : "eventos"}${p.falhasTotal ? ` · ${p.falhasTotal} ${p.falhasTotal === 1 ? "falha" : "falhas"}` : ""} · Última ${esc(formatMomento(p.ultimaAtividade, STATE.activityView.period))}</span>`
        : '<span class="sq-hint">Sem atividade no período</span>'}
    </button>
  </li>`;
}
function renderActivityCard(squad, data, query) {
  return `<article class="sq-activity-card">
    <header class="sq-activity-card-header">
      <h3>${esc(squad.nome)}</h3>
      <p class="sq-activity-card-stats">${data.membrosTotal} ${data.membrosTotal === 1 ? "membro" : "membros"} · ${data.membrosComAtividade} com atividade</p>
      <p class="sq-activity-card-totals">${data.eventosTotal} ${data.eventosTotal === 1 ? "evento" : "eventos"} · ${data.falhasTotal} ${data.falhasTotal === 1 ? "falha" : "falhas"}</p>
    </header>
    <ul class="sq-activity-card-people">${data.people.length ? data.people.map(p => renderActivityCardPerson(p, query)).join("") : '<li class="sq-hint">Nenhum membro neste Squad.</li>'}</ul>
  </article>`;
}
function renderActivityView() {
  if (!ADMIN) return;
  const a = STATE.activityView;
  document.querySelectorAll(".sq-period-btn").forEach(btn => btn.classList.toggle("is-active", btn.dataset.period === a.period));
  $("sq-activity-state-loading").hidden = a.status !== "loading";
  $("sq-activity-state-error").hidden = a.status !== "error";
  $("sq-activity-grid").hidden = a.status !== "loaded";
  if (a.status === "error") {
    $("sq-activity-error-message").textContent = a.error?.message || "Tente novamente.";
    $("sq-activity-global-summary").textContent = "";
    return;
  }
  if (a.status !== "loaded") { $("sq-activity-global-summary").textContent = ""; return; }
  const g = activityGlobalSummary();
  $("sq-activity-global-summary").textContent = `${g.squads} ${g.squads === 1 ? "Squad" : "Squads"} · ${g.pessoas} ${g.pessoas === 1 ? "pessoa" : "pessoas"} · ${g.comAtividade} com atividade · ${g.eventos} ${g.eventos === 1 ? "evento" : "eventos"} · ${g.falhas} ${g.falhas === 1 ? "falha" : "falhas"}`;
  const query = a.query;
  const cards = STATE.squads.map(s => ({ squad: s, data: squadActivityData(s.id) })).filter(({ squad, data }) => activityMatchesQuery(squad, data, query));
  $("sq-activity-grid").innerHTML = cards.length ? cards.map(({ squad, data }) => renderActivityCard(squad, data, query)).join("")
    : `<div class="sq-empty"><h3>Nenhum resultado</h3><p>Ajuste a busca para encontrar um Squad ou pessoa.</p></div>`;
  if (a.personModal.open) renderPersonModalBody();
}
/* Modal de atividade da pessoa — independente de STATE.modal (que guarda
 * os modais de escrita); mesmo padrão de foco contido e Esc. */
const iniciais = nome => String(nome || "?").trim().split(/\s+/).map(p => p[0]).slice(0, 2).join("").toUpperCase();
function openPersonModal(uid) {
  const cache = STATE.activityView.peopleCache[Number(uid)] || STATE.activityView.peopleCache[uid];
  if (!cache) return;
  STATE.activityView.personModal = { open: true, userId: cache.userId, status: "all" };
  STATE.returnFocus = document.activeElement;
  $("sq-person-modal-title").textContent = cache.nome;
  $("sq-person-modal-subtitle").textContent = cache.email || "";
  $("sq-person-modal-avatar").textContent = iniciais(cache.nome);
  $("sq-person-modal-squads").innerHTML = STATE.squads.map(s => ({ s, m: (people(s.id) || []).find(m => String(m.user_id) === String(cache.userId)) })).filter(x => x.m)
    .map(({ s, m }) => `<span class="vf-tag ${m.is_primary ? "is-primary" : ""}">${esc(s.nome)} · ${esc(FUNCAO_ROTULO[m.funcao] || "Função não definida")}${m.is_primary ? " · principal" : ""}</span>`).join("");
  renderPersonModalBody();
  $("sq-person-modal").classList.add("is-open");
  document.body.classList.add("vf-no-scroll");
  requestAnimationFrame(() => $("sq-person-modal-close").focus());
}
function closePersonModal() {
  if (!STATE.activityView.personModal.open) return;
  STATE.activityView.personModal.open = false;
  $("sq-person-modal").classList.remove("is-open");
  document.body.classList.remove("vf-no-scroll");
  if (STATE.returnFocus?.isConnected) STATE.returnFocus.focus();
}
function renderPersonModalBody() {
  const uid = STATE.activityView.personModal.userId;
  const cache = STATE.activityView.peopleCache[uid]; if (!cache) return;
  const period = STATE.activityView.period;
  const periodLabel = { hoje: "hoje", "7d": "nos últimos 7 dias", "30d": "nos últimos 30 dias" }[period];
  const ultima = cache.eventosRecentes[0];
  $("sq-person-modal-summary").innerHTML = `
    <div class="vf-metric"><span class="vf-metric__label">Eventos</span><span class="vf-metric__value">${cache.eventosTotal}</span><span class="vf-metric__foot">${periodLabel}</span></div>
    <div class="vf-metric ${cache.falhasTotal ? "vf-metric--warning" : ""}"><span class="vf-metric__label">Falhas</span><span class="vf-metric__value">${cache.falhasTotal}</span><span class="vf-metric__foot ${cache.falhasTotal ? "is-warning" : ""}">${cache.falhasTotal ? "veja abaixo" : "nenhuma"}</span></div>
    <div class="vf-metric"><span class="vf-metric__label">Última atividade</span><span class="vf-metric__value sq-metric-time">${esc(formatMomento(cache.ultimaAtividade, period))}</span><span class="vf-metric__foot">${ultima ? esc(rotuloAcao(ultima.acao)) : "sem registro"}</span></div>`;
  const statusFilter = STATE.activityView.personModal.status;
  const recentes = cache.eventosRecentes;
  const nFalha = recentes.filter(ev => String(ev.status).toLowerCase() === "falha").length;
  const nSucesso = recentes.filter(ev => String(ev.status).toLowerCase() === "sucesso").length;
  $("sq-person-modal-status").innerHTML = [["all", "Todos", recentes.length], ["sucesso", "Sucesso", nSucesso], ["falha", "Falha", nFalha]]
    .map(([k, l, n]) => `<button type="button" class="vf-btn vf-btn--secondary vf-btn--sm ${statusFilter === k ? "is-active" : ""}" data-action="person-status" data-status="${k}" aria-pressed="${statusFilter === k}">${l} <span class="vf-badge">${n}</span></button>`).join("");
  const events = recentes.filter(ev => statusFilter === "all" || String(ev.status).toLowerCase() === statusFilter);
  $("sq-person-modal-timeline").innerHTML = renderTimelineList(events, period);
}
/* Alterna Configuração ⇄ Atividade. Reflete no hash só para permitir
 * refresh preservar a visão — não é um router. */
function currentHashView() { return location.hash === "#activity" ? "activity" : "config"; }
function setView(view) {
  if (view === "activity" && !ADMIN) view = "config";
  if (view !== "activity") closePersonModal();
  STATE.view = view;
  $("sq-view-config").hidden = view !== "config";
  $("sq-view-activity").hidden = view !== "activity";
  document.querySelectorAll(".sq-mode-btn").forEach(btn => {
    const active = btn.dataset.view === view;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-selected", String(active));
  });
  const nextHash = view === "activity" ? "#activity" : "";
  if (location.hash !== nextHash) history.replaceState(null, "", location.pathname + location.search + nextHash);
  if (view === "activity" && ADMIN && STATE.activityView.status === "idle") loadActivityView();
}
async function readSquad(s) {
  STATE.errors[s.id] = {};
  try {
    STATE.membrosPorSquad[s.id] = listFrom(await api(`/squads/${s.id}/membros`), "membros");
    STATE.allowed[s.id] = true; // requireSquadAdmin confirmou este escopo.
  } catch (err) {
    STATE.errors[s.id].people = err;
    STATE.allowed[s.id] = false;
    if (err.status === 403) { delete STATE.membrosPorSquad[s.id]; delete STATE.clientesPorSquad[s.id]; return; }
  }
  try { STATE.clientesPorSquad[s.id] = listFrom(await api(`/squads/${s.id}/clientes`), "clientes"); }
  catch (err) {
    STATE.errors[s.id].clients = err;
    if (err.status === 403) { delete STATE.clientesPorSquad[s.id]; STATE.allowed[s.id] = false; }
  }
}
let refreshTask = null;
function loadSquads() {
  if (!TOKEN) return Promise.resolve();
  if (!refreshTask) refreshTask = refreshSquads().finally(() => { refreshTask = null; });
  return refreshTask;
}
async function refreshSquads() {
  STATE.refreshing = true;
  STATE.catalogsReady = false;
  Object.keys(CONTAS).forEach(slug => { if (CONTAS[slug].estado !== "carregando") delete CONTAS[slug]; }); // Atualizar relê as contas
  $("sq-refresh").disabled = true;
  $("sq-refresh").textContent = "Atualizando…";
  $("sq-state-error").style.display = "none";
  if (!STATE.squads.length) $("sq-state-loading").style.display = "block";
  $("sq-detail-status").textContent = STATE.squadAbertoId ? "Atualizando equipe e carteira…" : "";
  try {
    STATE.squads = listFrom(await api("/squads"), "squads");
    await eachLimited(STATE.squads, readSquad);
    $("sq-list-count").textContent = STATE.squads.length;
    $("sq-list").style.display = "flex";
    renderSquadList();
    if (STATE.squadAbertoId && !squadPorId(STATE.squadAbertoId)) fecharDetalhe();
    if (!STATE.initialSelection && STATE.squads.length) {
      STATE.initialSelection = true;
      if (!window.matchMedia("(max-width: 700px)").matches) {
        const first = STATE.squads.find(s => canManage(s.id)) || STATE.squads[0];
        await abrirSquad(first.id);
      }
    }
    if (STATE.squadAbertoId) renderDetalhe(STATE.squadAbertoId);
    if (ADMIN) {
      try {
        STATE.todosClientes = listFrom(await api("/clientes"), "clientes");
        STATE.catalogsReady = STATE.squads.every(s => !STATE.errors[s.id]?.clients && Array.isArray(clients(s.id)));
      } catch { STATE.catalogsReady = false; }
    }
    renderUnassigned();
  } catch (err) {
    $("sq-state-error").style.display = "block";
    $("sq-error-message").textContent = `${err.message} ${STATE.squads.length ? "Os dados anteriores foram mantidos." : ""}`;
    $("sq-detail-status").textContent = STATE.squadAbertoId ? "Não foi possível atualizar. Os dados exibidos são da última leitura." : "";
  } finally {
    STATE.refreshing = false;
    $("sq-state-loading").style.display = "none";
    $("sq-refresh").disabled = false;
    $("sq-refresh").textContent = "Atualizar";
    if (!$("sq-state-error").offsetHeight && STATE.squadAbertoId) renderDetailStatus();
  }
}
function coordinators(s) {
  if (STATE.errors[s.id]?.people) return STATE.errors[s.id].people.status === 403 ? "Gestão restrita à coordenação" : "Coordenação indisponível";
  const names = (people(s.id) || []).filter(m => m.funcao === "coordenador").map(m => m.user_nome);
  return names.length ? names.join(", ") : "Sem coordenador";
}
// "Sem coordenação" só quando a equipe foi lida: equipe indisponível não é equipe vazia.
const semCoordenacao = s => Array.isArray(people(s.id)) && !people(s.id).some(m => m.funcao === "coordenador");
const KPI_ROTULO = { ativos: "Squads ativos", semcoord: "Sem coordenação" };
function renderKpis() {
  const wrap = $("sq-kpis");
  wrap.hidden = !STATE.squads.length;
  if (!STATE.squads.length) return;
  const ativos = STATE.squads.filter(s => s.ativo !== false).length;
  const pessoas = new Set(STATE.squads.flatMap(s => (people(s.id) || []).map(m => String(m.user_id)))).size;
  const parcial = STATE.squads.some(s => !Array.isArray(people(s.id)));
  const clientes = STATE.squads.reduce((n, s) => n + (Number(count(s, "clients")) || 0), 0);
  const semCoord = STATE.squads.filter(semCoordenacao).length;
  const items = [
    { k: "ativos", label: "Squads ativos", value: ativos, foot: `${STATE.squads.length - ativos} ${STATE.squads.length - ativos === 1 ? "inativo" : "inativos"}` },
    { label: "Pessoas", value: pessoas, foot: parcial ? "nos Squads que você gerencia" : "distintas, em todos os Squads" },
    { label: "Clientes na carteira", value: clientes, foot: "atribuídos a algum Squad" },
    { k: "semcoord", label: "Sem coordenação", value: semCoord, foot: semCoord ? "precisa de coordenador" : "todos coordenados", warn: semCoord > 0 },
  ];
  if (ADMIN && STATE.catalogsReady) {
    const pend = eligibleClients().length;
    items.push({ k: "pend", label: "Aguardando Squad", value: pend, foot: "clientes sem atribuição", warn: pend > 0 });
  }
  wrap.innerHTML = items.map(i => i.k
    ? `<button type="button" class="vf-metric sq-kpi ${i.warn ? "is-warning" : ""} ${STATE.kpi === i.k ? "is-active" : ""}" data-action="kpi" data-kpi="${i.k}" aria-pressed="${STATE.kpi === i.k}"><span class="vf-metric__label">${i.label}</span><span class="vf-metric__value">${i.value}</span><span class="vf-metric__foot ${i.warn ? "is-warning" : ""}">${i.foot}</span></button>`
    : `<div class="vf-metric sq-kpi"><span class="vf-metric__label">${i.label}</span><span class="vf-metric__value">${i.value}</span><span class="vf-metric__foot">${i.foot}</span></div>`).join("");
}
function renderSquadList() {
  const query = $("sq-search").value;
  const filtered = STATE.squads.filter(s => matches(query, s.nome, s.slug,
    ...(people(s.id) || []).flatMap(m => [m.user_nome, m.user_email]),
    ...(clients(s.id) || []).flatMap(c => [c.nome, c.slug]))
    && (STATE.kpi !== "ativos" || s.ativo !== false) && (STATE.kpi !== "semcoord" || semCoordenacao(s)));
  $("sq-search-status").textContent = query ? `${filtered.length} de ${STATE.squads.length} Squads · busca nos dados disponíveis` : "";
  $("sq-kpi-filter").hidden = !KPI_ROTULO[STATE.kpi];
  $("sq-kpi-filter").innerHTML = KPI_ROTULO[STATE.kpi] ? `<span class="vf-tag is-primary">Filtro: ${KPI_ROTULO[STATE.kpi]}</span><button type="button" class="sq-text-button" data-action="kpi" data-kpi="${STATE.kpi}">Limpar</button>` : "";
  $("sq-list").innerHTML = filtered.map(s => {
    const selected = String(STATE.squadAbertoId) === String(s.id);
    return `<button type="button" class="sq-row ${selected ? "is-selected" : ""}" data-action="abrir" data-id="${esc(s.id)}" aria-current="${selected ? "true" : "false"}" aria-controls="sq-detail">
      <span class="sq-row__main"><strong>${esc(s.nome)}</strong>${isLegado(s) ? '<span class="vf-tag sq-badge-legado">Legado</span>' : ""}${s.ativo === false ? '<span class="vf-tag sq-tag">Inativo</span>' : ""}</span>
      <span class="sq-row__stats"><span><b>${count(s, "clients")}</b> ${Number(count(s, "clients")) === 1 ? "cliente" : "clientes"}</span><span><b>${count(s, "people")}</b> ${Number(count(s, "people")) === 1 ? "pessoa" : "pessoas"}</span></span>
      <span class="sq-row__coord">${esc(coordinators(s))}</span></button>`;
  }).join("") || `<div class="sq-empty"><h3>${STATE.squads.length ? "Nenhum Squad encontrado" : "Nenhum Squad disponível"}</h3><p>${STATE.squads.length ? (STATE.kpi ? "Limpe o filtro ou busque outro nome." : "Busque outro nome ou limpe a busca.") : "Os Squads disponíveis para você aparecerão aqui."}</p></div>`;
  renderKpis();
}
async function abrirSquad(id) {
  if (STATE.busy) return;
  const changed = String(STATE.squadAbertoId) !== String(id);
  STATE.squadAbertoId = Number(id);
  const version = ++STATE.selection;
  if (changed) {
    $("sq-clients-search").value = "";
    STATE.editingName = false;
    STATE.clienteAberto = null;
  }
  $("sq-detail").style.display = "block";
  $("sq-detail-placeholder").hidden = true;
  $("sq-workspace").classList.add("has-detail");
  renderSquadList(); renderDetalhe(id);
  if (!people(id) && !STATE.errors[id]?.people && !STATE.refreshing) {
    await readSquad(squadPorId(id));
    if (version !== STATE.selection) return;
    renderDetalhe(id); renderSquadList();
  }
  if (changed && window.matchMedia("(max-width: 700px)").matches) {
    $("sq-detail-title").focus({ preventScroll: true });
    $("sq-workspace").scrollIntoView({ block: "start" });
  }
}
function fecharDetalhe() {
  if (STATE.busy) return;
  const id = STATE.squadAbertoId;
  STATE.squadAbertoId = null; STATE.selection++;
  $("sq-detail").style.display = "none";
  $("sq-detail-placeholder").hidden = false;
  $("sq-workspace").classList.remove("has-detail");
  renderSquadList();
  document.querySelector(`.sq-row[data-id="${Number(id)}"]`)?.focus();
}
function renderDetailStatus() {
  const id = STATE.squadAbertoId;
  const errors = STATE.errors[id] || {};
  const denied = errors.people?.status === 403;
  $("sq-detail-status").innerHTML = denied
    ? "Você pode consultar o resumo. A equipe e a carteira são restritas ao coordenador deste Squad e aos administradores."
    : (errors.people || errors.clients) ? 'Parte dos dados não pôde ser atualizada. <button type="button" class="sq-text-button" data-action="retry">Tentar novamente</button>' : "";
}
function renderDetalhe(id) {
  const s = squadPorId(id); if (!s) return;
  const editable = canManage(id), ativo = s.ativo !== false;
  // Nome: clicar no título abre o campo no lugar (PATCH /squads/:id, mesmo contrato do antigo "Editar Squad").
  if (!STATE.editingName) {
    $("sq-detail-title").innerHTML = editable
      ? `<button type="button" class="sq-name-btn" data-action="edit-name" title="Clique para renomear">${esc(s.nome)}</button>`
      : esc(s.nome);
  }
  $("sq-detail-title").hidden = STATE.editingName;
  $("sq-name-input").hidden = !STATE.editingName;
  // Status: só admin altera (requireAdmin no backend); os demais veem o estado.
  const stateText = ativo ? "Ativo" : "Inativo";
  $("sq-detail-state-wrap").innerHTML = ADMIN
    ? `<button type="button" id="sq-detail-state" class="sq-status-btn ${ativo ? "is-on" : "is-off"}" data-action="toggle-state" title="Clique para ${ativo ? "desativar" : "reativar"}" aria-label="Status: ${stateText}. Clique para ${ativo ? "desativar" : "reativar"}"><span class="vf-status ${ativo ? "is-success" : "is-neutral"}">${stateText}</span><span class="sq-status-btn__caret" aria-hidden="true">⇄</span></button>`
    : `<span id="sq-detail-state" class="vf-status ${ativo ? "is-success" : "is-neutral"}">${stateText}</span>`;
  $("sq-detail-legado").hidden = !isLegado(s);
  $("sq-detail-coord").textContent = `Coordenação · ${coordinators(s)}`;
  $("sq-legacy-note").hidden = !isLegado(s);
  renderPhoto(s);
  const rows = people(id), carteira = clients(id);
  const nPrincipal = rows ? rows.filter(m => m.is_primary).length : null;
  const nCoord = rows ? rows.filter(m => m.funcao === "coordenador").length : null;
  const nInativos = carteira ? carteira.filter(c => c.ativo === false).length : null;
  $("sq-detail-subtitle").innerHTML = `
    <a class="vf-metric" href="#sq-people-section"><span class="vf-metric__label">Pessoas</span><span class="vf-metric__value">${count(s, "people")}</span><span class="vf-metric__foot">${nPrincipal === null ? "equipe indisponível" : `${nPrincipal} com este Squad principal`}</span></a>
    <a class="vf-metric" href="#sq-clients-section"><span class="vf-metric__label">Clientes</span><span class="vf-metric__value">${count(s, "clients")}</span><span class="vf-metric__foot">${nInativos === null ? "carteira indisponível" : `${nInativos} ${nInativos === 1 ? "inativo" : "inativos"}`}</span></a>
    ${contasMetric(id)}
    <div class="vf-metric ${nCoord === 0 ? "vf-metric--warning" : ""}"><span class="vf-metric__label">Coordenadores</span><span class="vf-metric__value">${nCoord ?? "—"}</span><span class="vf-metric__foot ${nCoord === 0 ? "is-warning" : ""}">${nCoord === null ? "equipe indisponível" : nCoord ? "coordenação definida" : "defina um coordenador"}</span></div>`;
  if (carteira?.some(c => !CONTAS[c.slug])) loadContasDoSquad(id);
  $("sq-btn-add-member").hidden = !canManage(id);
  $("sq-btn-add-cliente").hidden = !canManage(id);
  $("sq-people-count").textContent = count(s, "people");
  $("sq-clients-count").textContent = count(s, "clients");
  renderDetailStatus(); renderPeople(); renderClients();
}
function contentState(kind, rows) {
  const err = STATE.errors[STATE.squadAbertoId]?.[kind];
  if (err?.status === 403) return '<p class="sq-empty">Disponível para a coordenação deste Squad.</p>';
  if (!rows) return `<p class="sq-empty">${err ? "Não foi possível carregar esta seção. Use Tentar novamente acima." : "Carregando…"}</p>`;
  return "";
}
function renderPeople() {
  const id = STATE.squadAbertoId; if (!id) return;
  const rows = people(id); const state = contentState("people", rows);
  if (state) { $("sq-membros-wrap").innerHTML = state; return; }
  const sorted = rows.slice().sort((a,b) => FUNCOES.indexOf(b.funcao) - FUNCOES.indexOf(a.funcao) || String(a.user_nome).localeCompare(String(b.user_nome), "pt-BR"));
  // Mover pessoa exige gerir também algum destino (POST + DELETE em /squads/*).
  const canMovePeople = canManage(id) && STATE.squads.some(s => String(s.id) !== String(id) && s.ativo !== false && canManage(s.id));
  $("sq-membros-wrap").innerHTML = sorted.length ? `<div class="vf-table-wrap"><table class="vf-table sq-people"><caption class="sq-sr-only">Pessoas de ${esc(squadName(id))}</caption><thead><tr><th scope="col">Pessoa</th><th scope="col">Função</th><th scope="col">Squad principal</th>${canManage(id) ? '<th scope="col" class="sq-col-actions"><span class="sq-sr-only">Ações</span></th>' : ""}</tr></thead><tbody>${sorted.map(m => {
    const name = esc(m.user_nome), uid = esc(m.user_id), valid = FUNCOES.includes(m.funcao);
    return `<tr class="sq-person" data-person="${uid}"><td class="sq-person-identity"><strong>${name}</strong><span>${esc(m.user_email)}</span></td>
      <td class="sq-person-role">${ADMIN && canManage(id) ? `<label class="sq-sr-only" for="sq-role-${uid}">Função de ${name}</label><select id="sq-role-${uid}" class="vf-select sq-funcao-select" data-uid="${uid}" data-original="${esc(m.funcao)}">${!valid ? '<option value="" selected>Função não definida</option>' : ""}<option value="membro" ${m.funcao === "membro" ? "selected" : ""}>Membro</option><option value="gestor" ${m.funcao === "gestor" ? "selected" : ""}>Gestor</option><option value="coordenador" ${m.funcao === "coordenador" ? "selected" : ""}>Coordenador</option></select>` : `<span class="sq-role-label">${valid ? FUNCAO_ROTULO[m.funcao] : "Função não definida"}</span>`}</td>
      <td class="sq-person-primary">${m.is_primary ? '<span class="sq-primary">Principal</span>' : canManage(id) ? `<button type="button" class="sq-text-button" data-action="principal" data-uid="${uid}" aria-label="Definir este Squad como principal de ${name}">Definir principal</button>` : '<span class="sq-hint">Outro Squad principal</span>'}</td>
      ${canManage(id) ? `<td class="sq-col-actions"><span class="sq-row-actions">${canMovePeople ? `<button type="button" class="vf-btn vf-btn--secondary vf-btn--sm" data-action="mover-pessoa" data-uid="${uid}" aria-label="Mover ${name} para outro Squad">Mover <span aria-hidden="true">→</span></button>` : ""}<button type="button" class="sq-remove" data-action="remover" data-uid="${uid}" aria-label="Remover ${name} deste Squad">Remover</button></span></td>` : ""}</tr>`;
  }).join("")}</tbody></table></div>` : `<div class="sq-empty"><h4>A equipe começa aqui</h4><p>Nenhum membro neste squad. Use Adicionar pessoa para compor a equipe.</p></div>`;
}
// Página do cliente: Cliente 360 V3 — vf-context.js lê ?cliente=<slug>.
const clienteUrl = c => `cliente-360-v3.html?cliente=${encodeURIComponent(c.slug)}`;
/* Linha do cliente expansível (padrão de /clientes.html): mostra as contas
 * por marketplace via GET /clientes/:slug/contas, a mesma leitura da tela de
 * Clientes, com o diagnóstico de clientes-contas-resumo.js. Uma aberta por vez. */
const CONTAS = {}; // slug -> { estado: "carregando"|"ok"|"erro", contas, erro }
const RESUMO = () => window.VF_CLIENTES_CONTAS_RESUMO;
const MARKETPLACES = [["meli", "Mercado Livre"], ["shopee", "Shopee"], ["tiktok", "TikTok Shop"]];
const TOM_TAG = { success: "is-success", warning: "is-warning", danger: "is-danger", neutral: "is-neutral" };
const TOM_CHECK = { ok: "is-success", warn: "is-warning", bad: "is-danger", na: "is-neutral" };
async function fetchContas(slug) {
  CONTAS[slug] = { estado: "carregando", contas: CONTAS[slug]?.contas || [] };
  try {
    const data = await api(`/clientes/${encodeURIComponent(slug)}/contas`);
    CONTAS[slug] = { estado: "ok", contas: Array.isArray(data.contas) ? data.contas : [] };
  } catch (err) {
    CONTAS[slug] = { estado: "erro", contas: [], erro: err };
  }
}
async function loadContas(slug) {
  const pending = fetchContas(slug);
  renderClients();
  await pending;
  if (STATE.squadAbertoId) renderDetalhe(STATE.squadAbertoId);
}
/* KPI "Contas" do Squad: soma as contas ativas de todos os clientes da
 * carteira (mesma leitura da linha expandida, com fan-out limitado). */
async function loadContasDoSquad(id) {
  const pend = (clients(id) || []).filter(c => !CONTAS[c.slug]);
  if (!pend.length) return;
  pend.forEach(c => { CONTAS[c.slug] = { estado: "carregando", contas: [] }; }); // evita disparo duplo
  await eachLimited(pend, c => fetchContas(c.slug));
  if (String(STATE.squadAbertoId) === String(id)) renderDetalhe(id);
}
function contasResumo(id) {
  const carteira = clients(id); if (!carteira) return null;
  const estados = carteira.map(c => CONTAS[c.slug]);
  const porMp = { meli: 0, shopee: 0, tiktok: 0 };
  estados.forEach(e => (e?.estado === "ok" ? e.contas : []).filter(x => x.ativo !== false).forEach(x => { if (x.marketplace in porMp) porMp[x.marketplace]++; }));
  return {
    carregando: estados.some(e => !e || e.estado === "carregando"),
    semAcesso: estados.filter(e => e?.estado === "erro").length,
    total: porMp.meli + porMp.shopee + porMp.tiktok, porMp,
  };
}
function contasMetric(id) {
  const r = contasResumo(id);
  const foot = !r ? "carteira indisponível"
    : r.carregando ? "somando as contas…"
    : `ML ${r.porMp.meli} · Shopee ${r.porMp.shopee} · TikTok ${r.porMp.tiktok}${r.semAcesso ? ` · ${r.semAcesso} ${r.semAcesso === 1 ? "cliente" : "clientes"} sem leitura` : ""}`;
  return `<div class="vf-metric" id="sq-metric-contas"><span class="vf-metric__label">Contas</span><span class="vf-metric__value">${!r || r.carregando ? "—" : r.total}</span><span class="vf-metric__foot">${foot}</span></div>`;
}
function toggleCliente(slug) {
  STATE.clienteAberto = STATE.clienteAberto === slug ? null : slug;
  if (STATE.clienteAberto && CONTAS[slug]?.estado !== "ok") loadContas(slug); else renderClients();
  document.querySelector(`.sq-client-row[data-slug="${CSS.escape(slug)}"]`)?.focus();
}
/* "Abrir loja": vitrine pública no marketplace, em nova aba. Só a conta do
 * Mercado Livre com grant válido tem um ID de vendedor confiável (grant.ml_user_id);
 * as demais mostram o botão desabilitado com o motivo. */
function lojaExterna(conta) {
  if (conta.ativo === false) return { motivo: "Conta desativada" };
  if (conta.marketplace === "shopee") return { motivo: "A Shopee não tem conexão por API no Portal" };
  if (conta.marketplace !== "meli") return { motivo: "Sem integração com este marketplace" };
  if (!conta.grant) return { motivo: "Conta ainda não conectada ao Mercado Livre" };
  if (RESUMO()?.classificarStatusConta?.(conta)?.code === "atencao") return { motivo: "Conexão com problema: reconecte a conta" };
  const sellerId = conta.grant.ml_user_id || conta.external_account_id;
  if (!sellerId) return { motivo: "ID do vendedor indisponível" };
  return { url: `https://lista.mercadolivre.com.br/_CustId_${encodeURIComponent(sellerId)}` };
}
function renderConta(conta) {
  const diag = RESUMO()?.diagnosticarConta?.(conta);
  const nome = conta.nome || conta.external_account_id || `Conta #${conta.id}`;
  const loja = lojaExterna(conta);
  return `<li class="sq-conta">
    <div class="sq-conta__main">
      <div class="sq-conta__top"><strong>${esc(nome)}</strong>${conta.is_primary ? '<span class="vf-tag is-primary">Principal</span>' : ""}${diag ? `<span class="vf-tag ${TOM_TAG[diag.tom] || ""}">${esc(diag.label)}</span>` : ""}</div>
      <ul class="sq-conta__checks">${(diag?.checks || []).map(ch => `<li><span class="vf-status ${TOM_CHECK[ch.tom] || ""}">${esc(ch.label)}</span> ${esc(ch.texto)}</li>`).join("")}${conta.external_account_id ? `<li class="sq-conta__id">ID ${esc(conta.external_account_id)}</li>` : ""}</ul>
      ${diag?.dica && diag.prioridade > 0 ? `<p class="sq-hint">${esc(diag.dica)}</p>` : ""}
    </div>
    ${loja.url
      ? `<a class="vf-btn vf-btn--secondary vf-btn--sm sq-conta__open" href="${esc(loja.url)}" target="_blank" rel="noopener noreferrer" data-action="link" aria-label="Abrir a loja ${esc(nome)} no Mercado Livre (nova aba)">Abrir loja <span aria-hidden="true">↗</span></a>`
      : `<button type="button" class="vf-btn vf-btn--secondary vf-btn--sm sq-conta__open" disabled title="${esc(loja.motivo)}" aria-label="Abrir a loja ${esc(nome)}: indisponível. ${esc(loja.motivo)}">Abrir loja <span aria-hidden="true">↗</span></button>`}
  </li>`;
}
function renderClienteExpand(c, colspan) {
  const info = CONTAS[c.slug] || { estado: "carregando" };
  let body;
  if (info.estado === "carregando") body = '<p class="sq-hint" role="status">Carregando contas…</p>';
  else if (info.estado === "erro") body = info.erro?.status === 403
    ? '<p class="sq-hint">As contas deste cliente são visíveis só para quem atende a carteira dele.</p>'
    : `<p class="sq-hint">Não foi possível carregar as contas: ${esc(info.erro?.message || "tente novamente")} <button type="button" class="sq-text-button" data-action="retry-contas" data-slug="${esc(c.slug)}">Tentar novamente</button></p>`;
  else if (!info.contas.length) body = '<p class="sq-hint">Este cliente ainda não tem contas de marketplace.</p>';
  else body = `<div class="sq-contas-grid">${MARKETPLACES.map(([mp, rotulo]) => {
    const lista = info.contas.filter(x => x.marketplace === mp);
    if (!lista.length) return "";
    return `<section class="sq-contas-mp"><h4><span class="sq-mp-dot sq-mp-dot--${mp}" aria-hidden="true"></span>${rotulo} <span class="vf-badge">${lista.length}</span></h4><ul class="sq-contas-list">${lista.map(renderConta).join("")}</ul></section>`;
  }).join("")}</div>`;
  return `<tr class="sq-client-expand"><td colspan="${colspan}"><div class="sq-client-expand__inner" id="sq-cliente-${esc(c.id)}-contas">
    ${body}</div></td></tr>`;
}
function renderClients() {
  const id = STATE.squadAbertoId; if (!id) return;
  const rows = clients(id); const state = contentState("clients", rows);
  if (state) { $("sq-clientes-wrap").innerHTML = state; $("sq-clients-result").textContent = ""; return; }
  const filtered = rows.filter(c => matches($("sq-clients-search").value, c.nome, c.slug));
  $("sq-clients-result").textContent = `${filtered.length} de ${rows.length} clientes`;
  const canMove = ADMIN && canManage(id) && !STATE.errors[id]?.clients;
  $("sq-clientes-wrap").innerHTML = filtered.length ? `<div class="vf-table-wrap"><table class="vf-table sq-table"><caption class="sq-sr-only">Clientes de ${esc(squadName(id))}</caption><thead><tr><th scope="col">Cliente</th><th scope="col">Slug</th><th scope="col">Status</th><th scope="col" class="sq-col-actions">${canMove ? "Transferência" : '<span class="sq-sr-only">Ações</span>'}</th></tr></thead><tbody>${filtered.map(c => {
    const nome = esc(c.nome || c.slug), open = STATE.clienteAberto === c.slug;
    return `<tr class="sq-client-row ${open ? "is-open" : ""}" data-action="toggle-cliente" data-slug="${esc(c.slug)}" tabindex="0" aria-expanded="${open}" aria-controls="sq-cliente-${esc(c.id)}-contas" aria-label="${nome}: ${open ? "ocultar" : "mostrar"} contas">
      <td><span class="sq-client-name"><span class="sq-chev" aria-hidden="true">›</span><strong>${nome}</strong></span></td><td class="sq-client-slug">${esc(c.slug)}</td>
      <td>${c.ativo === false ? '<span class="vf-status is-neutral">Inativo</span>' : '<span class="vf-status is-success">Ativo</span>'}</td>
      <td class="sq-col-actions"><span class="sq-row-actions"><a class="vf-btn vf-btn--ghost vf-btn--sm" href="${esc(clienteUrl(c))}" data-action="link" aria-label="Abrir ${nome} na Cliente 360">Abrir <span aria-hidden="true">↗</span></a>${canMove ? `<button type="button" class="vf-btn vf-btn--secondary vf-btn--sm" data-action="mover" data-cid="${esc(c.id)}" aria-label="Mover ${nome} para outro Squad">Mover <span aria-hidden="true">→</span></button>` : ""}</span></td></tr>${open ? renderClienteExpand(c, 4) : ""}`;
  }).join("")}</tbody></table></div>` : `<div class="sq-empty"><h4>${rows.length ? "Nenhum cliente encontrado" : "Uma carteira para formar"}</h4><p>${rows.length ? "Tente outro nome ou identificador." : "Nenhum cliente neste squad. Adicione um cliente que aguarda atribuição."}</p></div>`;
}
function eligibleClients(query = "") {
  if (!STATE.catalogsReady) return [];
  const linked = new Set(STATE.squads.flatMap(s => (clients(s.id) || []).map(c => String(c.id))));
  return (STATE.todosClientes || []).filter(c => c.ativo !== false && !linked.has(String(c.id)) && matches(query, c.nome, c.slug));
}
function renderUnassigned() {
  const wrap = $("sq-unassigned"); wrap.hidden = !ADMIN;
  if (!ADMIN) return;
  if (!STATE.catalogsReady) { wrap.innerHTML = '<span>Clientes sem Squad · não foi possível verificar todas as carteiras.</span><button class="sq-text-button" type="button" data-action="retry">Tentar novamente</button>'; return; }
  const rows = eligibleClients(); wrap.hidden = !rows.length;
  wrap.innerHTML = `<div><strong>${rows.length} ${rows.length === 1 ? "cliente aguarda" : "clientes aguardam"} atribuição</strong><span>Clientes ativos que ainda não pertencem a um Squad.</span></div><button type="button" class="vf-btn vf-btn--secondary vf-btn--sm" data-action="assign">Atribuir clientes</button>`;
  renderKpis();
}
/* Dialogs: foco contido, retorno ao acionador, Esc e bloqueio durante escrita. */
function openModal(kind, sid) {
  STATE.modal = kind; STATE.returnFocus = document.activeElement;
  const modal = $(`sq-${kind}-modal`); modal.dataset.squadId = sid;
  modal.classList.add("is-open"); document.body.classList.add("vf-no-scroll");
  $("sq-workspace").inert = true;
  const danger = $(`sq-${kind}-danger`); danger.style.display = "none"; danger.textContent = "";
  requestAnimationFrame(() => {
    if (STATE.modal !== kind) return;
    const field = [...modal.querySelectorAll('input:not([type="checkbox"]), select')].find(el => !el.disabled && el.offsetParent !== null);
    (field || modal.querySelector("button"))?.focus();
  });
}
function closeModal() {
  if (STATE.busy || !STATE.modal) return;
  $(`sq-${STATE.modal}-modal`).classList.remove("is-open");
  STATE.modal = null; document.body.classList.remove("vf-no-scroll"); $("sq-workspace").inert = false;
  if (STATE.returnFocus?.isConnected) STATE.returnFocus.focus(); else $("sq-detail-title").focus({ preventScroll: true });
}
let confirmAction = null;
function confirmDialog({ title, text, label = "Confirmar", danger = false, action }) {
  $("sq-confirm-title").textContent = title; $("sq-confirm-body").textContent = text;
  $("sq-confirm-ok").textContent = label;
  $("sq-confirm-ok").className = `vf-btn vf-btn--${danger ? "danger" : "primary"}`;
  confirmAction = action; openModal("confirm", STATE.squadAbertoId);
}
async function mutate({ path, method, body, run, message, button, errorId, done }) {
  if (STATE.busy) return;
  STATE.busy = true;
  const text = button?.textContent; if (button) button.textContent = "Salvando…";
  const scope = STATE.modal ? $(`sq-${STATE.modal}-modal`) : $("sq-detail");
  const controls = [...scope.querySelectorAll("button,input,select")].map(el => [el, el.disabled]);
  controls.forEach(([el]) => el.disabled = true);
  if (errorId) { $(errorId).textContent = ""; $(errorId).style.display = "none"; }
  let success = false;
  try {
    // Uma leitura anterior não pode sobrescrever o resultado desta escrita.
    if (refreshTask) await refreshTask;
    await (run ? run() : api(path, { method, body })); success = true;
    feedback(message);
    // A escrita já foi confirmada. Falha de atualização nunca vira "falha ao salvar".
    await loadSquads();
  } catch (err) {
    const text = `${message.split(".")[0]} — alteração não concluída: ${err.message}`;
    if (errorId) { $(errorId).textContent = err.message; $(errorId).style.display = "block"; }
    else feedback(text, "danger");
    // Escrita em etapas que parou no meio: o servidor já mudou, a tela relê.
    if (err.partial) await loadSquads();
  } finally {
    STATE.busy = false; controls.forEach(([el, disabled]) => el.disabled = disabled); if (button) button.textContent = text;
    if (success) { closeModal(); done?.(); }
  }
  return success;
}
function memberAction(action, uid) {
  const sid = STATE.squadAbertoId; if (!canManage(sid)) return;
  const name = personName(sid, uid), squad = squadName(sid);
  const remove = action === "remover";
  confirmDialog({ title: remove ? "Remover pessoa da equipe" : "Definir Squad principal", danger: remove,
    text: remove ? `${name} deixará a equipe de ${squad}. Se este for o Squad principal, outro vínculo ativo será escolhido automaticamente, quando existir.` : `${squad} será o Squad principal de ${name}, substituindo o principal atual. Os outros vínculos da pessoa serão mantidos.`,
    label: remove ? "Remover pessoa" : "Definir principal",
    action: () => mutate({ path: `/squads/${sid}/membros/${uid}${remove ? "" : "/principal"}`, method: remove ? "DELETE" : "PATCH", message: remove ? `${name} foi removido de ${squad}.` : `${squad} agora é o Squad principal de ${name}.`, button: $("sq-confirm-ok"), errorId: "sq-confirm-danger" }) });
}
async function changeRole(select) {
  const sid = STATE.squadAbertoId, uid = select.dataset.uid, value = select.value;
  if (!ADMIN || !canManage(sid) || !FUNCOES.includes(value)) return;
  const success = await mutate({ path: `/squads/${sid}/membros/${uid}/funcao`, method: "PATCH", body: { funcao: value }, message: `${personName(sid, uid)} agora tem a função de ${FUNCAO_ROTULO[value].toLowerCase()} em ${squadName(sid)}.`, button: $("sq-btn-add-member") });
  if (!success) select.value = select.dataset.original;
}
function renderUserOptions() {
  const sid = $("sq-add-modal").dataset.squadId;
  const current = new Set((people(sid) || []).map(m => String(m.user_id)));
  const rows = (STATE.usuarios || []).filter(u => u.ativo !== false && !current.has(String(u.id)) && matches($("sq-add-search").value, u.nome, u.email));
  $("sq-add-user").innerHTML = '<option value="">Selecione uma pessoa</option>' + rows.map(u => `<option value="${esc(u.id)}">${esc(u.nome || u.email)} · ${esc(u.email)}</option>`).join("");
  if (!rows.length) $("sq-add-user").innerHTML = '<option value="">Nenhuma pessoa disponível para esta busca</option>';
  $("sq-add-confirm").disabled = true;
}
async function addPerson(sid) {
  if (!canManage(sid)) return;
  $("sq-add-subtitle").textContent = squadName(sid);
  $("sq-add-search").value = ""; $("sq-add-id").value = "";
  $("sq-add-funcao").value = "membro"; $("sq-add-principal").checked = false;
  $("sq-add-search-wrap").hidden = !ADMIN; $("sq-add-user-wrap").hidden = !ADMIN; $("sq-add-id-wrap").hidden = ADMIN;
  $("sq-add-confirm").disabled = true;
  $("sq-add-user").innerHTML = '<option value="">Carregando pessoas…</option>';
  openModal("add", sid);
  if (!ADMIN) { $("sq-add-id").focus(); return; }
  try {
    if (!STATE.usuarios) { const data = await api("/usuarios"); STATE.usuarios = Array.isArray(data) ? data : listFrom(data, "usuarios"); }
    if (STATE.modal === "add") renderUserOptions();
  } catch (err) {
    $("sq-add-danger").textContent = `Não foi possível carregar pessoas: ${err.message} Feche e tente novamente.`;
    $("sq-add-danger").style.display = "block";
  }
}
function confirmPerson() {
  const sid = $("sq-add-modal").dataset.squadId, uid = Number($(ADMIN ? "sq-add-user" : "sq-add-id").value);
  if (!Number.isInteger(uid) || uid <= 0 || !canManage(sid)) return;
  const name = STATE.usuarios?.find(u => Number(u.id) === uid)?.nome || `Pessoa #${uid}`;
  mutate({ path: `/squads/${sid}/membros`, method: "POST", body: { userId: uid, funcao: $("sq-add-funcao").value, isPrimary: $("sq-add-principal").checked }, message: `${name} foi adicionado a ${squadName(sid)}.`, button: $("sq-add-confirm"), errorId: "sq-add-danger" });
}
function clientOptions() {
  const rows = eligibleClients($("sq-addcliente-busca").value);
  $("sq-addcliente-select").innerHTML = rows.map(c => `<option value="${esc(c.id)}">${esc(c.nome || c.slug)} (${esc(c.slug)})</option>`).join("") || '<option value="">Nenhum cliente sem Squad encontrado</option>';
  $("sq-addcliente-select").selectedIndex = -1; clientPreview();
}
function clientPreview() {
  const sid = $("sq-addcliente-modal").dataset.squadId;
  const select = $("sq-addcliente-select");
  const label = ADMIN ? select.selectedOptions[0]?.textContent : `Cliente #${$("sq-addcliente-id").value}`;
  const value = $(ADMIN ? "sq-addcliente-select" : "sq-addcliente-id").value;
  $("sq-addcliente-preview").textContent = value ? `Adicionar Cliente ${label} ao ${squadName(sid)}?` : "Selecione o cliente para conferir a atribuição.";
  $("sq-addcliente-confirm").disabled = !value || (ADMIN && !STATE.catalogsReady);
}
async function addClient(sid) {
  if (!canManage(sid)) return;
  $("sq-addcliente-subtitle").textContent = `Destino · ${squadName(sid)}`;
  $("sq-addcliente-busca").value = ""; $("sq-addcliente-id").value = "";
  ["sq-addcliente-search-wrap", "sq-addcliente-select-wrap"].forEach(id => $(id).hidden = !ADMIN);
  $("sq-addcliente-id-wrap").hidden = ADMIN;
  openModal("addcliente", sid);
  if (ADMIN) {
    if (!STATE.catalogsReady) {
      $("sq-addcliente-confirm").disabled = true;
      $("sq-addcliente-select").innerHTML = '<option value="">Verificando carteiras…</option>';
      await loadSquads();
    }
    clientOptions();
    if (!STATE.catalogsReady) { $("sq-addcliente-danger").textContent = "A verificação de clientes sem Squad está incompleta. Feche e atualize para tentar novamente."; $("sq-addcliente-danger").style.display = "block"; }
  } else { clientPreview(); $("sq-addcliente-id").focus(); }
}
function confirmClient() {
  const sid = $("sq-addcliente-modal").dataset.squadId, cid = Number($(ADMIN ? "sq-addcliente-select" : "sq-addcliente-id").value);
  if (!Number.isInteger(cid) || cid <= 0 || !canManage(sid) || (ADMIN && !eligibleClients().some(c => Number(c.id) === cid))) return;
  const name = STATE.todosClientes?.find(c => Number(c.id) === cid)?.nome || `Cliente #${cid}`;
  mutate({ path: `/squads/${sid}/clientes`, method: "POST", body: { clienteId: cid }, message: `${name} foi atribuído a ${squadName(sid)}.`, button: $("sq-addcliente-confirm"), errorId: "sq-addcliente-danger" });
}
function openMove(cid) {
  const sid = STATE.squadAbertoId, client = clients(sid)?.find(c => String(c.id) === String(cid));
  if (!ADMIN || !canManage(sid) || !client) return;
  const modal = $("sq-move-modal"); modal.dataset.clienteId = cid; modal.dataset.clienteNome = client.nome || client.slug;
  $("sq-move-subtitle").textContent = `${client.nome || client.slug} · ${client.slug}`;
  $("sq-move-motivo").value = "";
  $("sq-move-destino").innerHTML = '<option value="">Selecione o destino</option>' + STATE.squads.filter(s => String(s.id) !== String(sid) && s.ativo !== false).map(s => `<option value="${esc(s.id)}">${esc(s.nome)}${isLegado(s) ? " · Legado" : ""}</option>`).join("");
  openModal("move", sid); movePreview();
}
function movePreview() {
  const modal = $("sq-move-modal"), sid = modal.dataset.squadId, dest = $("sq-move-destino").value;
  $("sq-move-preview").innerHTML = `<strong>${esc(modal.dataset.clienteNome)}</strong><span class="sq-transfer-route"><span><small>Origem</small>${esc(squadName(sid))}</span><span aria-hidden="true">→</span><span><small>Destino</small>${dest ? esc(squadName(dest)) : "Escolha um Squad"}</span></span>`;
  $("sq-move-confirm").disabled = !dest;
}
function confirmMove() {
  const modal = $("sq-move-modal"), sid = modal.dataset.squadId, cid = modal.dataset.clienteId, dest = $("sq-move-destino").value;
  if (!ADMIN || !canManage(sid) || !dest || dest === sid || squadPorId(dest)?.ativo === false) return;
  mutate({ path: `/squads/${dest}/clientes/${cid}/transferir`, method: "POST", body: { motivo: $("sq-move-motivo").value.trim() || null }, message: `${modal.dataset.clienteNome} foi movido de ${squadName(sid)} para ${squadName(dest)}.`, button: $("sq-move-confirm"), errorId: "sq-move-danger" });
}
/* Nome editável no próprio título: Enter ou sair do campo salva, Esc cancela. */
function startNameEdit() {
  const s = squadPorId(STATE.squadAbertoId); if (!s || !canManage(s.id) || STATE.busy) return;
  STATE.editingName = true;
  $("sq-name-input").value = s.nome;
  renderDetalhe(s.id);
  $("sq-name-input").focus(); $("sq-name-input").select();
}
let finishingName = false;
async function finishNameEdit(save) {
  if (!STATE.editingName || finishingName) return;
  finishingName = true;
  const s = squadPorId(STATE.squadAbertoId), nome = $("sq-name-input").value.trim();
  STATE.editingName = false;
  if (s) renderDetalhe(s.id);
  if (save && s && !nome) feedback("O nome do Squad não pode ficar vazio. O nome anterior foi mantido.", "warning");
  else if (save && s && nome !== s.nome) await mutate({ path: `/squads/${s.id}`, method: "PATCH", body: { nome }, message: `${s.nome} agora se chama ${nome}.` });
  finishingName = false;
  $("sq-detail-title").querySelector("button")?.focus();
}
/* Status: clicar alterna. Desativar pede confirmação; reativar é direto. */
function toggleSquadState() {
  const s = squadPorId(STATE.squadAbertoId); if (!ADMIN || !s || STATE.busy) return;
  if (s.ativo !== false) {
    confirmDialog({ title: "Desativar Squad", text: `${s.nome} ficará inativo. Um Squad inativo deixa de conceder acesso operacional pela carteira. Seus vínculos serão mantidos.`, label: "Desativar Squad", danger: true,
      action: () => mutate({ path: `/squads/${s.id}`, method: "PATCH", body: { ativo: false }, message: `${s.nome} está inativo.`, button: $("sq-confirm-ok"), errorId: "sq-confirm-danger" }) });
  } else mutate({ path: `/squads/${s.id}`, method: "PATCH", body: { ativo: true }, message: `${s.nome} foi reativado.` });
}
/* Foto do Squad: as rotas /squads não têm campo de imagem, então a imagem
 * fica só neste navegador (localStorage), reduzida para 160px. */
const PHOTO_KEY = id => `vf-squad-foto:${id}`;
const CAMERA_ICON = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/></svg>';
function readPhoto(id) { try { return localStorage.getItem(PHOTO_KEY(id)); } catch { return null; } }
function renderPhoto(s) {
  const foto = readPhoto(s.id), editable = canManage(s.id);
  const btn = $("sq-photo-btn");
  btn.classList.toggle("has-img", !!foto);
  btn.innerHTML = foto ? '<img alt="">' : CAMERA_ICON;
  if (foto) btn.querySelector("img").src = foto;
  btn.disabled = !editable;
  btn.title = editable ? (foto ? "Trocar imagem" : "Importar imagem") : "";
  btn.setAttribute("aria-label", foto ? `Trocar a imagem de ${s.nome}` : `Importar imagem para ${s.nome}`);
  $("sq-photo-remove").hidden = !foto || !editable;
  btn.closest(".sq-photo").hidden = !foto && !editable;
  $("sq-photo-remove").setAttribute("aria-label", `Remover a imagem de ${s.nome}`);
}
function photoHint(text) { $("sq-photo-hint").textContent = text; $("sq-photo-hint").hidden = !text; }
function importPhoto(file) {
  const s = squadPorId(STATE.squadAbertoId); if (!file || !s || !canManage(s.id)) return;
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { photoHint("Use uma imagem PNG, JPG ou WebP."); return; }
  if (file.size > 2 * 1024 * 1024) { photoHint(`A imagem tem ${(file.size / 1048576).toFixed(1)} MB. O limite é 2 MB.`); return; }
  const img = new Image(), url = URL.createObjectURL(file);
  img.onload = () => {
    const side = 160, canvas = document.createElement("canvas"); canvas.width = canvas.height = side;
    const crop = Math.min(img.width, img.height);
    canvas.getContext("2d").drawImage(img, (img.width - crop) / 2, (img.height - crop) / 2, crop, crop, 0, 0, side, side);
    URL.revokeObjectURL(url);
    try { localStorage.setItem(PHOTO_KEY(s.id), canvas.toDataURL("image/jpeg", 0.85)); }
    catch { photoHint("Não foi possível guardar a imagem neste navegador."); return; }
    renderPhoto(s);
    photoHint("Imagem salva neste navegador. Outras pessoas ainda não a veem.");
    $("sq-photo-btn").focus();
  };
  img.onerror = () => { URL.revokeObjectURL(url); photoHint("Não foi possível ler a imagem. Tente outro arquivo."); };
  img.src = url;
}
function removePhoto() {
  const s = squadPorId(STATE.squadAbertoId); if (!s || !canManage(s.id)) return;
  try { localStorage.removeItem(PHOTO_KEY(s.id)); } catch { /* armazenamento indisponível */ }
  renderPhoto(s); photoHint(""); $("sq-photo-btn").focus();
}
/* Mover pessoa: não há rota de transferência de membro. Usa as duas
 * existentes, nesta ordem — incluir no destino, depois remover da origem —
 * para que uma falha no meio nunca deixe a pessoa fora dos dois Squads. */
function openMovePerson(uid) {
  const sid = STATE.squadAbertoId, m = people(sid)?.find(x => String(x.user_id) === String(uid));
  if (!canManage(sid) || !m) return;
  const modal = $("sq-movepessoa-modal"); modal.dataset.userId = uid;
  $("sq-movepessoa-subtitle").textContent = `${m.user_nome} · ${m.user_email}`;
  $("sq-movepessoa-destino").innerHTML = '<option value="">Selecione o destino</option>' + STATE.squads
    .filter(s => String(s.id) !== String(sid) && s.ativo !== false && canManage(s.id))
    .map(s => { const ja = (people(s.id) || []).some(x => String(x.user_id) === String(uid)); return `<option value="${esc(s.id)}" ${ja ? "disabled" : ""}>${esc(s.nome)}${isLegado(s) ? " · Legado" : ""}${ja ? " (já participa)" : ""}</option>`; }).join("");
  $("sq-movepessoa-funcao").value = FUNCOES.includes(m.funcao) ? m.funcao : "membro";
  $("sq-movepessoa-rule").textContent = `${m.is_primary ? `${squadName(sid)} é o Squad principal desta pessoa; o destino passa a ser o principal. ` : ""}A pessoa é incluída no destino e depois removida de ${squadName(sid)}. Se a segunda etapa falhar, ela fica nos dois Squads e a tela avisa.`;
  openModal("movepessoa", sid); movePersonPreview();
}
function movePersonPreview() {
  const modal = $("sq-movepessoa-modal"), sid = modal.dataset.squadId, dest = $("sq-movepessoa-destino").value;
  $("sq-movepessoa-preview").innerHTML = `<span class="sq-transfer-route"><span><small>Sai de</small>${esc(squadName(sid))}</span><span aria-hidden="true">→</span><span><small>Entra em</small>${dest ? esc(squadName(dest)) : "Escolha um Squad"}</span></span>`;
  $("sq-movepessoa-confirm").disabled = !dest;
}
function confirmMovePerson() {
  const modal = $("sq-movepessoa-modal"), sid = modal.dataset.squadId, uid = modal.dataset.userId, dest = $("sq-movepessoa-destino").value;
  const m = people(sid)?.find(x => String(x.user_id) === String(uid));
  if (!m || !dest || dest === sid || !canManage(sid) || !canManage(dest)) return;
  const name = m.user_nome, funcao = $("sq-movepessoa-funcao").value;
  mutate({
    run: async () => {
      await api(`/squads/${dest}/membros`, { method: "POST", body: { userId: Number(uid), funcao, isPrimary: m.is_primary === true } });
      try { await api(`/squads/${sid}/membros/${uid}`, { method: "DELETE" }); }
      catch (err) { throw Object.assign(new Error(`${name} entrou em ${squadName(dest)}, mas continua em ${squadName(sid)}: ${err.message} Remova manualmente.`), { partial: true }); }
    },
    message: `${name} saiu de ${squadName(sid)} e entrou em ${squadName(dest)} como ${FUNCAO_ROTULO[funcao].toLowerCase()}.`,
    button: $("sq-movepessoa-confirm"), errorId: "sq-movepessoa-danger",
  });
}
/* Eventos delegados: renderizar uma lista não multiplica listeners. */
document.addEventListener("click", event => {
  const target = event.target.closest("[data-action]"); if (!target || STATE.busy) return;
  const action = target.dataset.action;
  if (action === "dismiss") feedback("");
  if (action === "abrir") abrirSquad(target.dataset.id);
  if (action === "retry") loadSquads();
  if (action === "principal" || action === "remover") memberAction(action, target.dataset.uid);
  if (action === "mover") openMove(target.dataset.cid);
  if (action === "mover-pessoa") openMovePerson(target.dataset.uid);
  if (action === "toggle-cliente") toggleCliente(target.dataset.slug);
  if (action === "retry-contas") loadContas(target.dataset.slug);
  if (action === "edit-name") startNameEdit();
  if (action === "toggle-state") toggleSquadState();
  if (action === "photo") $("sq-photo-input").click();
  if (action === "photo-remove") removePhoto();
  if (action === "kpi") {
    if (target.dataset.kpi === "pend") { STATE.kpi = null; renderSquadList(); document.querySelector('[data-action="assign"]')?.click(); return; }
    STATE.kpi = STATE.kpi === target.dataset.kpi ? null : target.dataset.kpi; renderSquadList();
  }
  if (action === "person-status") { STATE.activityView.personModal.status = target.dataset.status; renderPersonModalBody(); }
  if (action === "view") setView(target.dataset.view);
  if (action === "activity-period" && ADMIN) { STATE.activityView.period = target.dataset.period; loadActivityView(); }
  if (action === "activity-retry" && ADMIN) loadActivityView();
  if (action === "activity-person" && ADMIN) openPersonModal(target.dataset.uid);
  if (action === "assign") {
    if (STATE.squadAbertoId && canManage(STATE.squadAbertoId)) addClient(STATE.squadAbertoId);
    else { feedback("Selecione o Squad que receberá os clientes e use Adicionar cliente.", "neutral"); $("sq-search").focus(); }
  }
});
$("sq-search").addEventListener("input", renderSquadList);
$("sq-clients-search").addEventListener("input", renderClients);
$("sq-clientes-wrap").addEventListener("keydown", e => {
  const row = e.target.closest?.(".sq-client-row");
  if (row && e.target === row && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); toggleCliente(row.dataset.slug); }
});
$("sq-membros-wrap").addEventListener("change", e => { if (e.target.matches(".sq-funcao-select")) changeRole(e.target); });
$("sq-list").addEventListener("keydown", e => {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
  const rows = [...$("sq-list").querySelectorAll("button")], i = rows.indexOf(document.activeElement); if (i < 0) return;
  e.preventDefault(); rows[e.key === "Home" ? 0 : e.key === "End" ? rows.length - 1 : (i + (e.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length]?.focus();
});
$("sq-refresh").addEventListener("click", () => { if (!STATE.busy) loadSquads(); });
$("sq-btn-retry").addEventListener("click", loadSquads);
$("sq-detail-close").addEventListener("click", fecharDetalhe);
$("sq-btn-add-member").addEventListener("click", () => addPerson(STATE.squadAbertoId));
$("sq-btn-add-cliente").addEventListener("click", () => addClient(STATE.squadAbertoId));
$("sq-name-input").addEventListener("keydown", e => {
  if (e.key === "Enter") { e.preventDefault(); finishNameEdit(true); }
  if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finishNameEdit(false); }
});
$("sq-name-input").addEventListener("blur", () => finishNameEdit(true));
$("sq-photo-input").addEventListener("change", e => { importPhoto(e.target.files?.[0]); e.target.value = ""; });
$("sq-confirm-ok").addEventListener("click", () => { if (!STATE.busy) confirmAction?.(); });
$("sq-add-confirm").addEventListener("click", confirmPerson);
$("sq-add-search").addEventListener("input", renderUserOptions);
["sq-add-user", "sq-add-id"].forEach(id => $(id).addEventListener("input", () => $("sq-add-confirm").disabled = !$(id).value));
$("sq-addcliente-confirm").addEventListener("click", confirmClient);
$("sq-addcliente-busca").addEventListener("input", clientOptions);
$("sq-addcliente-select").addEventListener("change", clientPreview);
$("sq-addcliente-id").addEventListener("input", clientPreview);
$("sq-move-destino").addEventListener("change", movePreview);
$("sq-move-confirm").addEventListener("click", confirmMove);
$("sq-movepessoa-destino").addEventListener("change", movePersonPreview);
$("sq-movepessoa-confirm").addEventListener("click", confirmMovePerson);
["confirm", "add", "addcliente", "move", "movepessoa"].forEach(kind => {
  ["close", "cancel"].forEach(action => $(`sq-${kind}-${action}`).addEventListener("click", closeModal));
  $(`sq-${kind}-modal`).addEventListener("click", e => { if (e.target.id === `sq-${kind}-modal`) closeModal(); });
});
document.addEventListener("keydown", e => {
  if (STATE.activityView.personModal.open) {
    if (e.key === "Escape") { e.preventDefault(); closePersonModal(); return; }
    if (e.key === "Tab") {
      const controls = [...$("sq-person-modal").querySelectorAll("button,input,select,summary,[tabindex]")].filter(el => !el.disabled && el.offsetParent !== null);
      const first = controls[0], last = controls.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }
    return;
  }
  if (!STATE.modal) return;
  const modal = $(`sq-${STATE.modal}-modal`);
  if (e.key === "Escape") { e.preventDefault(); closeModal(); }
  if (e.key === "Tab") {
    const controls = [...modal.querySelectorAll("button,input,select,[tabindex]")].filter(el => !el.disabled && el.offsetParent !== null);
    const first = controls[0], last = controls.at(-1);
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
    if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
  }
  if (e.key === "Enter" && e.target.tagName === "INPUT" && !STATE.busy) {
    const id = STATE.modal === "confirm" ? "sq-confirm-ok" : `sq-${STATE.modal}-confirm`;
    if (!$(id).disabled) { e.preventDefault(); $(id).click(); }
  }
});
["sq-person-modal-close", "sq-person-modal-cancel"].forEach(id => $(id).addEventListener("click", closePersonModal));
$("sq-person-modal").addEventListener("click", e => { if (e.target.id === "sq-person-modal") closePersonModal(); });
$("sq-activity-search").addEventListener("input", () => { STATE.activityView.query = $("sq-activity-search").value; renderActivityView(); });
window.addEventListener("hashchange", () => setView(currentHashView()));
$("sq-access-label").textContent = ADMIN ? "Administração global" : "Gestão dos seus Squads";
$("sq-list-scope").textContent = ADMIN ? "Todos" : "Seus vínculos";
$("sq-mode-activity").hidden = !ADMIN;
if (!TOKEN) window.location.replace("index.html");
else { loadSquads(); setView(currentHashView()); }
