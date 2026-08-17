const STORAGE_KEY = "vf-token";
const API_BASE = "https://venforce-server.onrender.com";

function getToken() {
  const t = localStorage.getItem(STORAGE_KEY);
  if (!t) { window.location.replace("index.html"); return null; }
  return t;
}
const TOKEN = getToken();
const user = JSON.parse(localStorage.getItem("vf-user") || "{}");
if (user.role !== "admin") window.location.replace("dashboard.html");
initLayout();

function clearSession() {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem("vf-user");
  window.location.replace("index.html");
}

function escapeHTML(s) {
  const d = document.createElement("div");
  d.textContent = s == null ? "" : String(s);
  return d.innerHTML;
}

function filtrarClientes() {
  const termo = (document.getElementById("busca-cliente")?.value || "").toLowerCase().trim();
  const linhas = document.querySelectorAll("#clientes-tbody tr");
  let visiveis = 0;
  linhas.forEach((tr) => {
    const texto = tr.textContent.toLowerCase();
    const bate = !termo || texto.includes(termo);
    tr.style.display = bate ? "" : "none";
    if (bate) visiveis++;
  });
  const badge = document.getElementById("clientes-count");
  if (badge && badge.style.display !== "none") badge.textContent = String(visiveis);
}

function getMlConectarLink(slug) {
  return `${API_BASE}/ml/conectar/${encodeURIComponent(slug)}`;
}

function slugify(nome) {
  return String(nome || "").toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
}

const stateLoading = document.getElementById("state-loading");
const stateTable = document.getElementById("state-table");
const stateEmpty = document.getElementById("state-empty");
const stateError = document.getElementById("state-error");
const clientesCount = document.getElementById("clientes-count");
const clientesTbody = document.getElementById("clientes-tbody");
const clientesFeedback = document.getElementById("clientes-feedback");

let CLIENTES_LISTA = [];
let CLIENTES_CONFIRM_OPEN = false;
let CLIENTES_CONFIRM_ACTION = null;
let CLIENTE_DELETE_PENDENTE = null; // { slug, btn }
let DRAWER_CLIENTE = null; // { id, slug, nome }

function setClientesFeedback(message, type = "neutral") {
  if (!clientesFeedback) return;
  clientesFeedback.classList.remove("is-success", "is-danger", "is-info");
  clientesFeedback.textContent = "";
  clientesFeedback.style.display = "none";
  if (!message) return;
  const cls = type === "success" ? "is-success" : (type === "danger" ? "is-danger" : "is-info");
  clientesFeedback.classList.add(cls);
  clientesFeedback.style.display = "block";
  clientesFeedback.textContent = message;
}

function abrirModalConfirmacaoClientes({ title, subtitle = "", description, confirmLabel = "Confirmar", danger = false, onConfirm }) {
  const modal = document.getElementById("vf-clientes-confirm-modal");
  const t = document.getElementById("vf-clientes-confirm-title");
  const sub = document.getElementById("vf-clientes-confirm-subtitle");
  const desc = document.getElementById("vf-clientes-confirm-desc");
  const ok = document.getElementById("vf-clientes-confirm-ok");
  const dangerBox = document.getElementById("vf-clientes-confirm-danger");
  if (!modal || !ok || !desc || !t) return;

  CLIENTES_CONFIRM_OPEN = true;
  CLIENTES_CONFIRM_ACTION = typeof onConfirm === "function" ? onConfirm : null;

  t.textContent = title || "Confirmar";
  if (sub) sub.textContent = subtitle || "";
  desc.textContent = description || "";

  ok.textContent = confirmLabel || "Confirmar";
  ok.classList.remove("vf-btn--secondary", "vf-btn--danger");
  ok.classList.add(danger ? "vf-btn--danger" : "vf-btn--secondary");

  if (dangerBox) { dangerBox.style.display = "none"; dangerBox.textContent = ""; }
  modal.classList.add("is-open");
}

function fecharModalConfirmacaoClientes() {
  document.getElementById("vf-clientes-confirm-modal")?.classList.remove("is-open");
  CLIENTES_CONFIRM_OPEN = false;
  CLIENTES_CONFIRM_ACTION = null;
  CLIENTE_DELETE_PENDENTE = null;
}

async function confirmarModalClientes() {
  const ok = document.getElementById("vf-clientes-confirm-ok");
  const dangerBox = document.getElementById("vf-clientes-confirm-danger");
  if (!CLIENTE_DELETE_PENDENTE && !CLIENTES_CONFIRM_ACTION) return;

  if (dangerBox) { dangerBox.style.display = "none"; dangerBox.textContent = ""; }
  if (ok) { ok.disabled = true; ok.textContent = CLIENTE_DELETE_PENDENTE ? "Excluindo..." : "Processando…"; }

  try {
    if (CLIENTE_DELETE_PENDENTE) {
      const { slug, btn } = CLIENTE_DELETE_PENDENTE;
      if (!slug) throw new Error("Cliente inválido.");
      await deleteCliente(slug, btn);
      CLIENTE_DELETE_PENDENTE = null;
    } else {
      await CLIENTES_CONFIRM_ACTION();
    }
    fecharModalConfirmacaoClientes();
  } catch (err) {
    const msg = err?.message || "Não foi possível concluir a ação.";
    const dependencias = err?.dependencias;
    if (dangerBox) {
      dangerBox.style.display = "block";
      dangerBox.textContent = dependencias?.length
        ? `${msg} (${dependencias.map((d) => `${d.label}: ${d.total}`).join(", ")})`
        : msg;
    } else {
      setClientesFeedback(msg, "danger");
    }
    if (ok) { ok.disabled = false; ok.textContent = CLIENTE_DELETE_PENDENTE ? "Excluir cliente" : "Confirmar"; }
  }
}

function showLoading() {
  stateLoading.style.display = "flex";
  stateTable.style.display = stateEmpty.style.display = stateError.style.display = "none";
}
function showTable() {
  stateTable.style.display = "block";
  stateLoading.style.display = stateEmpty.style.display = stateError.style.display = "none";
}
function showEmpty() {
  stateEmpty.style.display = "block";
  stateLoading.style.display = stateTable.style.display = stateError.style.display = "none";
  clientesCount.style.display = "none";
}
function showError(msg) {
  stateError.style.display = "block";
  stateLoading.style.display = stateTable.style.display = stateEmpty.style.display = "none";
  document.getElementById("error-message").textContent = msg;
}

function setCreateLoading(on) {
  const btn = document.getElementById("btn-criar-cliente");
  const text = document.getElementById("btn-criar-cliente-text");
  const sp = document.getElementById("btn-criar-cliente-spinner");
  btn.disabled = on;
  text.textContent = on ? "Criando…" : "Criar cliente";
  sp.style.display = on ? "inline-block" : "none";
}

function setFormStatus(msg, isError) {
  const el = document.getElementById("cliente-status");
  el.textContent = msg || "";
  el.style.color = isError ? "var(--vf-danger)" : "var(--vf-success)";
  el.style.display = msg ? "block" : "none";
}

async function apiFetch(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { Authorization: "Bearer " + TOKEN, ...(options.headers || {}) },
  });
  if (res.status === 401) { clearSession(); throw new Error("Sessão expirada."); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.erro || data?.error || `HTTP ${res.status}`);
    err.code = data?.code;
    err.dependencias = data?.dependencias;
    err.contas = data?.contas;
    throw err;
  }
  return data;
}

async function loadClientes() {
  if (!TOKEN) return;
  showLoading();
  try {
    const data = await apiFetch("/clientes");
    const clientes = Array.isArray(data.clientes) ? data.clientes : [];
    CLIENTES_LISTA = clientes;
    renderClientes(clientes);
  } catch (err) {
    showError("Não foi possível carregar os clientes. Tente novamente.");
  }
}

function renderClientes(clientes) {
  clientesTbody.innerHTML = "";
  if (!clientes.length) { showEmpty(); return; }

  setClientesFeedback("");
  clientesCount.textContent = String(clientes.length);
  clientesCount.style.display = "inline-block";

  clientes.forEach((c, i) => {
    const ativo = c.ativo !== false;

    const tr = document.createElement("tr");
    tr.classList.add("animate-fade-up");
    tr.style.animationDelay = `${i * 0.04}s`;

    tr.innerHTML = `
      <td style="color:var(--vf-text-muted);font-family:var(--vf-font-mono);font-size:.8rem;">${String(i + 1).padStart(2, "0")}</td>
      <td><strong>${escapeHTML(c.nome || "—")}</strong></td>
      <td style="color:var(--vf-text-secondary);font-size:.875rem;font-family:var(--vf-font-mono);">${escapeHTML(c.slug || "—")}</td>
      <td>
        <span class="vf-status ${ativo ? "is-success" : "is-danger"}">${ativo ? "Ativo" : "Inativo"}</span>
      </td>
      <td id="resumo-contas-${escapeHTML(c.slug || "")}"><span style="color:var(--vf-text-muted);font-size:.8rem;">…</span></td>
      <td id="resumo-bases-${escapeHTML(c.slug || "")}"><span style="color:var(--vf-text-muted);font-size:.8rem;">…</span></td>
      <td>
        <div class="vf-table__actions">
          <button class="vf-btn vf-btn--sm vf-btn--secondary" data-action="abrir" data-slug="${escapeHTML(c.slug || "")}">Abrir</button>
          <button class="vf-btn vf-btn--sm vf-btn--danger" data-action="delete" data-slug="${escapeHTML(c.slug || "")}">Excluir</button>
        </div>
      </td>
    `;

    clientesTbody.appendChild(tr);
  });

  clientesTbody.querySelectorAll('button[data-action="delete"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const slug = btn.getAttribute("data-slug") || "";
      if (!slug) return;
      CLIENTE_DELETE_PENDENTE = { slug, btn };
      abrirModalConfirmacaoClientes({
        title: "Excluir cliente",
        subtitle: slug,
        description: `Esta ação remove o cliente "${slug}" do portal. Se houver contas, bases ou históricos vinculados, a exclusão será bloqueada.`,
        confirmLabel: "Excluir cliente",
        danger: true,
        onConfirm: null,
      });
    });
  });

  clientesTbody.querySelectorAll('button[data-action="abrir"]').forEach((btn) => {
    btn.addEventListener("click", () => abrirDrawerCliente(btn.getAttribute("data-slug") || ""));
  });

  showTable();
  const buscaAtiva = document.getElementById("busca-cliente");
  if (buscaAtiva) buscaAtiva.value = "";

  clientes.forEach((c) => carregarResumoContas(c.slug || ""));
}

async function carregarResumoContas(slug) {
  const celContas = document.getElementById(`resumo-contas-${slug}`);
  const celBases = document.getElementById(`resumo-bases-${slug}`);
  if (!celContas || !celBases) return;
  try {
    const data = await apiFetch(`/clientes/${encodeURIComponent(slug)}/contas`);
    const contas = Array.isArray(data.contas) ? data.contas : [];
    const meli = contas.filter((c) => c.marketplace === "meli" && c.ativo !== false).length;
    const shopee = contas.filter((c) => c.marketplace === "shopee" && c.ativo !== false).length;
    const bases = contas.filter((c) => c.base?.base_id).length;

    celContas.innerHTML = `
      <div class="vf-clientes-resumo">
        <span class="vf-clientes-resumo-item"><span class="vf-clientes-mp-dot vf-clientes-mp-dot--meli"></span>ML: ${meli}</span>
        <span class="vf-clientes-resumo-item"><span class="vf-clientes-mp-dot vf-clientes-mp-dot--shopee"></span>Shopee: ${shopee}</span>
      </div>`;
    celBases.innerHTML = `<span style="font-size:.8rem;color:var(--vf-text-secondary);">${bases}</span>`;
  } catch {
    celContas.innerHTML = `<span style="color:var(--vf-text-muted);font-size:.8rem;">—</span>`;
    celBases.innerHTML = `<span style="color:var(--vf-text-muted);font-size:.8rem;">—</span>`;
  }
}

async function deleteCliente(slug, btn) {
  btn.disabled = true;
  btn.textContent = "Excluindo…";
  try {
    await apiFetch(`/clientes/${encodeURIComponent(slug)}`, { method: "DELETE" });
    setClientesFeedback(`Cliente "${slug}" excluído com sucesso.`, "success");
    loadClientes();
    return true;
  } catch (err) {
    if (err.code !== "CLIENTE_COM_DEPENDENCIAS") setClientesFeedback(`Erro ao excluir: ${err.message}`, "danger");
    btn.disabled = false;
    btn.textContent = "Excluir";
    throw err;
  }
}

async function createCliente() {
  const nomeEl = document.getElementById("cliente-nome");
  const slugEl = document.getElementById("cliente-slug");
  const nome = nomeEl.value.trim();
  const slug = slugEl.value.trim();

  setFormStatus("", false);
  if (!nome) { setFormStatus("Informe o nome do cliente.", true); return; }
  if (!slug) { setFormStatus("Informe o slug do cliente.", true); return; }

  setCreateLoading(true);
  try {
    await apiFetch("/clientes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nome, slug }),
    });
    nomeEl.value = "";
    slugEl.value = "";
    setFormStatus("✓ Cliente criado com sucesso.", false);
    loadClientes();
  } catch (err) {
    setFormStatus("Erro ao criar: " + err.message, true);
  } finally {
    setCreateLoading(false);
  }
}

// ── DRAWER DO CLIENTE (contas ML/Shopee) ──────────────────────────────────

function abrirDrawerBase() {
  document.getElementById("cliente-drawer-backdrop")?.classList.add("is-open");
  document.getElementById("cliente-drawer")?.classList.add("is-open");
}
function fecharDrawerCliente() {
  document.getElementById("cliente-drawer-backdrop")?.classList.remove("is-open");
  document.getElementById("cliente-drawer")?.classList.remove("is-open");
  document.getElementById("cliente-drawer-shopee-form").style.display = "none";
  DRAWER_CLIENTE = null;
}

async function abrirDrawerCliente(slug) {
  const cliente = CLIENTES_LISTA.find((c) => c.slug === slug);
  if (!cliente) return;
  DRAWER_CLIENTE = cliente;

  document.getElementById("cliente-drawer-title").textContent = cliente.nome || slug;
  document.getElementById("cliente-drawer-meta").textContent = `${slug} · ${cliente.ativo !== false ? "ativo" : "inativo"}`;
  document.getElementById("cliente-drawer-add-meli").href = getMlConectarLink(slug);
  document.getElementById("cliente-drawer-state").textContent = "Carregando contas…";
  document.getElementById("cliente-drawer-meli-list").innerHTML = "";
  document.getElementById("cliente-drawer-shopee-list").innerHTML = "";

  abrirDrawerBase();
  await recarregarContasDrawer();
}

async function recarregarContasDrawer() {
  if (!DRAWER_CLIENTE) return;
  const stateEl = document.getElementById("cliente-drawer-state");
  try {
    const data = await apiFetch(`/clientes/${encodeURIComponent(DRAWER_CLIENTE.slug)}/contas`);
    const contas = Array.isArray(data.contas) ? data.contas : [];
    stateEl.textContent = "";
    renderContasMarketplace("meli", contas.filter((c) => c.marketplace === "meli"));
    renderContasMarketplace("shopee", contas.filter((c) => c.marketplace === "shopee"));
  } catch (err) {
    stateEl.textContent = `Não foi possível carregar as contas: ${err.message}`;
  }
}

function renderContasMarketplace(marketplace, contas) {
  const list = document.getElementById(`cliente-drawer-${marketplace}-list`);
  const empty = document.getElementById(`cliente-drawer-${marketplace}-empty`);
  list.innerHTML = "";
  if (!contas.length) { empty.style.display = "block"; return; }
  empty.style.display = "none";

  contas.forEach((conta) => {
    const card = document.createElement("div");
    card.className = "vf-clientes-conta-card";

    const tagPrincipal = conta.is_primary ? `<span class="vf-tag is-primary">Principal</span>` : "";
    const tagAtivo = conta.ativo === false
      ? `<span class="vf-status is-danger">Inativa</span>`
      : `<span class="vf-status is-success">Ativa</span>`;

    let grantHtml = "";
    if (marketplace === "meli") {
      if (conta.grant) {
        const statusOk = conta.grant.token_status === "valid";
        grantHtml = `
          <div class="vf-clientes-conta-card__meta">
            ml_user_id: ${escapeHTML(conta.grant.ml_user_id || "—")} ·
            <span class="vf-status ${statusOk ? "is-success" : "is-danger"}">${escapeHTML(conta.grant.token_status || "—")}</span>
          </div>`;
      } else {
        grantHtml = `<div class="vf-clientes-conta-card__meta">Sem grant Mercado Livre vinculado.</div>`;
      }
    }

    const baseHtml = conta.base?.base_id
      ? `<span class="vf-tag is-info">Base: ${escapeHTML(conta.base.nome || conta.base.slug || conta.base.base_id)}</span>`
      : `<span class="vf-tag is-neutral">Conta não definida</span>`;

    card.innerHTML = `
      <div class="vf-clientes-conta-card__top">
        <span class="vf-clientes-conta-card__nome">${escapeHTML(conta.nome)}</span>
        <div class="vf-clientes-conta-card__tags">${tagPrincipal}${tagAtivo}</div>
      </div>
      ${grantHtml}
      <div class="vf-clientes-conta-card__base">${baseHtml}</div>
      <div class="vf-clientes-conta-card__actions"></div>
    `;

    const actions = card.querySelector(".vf-clientes-conta-card__actions");

    if (!conta.is_primary && conta.ativo !== false) {
      const btnPrincipal = document.createElement("button");
      btnPrincipal.className = "vf-btn vf-btn--sm vf-btn--secondary";
      btnPrincipal.textContent = "Tornar principal";
      btnPrincipal.addEventListener("click", () => acaoConta(() => apiFetch(`/cliente-contas/${conta.id}/principal`, { method: "PATCH" })));
      actions.appendChild(btnPrincipal);
    }

    const btnToggle = document.createElement("button");
    btnToggle.className = "vf-btn vf-btn--sm vf-btn--secondary";
    btnToggle.textContent = conta.ativo === false ? "Ativar" : "Desativar";
    btnToggle.addEventListener("click", () => acaoConta(() =>
      apiFetch(`/cliente-contas/${conta.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ativo: conta.ativo === false }),
      })
    ));
    actions.appendChild(btnToggle);

    if (marketplace === "meli" && conta.grant) {
      const btnDesconectar = document.createElement("button");
      btnDesconectar.className = "vf-btn vf-btn--sm vf-btn--danger";
      btnDesconectar.textContent = "Desconectar";
      btnDesconectar.addEventListener("click", () => {
        abrirModalConfirmacaoClientes({
          title: "Desconectar conta Mercado Livre",
          subtitle: conta.nome,
          description: `Remove só o grant desta conta (${conta.nome}). As demais contas Mercado Livre deste cliente não são afetadas.`,
          confirmLabel: "Desconectar",
          danger: true,
          onConfirm: () => acaoConta(() => apiFetch(`/cliente-contas/${conta.id}/ml-grant`, { method: "DELETE" })),
        });
      });
      actions.appendChild(btnDesconectar);
    }

    list.appendChild(card);
  });
}

async function acaoConta(fn) {
  try {
    await fn();
    await recarregarContasDrawer();
    if (DRAWER_CLIENTE) carregarResumoContas(DRAWER_CLIENTE.slug);
  } catch (err) {
    setClientesFeedback(err.message || "Não foi possível concluir a ação.", "danger");
    throw err;
  }
}

async function criarContaShopee() {
  const nomeEl = document.getElementById("shopee-conta-nome");
  const nome = nomeEl.value.trim();
  if (!nome) { setClientesFeedback("Informe o nome da conta Shopee.", "danger"); return; }
  if (!DRAWER_CLIENTE) return;

  try {
    await apiFetch(`/clientes/${encodeURIComponent(DRAWER_CLIENTE.slug)}/contas`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ marketplace: "shopee", nome }),
    });
    nomeEl.value = "";
    document.getElementById("cliente-drawer-shopee-form").style.display = "none";
    await recarregarContasDrawer();
    carregarResumoContas(DRAWER_CLIENTE.slug);
    setClientesFeedback(`Conta Shopee "${nome}" criada.`, "success");
  } catch (err) {
    setClientesFeedback(`Erro ao criar conta Shopee: ${err.message}`, "danger");
  }
}

// Slug auto (editável)
let slugTouched = false;
const nomeInput = document.getElementById("cliente-nome");
const slugInput = document.getElementById("cliente-slug");
slugInput.addEventListener("input", () => { slugTouched = slugInput.value.trim().length > 0; });
nomeInput.addEventListener("input", () => {
  if (slugTouched) return;
  slugInput.value = slugify(nomeInput.value);
});

document.getElementById("btn-criar-cliente").addEventListener("click", createCliente);
document.getElementById("btn-retry").addEventListener("click", loadClientes);

document.getElementById("vf-clientes-confirm-close")?.addEventListener("click", fecharModalConfirmacaoClientes);
document.getElementById("vf-clientes-confirm-cancel")?.addEventListener("click", fecharModalConfirmacaoClientes);
document.getElementById("vf-clientes-confirm-ok")?.addEventListener("click", confirmarModalClientes);
document.getElementById("vf-clientes-confirm-modal")?.addEventListener("click", (e) => {
  if (e.target?.id === "vf-clientes-confirm-modal") fecharModalConfirmacaoClientes();
});

document.getElementById("cliente-drawer-close")?.addEventListener("click", fecharDrawerCliente);
document.getElementById("cliente-drawer-close-footer")?.addEventListener("click", fecharDrawerCliente);
document.getElementById("cliente-drawer-backdrop")?.addEventListener("click", fecharDrawerCliente);
document.getElementById("cliente-drawer-add-shopee")?.addEventListener("click", () => {
  document.getElementById("cliente-drawer-shopee-form").style.display = "block";
});
document.getElementById("cliente-drawer-shopee-cancel")?.addEventListener("click", () => {
  document.getElementById("cliente-drawer-shopee-form").style.display = "none";
});
document.getElementById("cliente-drawer-shopee-salvar")?.addEventListener("click", criarContaShopee);

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (CLIENTES_CONFIRM_OPEN) fecharModalConfirmacaoClientes();
  else if (DRAWER_CLIENTE) fecharDrawerCliente();
});

const buscaInput = document.getElementById("busca-cliente");
if (buscaInput) {
  let debounceTimer;
  buscaInput.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(filtrarClientes, 300);
  });
}

if (TOKEN) loadClientes();
