const STORAGE_KEY = "vf-token";
const API_BASE    = "https://venforce-server.onrender.com";
initLayout();

// ─── Sessão ───
function getToken() {
  const t = localStorage.getItem(STORAGE_KEY);
  if (!t) { window.location.replace("index.html"); return null; }
  return t;
}
const TOKEN = getToken();

function clearSession() {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem("vf-user");
  window.location.replace("index.html");
}

// ─── Autorização (espelha o backend: estrutura/identidade/destruição da
// base é admin-only — vincular/trocar conta, hard delete). A UI só reflete
// a mesma regra que o backend já aplica; nunca é a única barreira. ───
const VF_USER = JSON.parse(localStorage.getItem("vf-user") || "{}");
const IS_ADMIN = String(VF_USER.role || "").toLowerCase() === "admin";

// ─── Helpers ───
function escapeHTML(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function setImportStatus(msg, color) {
  const el = document.getElementById("import-status");
  el.textContent    = msg;
  el.style.color    = color || "var(--vf-text-m)";
  el.style.display  = msg ? "block" : "none";
}

function getImportMarketplace() {
  const el = document.getElementById("import-marketplace");
  return el ? el.value : "";
}

// Mercado Livre nasce sempre vinculado a uma conta explícita — nunca
// escolhida sozinha entre duas. TikTok Shop e Shopee funcionam como base
// independente — cliente/conta são opcionais (o vínculo, quando existir, é
// feito na própria importação ou depois pelo menu "⋯").
function marketplaceExigeCliente(mp) {
  return mp === "meli";
}
function marketplaceExigeConta(mp) {
  return mp === "meli";
}
// Marketplaces cobertos pela Fundação Cliente/Contas (ML/Shopee) — TikTok
// segue no modelo legado (cliente opcional, sem conta).
function marketplaceTemConta(mp) {
  return mp === "meli" || mp === "shopee";
}

function atualizarBotaoImportarDisabled() {
  const btn = document.getElementById("btn-importar");
  if (!btn) return;
  const mp = getImportMarketplace();
  let ok = !!mp;
  // Cliente é obrigatório só para Mercado Livre.
  if (marketplaceExigeCliente(mp)) {
    const cli = document.getElementById("import-cliente");
    ok = ok && !!(cli && cli.value);
  }
  // Conta é obrigatória só para Mercado Livre — nunca escolhida sozinha.
  if (marketplaceExigeConta(mp)) {
    const conta = document.getElementById("import-conta");
    ok = ok && !!(conta && conta.value);
  }
  btn.disabled = !ok;
}

function setImportLoading(on) {
  const btn = document.getElementById("btn-importar");
  if (btn) btn.disabled = on ? true : btn.disabled;
  document.getElementById("btn-importar-text").textContent     = on ? "Processando…" : "Pré-visualizar";
  document.getElementById("btn-importar-spinner").style.display = on ? "inline-block" : "none";
  if (!on) atualizarBotaoImportarDisabled();
}

// ─── Estados da tabela de bases ───
const stateLoading  = document.getElementById("state-loading");
const stateSections = document.getElementById("state-sections");
const stateEmpty    = document.getElementById("state-empty");
const stateError    = document.getElementById("state-error");

// ─── Estado (filtros frontend) ───
let TODAS_BASES = [];
let BASES_BUSCA = "";
let BASES_FILTRO_CLI = "";     // "" (todos) | "pendencia"
let PORTFOLIO = [];            // GET /me/portfolio → clientes com contas
let CARTEIRA = [];             // clientes montados (contas × bases) para a tela
const IMAGENS_CLIENTE = new Map(); // clienteId → imagem (GET /cliente-imagens)
let CLI_SEL = null;            // chave do cliente aberto no painel
let BASE_SEL = null;           // slug da base com os itens abertos
let BASES_CARREGADAS = false;  // depois da 1ª carga, recarregar não pisca o loading
let CLIENTES_DISPONIVEIS = [];
let CLIENTES_CARREGADOS = false;
// Vincular/trocar conta da base é admin-only no backend (POST/DELETE
// /base-vinculos, PUT /cliente-contas/:id/base) — a UI espelha a mesma regra.
let VINCULOS_EDITAVEIS = IS_ADMIN;
let VINCULO_BASE_ATUAL = null;
let VINCULOS_AVISO_ATIVO = false;
// Contas do cliente selecionado no modal de vínculo/importação, por marketplace.
let CONTAS_CLIENTE_ATUAL = [];

// ─── Estado (exclusão) ───
let BASE_DELETE_PENDENTE = null; // { slug, nome, btn }

function setDashboardFeedback(msg, type = "neutral") {
  const el = document.getElementById("bases-feedback");
  if (!el) return;
  el.classList.remove("is-success", "is-danger", "is-warning", "is-info");
  el.textContent = "";
  if (!msg) { el.style.display = "none"; return; }
  if (type === "success") el.classList.add("is-success");
  else if (type === "danger") el.classList.add("is-danger");
  else if (type === "warning") el.classList.add("is-warning");
  else if (type === "info") el.classList.add("is-info");
  el.style.display = "flex";
  el.textContent = msg;
}

const MARKETPLACES_SUPORTADOS = ["meli", "shopee", "tiktok"];

// "tiktok" / "tik tok" / "TikTok Shop" → "tiktok". A checagem de TikTok vem
// antes da de Shopee porque "tiktok shop" contém "shop". Nada que não seja
// reconhecido vira "meli": valor desconhecido é "outro".
function normalizarMarketplaceKey(valor) {
  const raw = String(valor || "").toLowerCase().trim();
  if (raw.includes("tiktok") || raw.includes("tik tok")) return "tiktok";
  if (raw.includes("shopee")) return "shopee";
  if (raw.includes("meli") || raw.includes("mercado")) return "meli";
  return "outro";
}

function marketplaceLabel(key) {
  const k = normalizarMarketplaceKey(key);
  if (k === "meli") return "Mercado Livre";
  if (k === "shopee") return "Shopee";
  if (k === "tiktok") return "TikTok Shop";
  return "Outro";
}

function getMarketplaceDisplay(base) {
  if (base?.vinculo?.marketplace) {
    const key = normalizarMarketplaceKey(base.vinculo.marketplace);
    return { key, label: marketplaceLabel(key), origem: "oficial" };
  }
  if (base?.sugestao?.marketplace) {
    const key = normalizarMarketplaceKey(base.sugestao.marketplace);
    if (key === "outro") return { key: "nao_definido", label: "Não definido", origem: "sugestao" };
    return { key, label: marketplaceLabel(key), origem: "sugestao" };
  }
  return { key: "nao_definido", label: "Não definido", origem: "nenhum" };
}

function detectarMarketplaceBase(base) {
  return getMarketplaceDisplay(base);
}

function formatDateTime(value) {
  if (!value) return "--";
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return "--";
  return d.toLocaleString("pt-BR");
}

function getClienteTexto(base) {
  const v = base?.vinculo || null;
  const s = base?.sugestao || null;
  return [
    v?.cliente_nome,
    v?.cliente_slug,
    v?.conta_nome,
    v?.conta_slug,
    v?.external_account_id,
    s?.cliente_nome,
    s?.cliente_slug,
  ].filter(Boolean).join(" ");
}

// Marketplace intrínseco da base (definido na importação). Bases antigas sem
// marketplace continuam como 'meli' (o banco tem DEFAULT 'meli'); valor
// preenchido e desconhecido NÃO é convertido em meli — vira "outro".
function getBaseMarketplaceKey(base) {
  const raw = String(base?.marketplace || "").toLowerCase().trim();
  if (!raw) return "meli";
  const key = normalizarMarketplaceKey(raw);
  return MARKETPLACES_SUPORTADOS.includes(key) ? key : "outro";
}

// Quantidade de itens da base (total_skus vem de GET /bases).
function getTotalItensBase(base) {
  const total = Number(base?.total_skus);
  return Number.isFinite(total) ? total : null;
}

// ─── Desatualização (COALESCE(updated_at, created_at) < hoje − 30d) ───
const DIAS_30_MS = 30 * 24 * 60 * 60 * 1000;
function getBaseTimestamp(base) {
  const v = base?.updated_at || base?.created_at;
  const d = v ? new Date(v) : null;
  return d && Number.isFinite(d.getTime()) ? d.getTime() : null;
}
function isBaseDesatualizada(base) {
  const t = getBaseTimestamp(base);
  if (t == null) return true; // sem data conhecida → tratar como desatualizada
  return (Date.now() - t) > DIAS_30_MS;
}

function diasDesdeAtualizacao(base) {
  const t = getBaseTimestamp(base);
  if (t == null) return null;
  return Math.max(0, Math.floor((Date.now() - t) / (24 * 60 * 60 * 1000)));
}

function formatarIdadeBase(base) {
  const dias = diasDesdeAtualizacao(base);
  if (dias == null) return "Sem data";
  if (dias === 0) return "Hoje";
  if (dias === 1) return "1 dia";
  return `${dias} dias`;
}

function abrirModalExcluirBase({ slug, nome, btn }) {
  const modal = document.getElementById("vf-excluir-base-modal");
  const sub = document.getElementById("vf-excluir-base-subtitle");
  const danger = document.getElementById("vf-excluir-base-danger");
  const confirmBtn = document.getElementById("vf-excluir-base-confirm");
  if (!modal || !confirmBtn) return;

  BASE_DELETE_PENDENTE = { slug, nome, btn };
  if (sub) sub.textContent = nome || slug || "";
  if (danger) { danger.style.display = "none"; danger.textContent = ""; }
  confirmBtn.disabled = false;
  confirmBtn.textContent = "Excluir base";
  modal.style.removeProperty("display");
  modal.classList.add("is-open");
}

function fecharModalExcluirBase() {
  const modal = document.getElementById("vf-excluir-base-modal");
  if (modal) {
    modal.classList.remove("is-open");
    modal.style.removeProperty("display");
  }
  BASE_DELETE_PENDENTE = null;
}

async function confirmarExclusaoBase() {
  const danger = document.getElementById("vf-excluir-base-danger");
  const confirmBtn = document.getElementById("vf-excluir-base-confirm");
  if (!BASE_DELETE_PENDENTE) return;
  const { slug, btn } = BASE_DELETE_PENDENTE;

  if (danger) { danger.style.display = "none"; danger.textContent = ""; }
  if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = "Excluindo..."; }

  try {
    await deleteBase(slug, btn);
    fecharModalExcluirBase();
  } catch (err) {
    if (danger) {
      danger.style.display = "block";
      if (Array.isArray(err.dependencies) && err.dependencies.length) {
        const itens = err.dependencies.map((d) => `<li>${escapeHTML(d.mensagem || d.tipo || "dependência")}</li>`).join("");
        danger.innerHTML = `<strong>${escapeHTML(err.message || "Esta base tem dependências e não pode ser excluída.")}</strong><ul style="margin:6px 0 0;padding-left:18px;">${itens}</ul>`;
      } else {
        danger.textContent = err?.message || "Não foi possível excluir a base.";
      }
    } else {
      setDashboardFeedback(err?.message || "Não foi possível excluir a base.", "danger");
    }
    if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = "Excluir base"; }
  }
}

function showLoading() {
  stateLoading.style.display  = "flex";
  stateSections.style.display = stateEmpty.style.display = stateError.style.display = "none";
}
function showSections() {
  stateSections.style.display = "block";
  stateLoading.style.display  = stateEmpty.style.display = stateError.style.display = "none";
}
function showEmpty() {
  stateEmpty.style.display    = "block";
  stateLoading.style.display  = stateSections.style.display = stateError.style.display = "none";
}
function showError(msg) {
  stateError.style.display    = "block";
  stateLoading.style.display  = stateSections.style.display = stateEmpty.style.display = "none";
  document.getElementById("error-message").textContent = msg;
}

// Leitura de clientes (GET /base-vinculos/clientes) não é admin-only —
// serve tanto o modal de importação (qualquer autenticado pode importar)
// quanto o modal de vínculo (edição em si é que é admin-only, checada em
// VINCULOS_EDITAVEIS na hora de salvar).
async function carregarClientesParaVinculos(silencioso = false) {
  if (!TOKEN || CLIENTES_CARREGADOS) return CLIENTES_DISPONIVEIS;
  try {
    const res = await fetch(`${API_BASE}/base-vinculos/clientes`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    if (res.status === 401) { clearSession(); return []; }
    if (res.status === 403) {
      setDashboardFeedback("Não foi possível carregar a lista de clientes para vínculo.", "danger");
      return [];
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.erro || `HTTP ${res.status}`);
    CLIENTES_DISPONIVEIS = Array.isArray(data.clientes)
      ? data.clientes
        .filter((c) => c.ativo !== false)
        .map((c) => ({ id: c.id, nome: c.nome, slug: c.slug, ativo: c.ativo }))
      : [];
    CLIENTES_CARREGADOS = true;
    return CLIENTES_DISPONIVEIS;
  } catch (err) {
    if (!silencioso) setDashboardFeedback("Não foi possível carregar os clientes para vínculo.", "danger");
    return CLIENTES_DISPONIVEIS;
  }
}

// Contas (ML/Shopee) de um cliente, filtradas por marketplace — usado tanto
// pelo picker de importação quanto pelo modal de vínculo. Reaproveita
// GET /clientes/:id/contas (mesma rota que /clientes.html usa), nunca expõe
// token — só id, nome, external_account_id e status do grant.
async function carregarContasCliente(clienteId, marketplace) {
  if (!TOKEN || !clienteId || !marketplace) return [];
  try {
    const res = await fetch(
      `${API_BASE}/clientes/${encodeURIComponent(clienteId)}/contas?marketplace=${encodeURIComponent(marketplace)}`,
      { headers: { Authorization: `Bearer ${TOKEN}` } }
    );
    if (res.status === 401) { clearSession(); return []; }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.erro || `HTTP ${res.status}`);
    return Array.isArray(data.contas) ? data.contas.filter((c) => c.ativo !== false) : [];
  } catch (err) {
    return [];
  }
}

function normalizarBasePrincipal(base) {
  return {
    ...base,
    vinculo: base?.vinculo || null,
    sugestao: base?.sugestao || null,
  };
}

function chaveBasePorId(base) {
  const id = base?.id;
  return id == null || id === "" ? "" : String(id);
}

function chaveBasePorSlug(base) {
  const slug = String(base?.slug || "").trim().toLowerCase();
  return slug ? `slug:${slug}` : "";
}

function aplicarVinculosNasBases(bases, basesComVinculos) {
  const porId = new Map();
  const porSlug = new Map();
  (Array.isArray(basesComVinculos) ? basesComVinculos : []).forEach((b) => {
    const idKey = chaveBasePorId(b);
    const slugKey = chaveBasePorSlug(b);
    if (idKey) porId.set(idKey, b);
    if (slugKey) porSlug.set(slugKey, b);
  });

  return (Array.isArray(bases) ? bases : []).map((base) => {
    const enriquecida = porId.get(chaveBasePorId(base)) || porSlug.get(chaveBasePorSlug(base));
    if (!enriquecida) return { ...base, vinculo: null, sugestao: null };
    return {
      ...base,
      vinculo: enriquecida.vinculo || null,
      sugestao: enriquecida.sugestao || null,
    };
  });
}

async function carregarBasesPrincipais() {
  const res = await fetch(`${API_BASE}/bases`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (res.status === 401) { clearSession(); return null; }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.erro || `HTTP ${res.status}`);
  const bases = Array.isArray(data?.bases) ? data.bases : (Array.isArray(data) ? data : []);
  return bases.map(normalizarBasePrincipal);
}

async function carregarVinculosComplementares() {
  const res = await fetch(`${API_BASE}/base-vinculos`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (res.status === 401) { clearSession(); return null; }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.erro || `HTTP ${res.status}`);
  return Array.isArray(data?.bases) ? data.bases : [];
}

// ─── Carteira (cliente → contas → base) ───
// A tela é organizada por cliente, como Clientes e Contas: à esquerda a
// lista de clientes; à direita, um cartão por conta conectada com a base
// vinculada a ela. Conta conectada sem base vira cartão tracejado — é onde
// a margem dos anúncios não calcula. Bases sem vínculo ficam juntas em
// "Bases sem cliente", para nunca sumirem da tela.
const MP_LOGOS = {
  meli: "assets/marketplaces/mercado-livre.svg",
  shopee: "assets/marketplaces/shopee.svg",
  tiktok: "assets/marketplaces/tiktok-shop.svg",
};
const MP_ORDEM = { meli: 0, shopee: 1, tiktok: 2 };
const CHAVE_SEM_CLIENTE = "sem-cliente";

function logoMarketplace(mp, tamanho = "md") {
  const key = normalizarMarketplaceKey(mp);
  const label = escapeHTML(marketplaceLabel(key));
  const src = MP_LOGOS[key];
  if (!src) return `<span class="vf-bases-logo vf-bases-logo--${tamanho} is-outro" title="${label}" aria-hidden="true">?</span>`;
  return `<span class="vf-bases-logo vf-bases-logo--${tamanho}" title="${label}"><img src="${src}" alt="${label}"></span>`;
}

function iniciaisCliente(nome) {
  const partes = String(nome || "").trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return "?";
  const a = partes[0][0] || "";
  const b = partes.length > 1 ? partes[partes.length - 1][0] : (partes[0][1] || "");
  return (a + b).toUpperCase();
}

function avatarCliente(cli, grande = false) {
  const cls = `vf-bases-avatar${grande ? " vf-bases-avatar--lg" : ""}`;
  if (cli.semCliente) {
    return `<span class="${cls} is-vazio" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg></span>`;
  }
  const img = cli.id != null ? IMAGENS_CLIENTE.get(Number(cli.id)) : null;
  return img
    ? `<span class="${cls} is-imagem" aria-hidden="true"><img src="${escapeHTML(img)}" alt=""></span>`
    : `<span class="${cls}" aria-hidden="true">${escapeHTML(iniciaisCliente(cli.nome))}</span>`;
}

function fmtInt(n) {
  return Number(n || 0).toLocaleString("pt-BR");
}

function statusIdadeHtml(base) {
  const dias = diasDesdeAtualizacao(base);
  const texto = dias == null ? "Sem data" : dias === 0 ? "Atualizada hoje" : `Atualizada há ${dias} ${dias === 1 ? "dia" : "dias"}`;
  return `<span class="vf-status ${isBaseDesatualizada(base) ? "is-warning" : "is-success"}">${escapeHTML(texto)}</span>`;
}

async function carregarPortfolio() {
  try {
    const res = await fetch(`${API_BASE}/me/portfolio`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    if (res.status === 401) { clearSession(); return; }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.erro || `HTTP ${res.status}`);
    PORTFOLIO = Array.isArray(data.clientes) ? data.clientes : [];
  } catch (err) {
    // Sem carteira a tela ainda funciona: os clientes vêm dos vínculos das
    // bases. Só os cartões de "conta sem base" deixam de aparecer.
    PORTFOLIO = [];
  }
}

// Mesma rota de Clientes e Contas. Sem a rota (404) ou sem imagem, fica a sigla.
async function carregarImagensClientes() {
  try {
    const res = await fetch(`${API_BASE}/cliente-imagens`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    if (!res.ok) return;
    const data = await res.json().catch(() => ({}));
    IMAGENS_CLIENTE.clear();
    (Array.isArray(data.imagens) ? data.imagens : []).forEach((i) => {
      if (i && i.clienteId && i.imagem) IMAGENS_CLIENTE.set(Number(i.clienteId), i.imagem);
    });
  } catch (err) {
    // Só identificação visual; sem imagem a sigla resolve.
  }
}

// Casa contas e bases do cliente. Ordem: vínculo explícito da base com a
// conta (cliente_conta_id) → base vinculada informada pela própria conta →
// marketplace sem Fundação de Contas (TikTok), em que a base é do cliente.
// Base que sobra vira cartão próprio ("Conta não definida"), nunca some.
function montarCartoesCliente(cli) {
  const restantes = [...cli.bases];
  const tirar = (pred) => {
    const i = restantes.findIndex(pred);
    return i >= 0 ? restantes.splice(i, 1)[0] : null;
  };
  const cartoes = cli.contas.map((conta) => {
    const mp = normalizarMarketplaceKey(conta.marketplace);
    let base = tirar((b) => b?.vinculo?.cliente_conta_id != null && String(b.vinculo.cliente_conta_id) === String(conta.id));
    if (!base && conta?.baseVinculada?.id != null) base = tirar((b) => String(b.id) === String(conta.baseVinculada.id));
    if (!base && !marketplaceTemConta(mp)) base = tirar((b) => getBaseMarketplaceKey(b) === mp && !b?.vinculo?.cliente_conta_id);
    return { mp, conta, base };
  });
  restantes.forEach((b) => cartoes.push({ mp: getBaseMarketplaceKey(b), conta: null, base: b }));
  cartoes.sort((a, b) => (MP_ORDEM[a.mp] ?? 9) - (MP_ORDEM[b.mp] ?? 9));
  const semBase = cartoes.filter((c) => c.conta && !c.base).length;
  const desatualizadas = cartoes.filter((c) => c.base && isBaseDesatualizada(c.base)).length;
  return {
    ...cli,
    cartoes,
    semBase,
    desatualizadas,
    pendencia: !!cli.semCliente || semBase > 0 || desatualizadas > 0,
  };
}

function montarCarteira() {
  const clientes = new Map();
  const chave = (id) => `c:${id}`;
  (Array.isArray(PORTFOLIO) ? PORTFOLIO : []).forEach((c) => {
    clientes.set(chave(c.id), {
      key: chave(c.id),
      id: c.id,
      nome: c.nome || c.slug || "Cliente",
      slug: c.slug || "",
      squad: c.squad?.nome || null,
      contas: (Array.isArray(c.contas) ? c.contas : []).filter((ct) => ct && ct.ativo !== false),
      bases: [],
    });
  });
  const semCliente = { key: CHAVE_SEM_CLIENTE, id: null, nome: "Bases sem cliente", slug: "", semCliente: true, squad: null, contas: [], bases: [] };
  (Array.isArray(TODAS_BASES) ? TODAS_BASES : []).forEach((b) => {
    const cid = b?.vinculo?.cliente_id;
    if (cid == null) { semCliente.bases.push(b); return; }
    const k = chave(cid);
    if (!clientes.has(k)) {
      clientes.set(k, {
        key: k,
        id: cid,
        nome: b.vinculo.cliente_nome || b.vinculo.cliente_slug || "Cliente",
        slug: b.vinculo.cliente_slug || "",
        squad: null,
        contas: [],
        bases: [],
      });
    }
    clientes.get(k).bases.push(b);
  });
  const lista = [...clientes.values()]
    .filter((c) => c.bases.length || c.contas.length)
    .map(montarCartoesCliente)
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  // Por último: é fila de pendência do admin, não um cliente.
  if (semCliente.bases.length) lista.push(montarCartoesCliente(semCliente));
  return lista;
}

function clientePassaBusca(cli, termo) {
  if (!termo) return true;
  const partes = [cli.nome, cli.slug];
  cli.cartoes.forEach(({ conta, base }) => {
    if (conta) partes.push(conta.nome, conta.external_account_id, conta.externalAccountLabel);
    if (base) partes.push(base.nome, base.slug, getClienteTexto(base));
  });
  return partes.filter(Boolean).join(" ").toLowerCase().includes(termo);
}

function renderListaClientes() {
  const el = document.getElementById("bases-clientes-lista");
  if (!el) return [];
  const termo = String(BASES_BUSCA || "").toLowerCase().trim();
  const nTodos = document.getElementById("bases-n-todos");
  const nPend = document.getElementById("bases-n-pendencia");
  if (nTodos) nTodos.textContent = String(CARTEIRA.length);
  if (nPend) nPend.textContent = String(CARTEIRA.filter((c) => c.pendencia).length);
  document.querySelectorAll("[data-cli-filtro]").forEach((b) => {
    b.setAttribute("aria-pressed", String((b.dataset.cliFiltro || "") === BASES_FILTRO_CLI));
  });

  const visiveis = CARTEIRA.filter((c) => clientePassaBusca(c, termo) && (!BASES_FILTRO_CLI || c.pendencia));
  if (!visiveis.some((c) => c.key === CLI_SEL)) CLI_SEL = visiveis[0]?.key || null;

  if (!visiveis.length) {
    el.innerHTML = `<p class="vf-bases-clientes__vazio">Nenhum cliente para essa busca.</p>`;
    return visiveis;
  }
  el.innerHTML = visiveis.map((c) => {
    const mps = [...new Set(c.cartoes.map((x) => x.mp))].sort((a, b) => (MP_ORDEM[a] ?? 9) - (MP_ORDEM[b] ?? 9));
    const nBases = c.cartoes.filter((x) => x.base).length;
    const alertas = [];
    if (c.semBase) alertas.push(`${c.semBase} ${c.semBase > 1 ? "contas" : "conta"} sem base`);
    if (c.desatualizadas) alertas.push(`${c.desatualizadas} desatualizada${c.desatualizadas > 1 ? "s" : ""}`);
    const sel = c.key === CLI_SEL;
    return `<button type="button" class="vf-bases-cli${c.semCliente ? " is-sem-cliente" : ""}" role="option" aria-selected="${sel}" tabindex="${sel ? 0 : -1}" data-cli-key="${escapeHTML(c.key)}">
      ${avatarCliente(c)}
      <span class="vf-bases-cli__txt">
        <span class="vf-bases-cli__nome">${escapeHTML(c.nome)}</span>
        <span class="vf-bases-cli__meta">${mps.map((m) => logoMarketplace(m, "xs")).join("")}<span>${nBases} ${nBases === 1 ? "base" : "bases"}</span></span>
      </span>
      ${c.pendencia ? `<span class="vf-bases-cli__alerta" title="${escapeHTML(alertas.join(" · ") || "Bases sem cliente vinculado")}"><span class="vf-visually-hidden">Precisa de atenção</span></span>` : ""}
    </button>`;
  }).join("");
  return visiveis;
}

function cartaoContaHtml(cli, { mp, conta, base }) {
  const idConta = conta?.external_account_id ? ` · ID ${escapeHTML(String(conta.external_account_id))}` : "";
  if (!base) {
    return `<div class="vf-bases-conta is-vazia">
      <div class="vf-bases-conta__h">${logoMarketplace(mp)}
        <div class="vf-bases-conta__id"><b>${escapeHTML(conta.nome || "Conta")}</b><span>${escapeHTML(marketplaceLabel(mp))}${idConta}</span></div>
      </div>
      <p class="vf-bases-conta__aviso">Conta conectada sem base de custo. A margem dos anúncios desta conta não é calculada.</p>
      <div><button type="button" class="vf-btn vf-btn--sm vf-btn--primary" data-import-mp="${escapeHTML(mp)}" data-import-cliente="${escapeHTML(String(cli.id ?? ""))}" data-import-conta="${escapeHTML(String(conta.id ?? ""))}">Importar planilha</button></div>
    </div>`;
  }
  const v = base.vinculo || null;
  let titulo, sub;
  if (conta) {
    titulo = conta.nome || v?.conta_nome || base.nome;
    sub = `${escapeHTML(marketplaceLabel(mp))}${idConta}`;
  } else if (v?.cliente_conta_id && v?.conta_nome) {
    titulo = v.conta_nome;
    sub = `${escapeHTML(marketplaceLabel(mp))}${v.external_account_id ? ` · ID ${escapeHTML(String(v.external_account_id))}` : ""}`;
  } else if (cli.semCliente || !marketplaceTemConta(mp)) {
    titulo = base.nome || base.slug;
    sub = escapeHTML(marketplaceLabel(mp));
  } else {
    titulo = base.nome || base.slug;
    sub = `${escapeHTML(marketplaceLabel(mp))} · <span class="is-warning">conta não definida</span>`;
  }
  const sel = String(base.slug) === String(BASE_SEL);
  const inativa = base.ativo === false ? `<span class="vf-tag">Inativa</span>` : "";
  const total = getTotalItensBase(base);
  const itensTxt = total == null ? "" : ` · ${fmtInt(total)} ${total === 1 ? "item" : "itens"}`;
  return `<div class="vf-bases-conta${sel ? " is-selected" : ""}">
    <div class="vf-bases-conta__h">${logoMarketplace(mp)}
      <div class="vf-bases-conta__id">
        <button type="button" class="vf-bases-conta__abrir" data-base-slug="${escapeHTML(base.slug || "")}" aria-pressed="${sel}">${escapeHTML(titulo)}</button>
        <span>${sub}</span>
      </div>
      ${renderMenuBase(base)}
    </div>
    ${temCoberturaAnuncios(cli, { mp, conta, base }) ? coberturaAnunciosHtml(cli, conta) : ""}
    <div class="vf-bases-conta__rodape"><span class="vf-bases-conta__base" title="Nome da base">${escapeHTML(base.nome || base.slug || "—")}${itensTxt}</span>${inativa}${statusIdadeHtml(base)}</div>
  </div>`;
}

// ─── Cobertura de custo dos anúncios (Mercado Livre) ───
// MLBs sincronizados da conta × MLBs com custo na base que o Motor usa para
// ela. Vem de GET /anuncios-meli/resumo (total + semCusto): os mesmos números
// do card "Sem custo" de Anúncios ML, então as duas telas sempre batem.
// Shopee e TikTok não têm anúncios sincronizados no VenForce — sem barra.
const COBERTURA_ANUNCIOS = new Map(); // "<clienteSlug>|<contaId>" → { estado, total, semCusto, motivo }

function chaveCobertura(cli, conta) {
  return `${cli.slug}|${conta.id}`;
}

function temCoberturaAnuncios(cli, { mp, conta, base }) {
  return mp === "meli" && !!conta && !!base && !!cli.slug;
}

// Arredonda para baixo enquanto faltar anúncio: 99,6% nunca vira 100%.
function barraCoberturaHtml(com, total, rotulo) {
  const pct = total ? com / total : 0;
  const pctTxt = `${com < total ? Math.floor(pct * 100) : 100}%`;
  const cls = pct >= 1 ? "is-ok" : pct >= 0.9 ? "is-warning" : "is-danger";
  return `<div class="vf-bases-cov__topo"><b>${pctTxt}</b><span>${fmtInt(com)} de ${fmtInt(total)} ${rotulo}</span></div>
    <div class="vf-bases-cov__barra"><i class="${cls}" style="width:${(pct * 100).toFixed(1)}%"></i></div>`;
}

function coberturaAnunciosHtml(cli, conta) {
  const chave = escapeHTML(chaveCobertura(cli, conta));
  const c = COBERTURA_ANUNCIOS.get(chaveCobertura(cli, conta));
  const vazio = (msg) => `<div class="vf-bases-cov is-vazio" data-cov-chave="${chave}"><span>${escapeHTML(msg)}</span></div>`;
  if (!c || c.estado === "carregando") return vazio("Cruzando com os anúncios da conta…");
  if (c.estado === "erro") return vazio("Não foi possível ler os anúncios desta conta.");
  if (c.semCusto == null) return vazio(c.motivo || "A base desta conta não foi resolvida.");
  if (!c.total) return vazio("Nenhum anúncio sincronizado nesta conta.");
  const com = Math.max(0, c.total - c.semCusto);
  const link = `anuncios-meli.html?cliente=${encodeURIComponent(cli.slug)}&conta=${encodeURIComponent(String(conta.id))}`;
  const falta = c.semCusto
    ? `<a class="vf-bases-cov__link" href="${escapeHTML(link)}">${fmtInt(c.semCusto)} sem custo · ver em Anúncios ML</a>`
    : "";
  return `<div class="vf-bases-cov" data-cov-chave="${chave}" title="Anúncios (MLB) da conta com custo na base">
    ${barraCoberturaHtml(com, c.total, "anúncios com custo")}
    ${falta}
  </div>`;
}

// Soma das contas Mercado Livre do cliente já lidas, para o cabeçalho.
function coberturaClienteHtml(cli) {
  let total = 0, semCusto = 0, lidas = 0;
  cli.cartoes.filter((c) => temCoberturaAnuncios(cli, c)).forEach(({ conta }) => {
    const c = COBERTURA_ANUNCIOS.get(chaveCobertura(cli, conta));
    if (!c || c.estado !== "ok" || c.semCusto == null || !c.total) return;
    lidas += 1;
    total += c.total;
    semCusto += c.semCusto;
  });
  if (!lidas) return "";
  return `<div class="vf-bases-cov" title="Anúncios Mercado Livre do cliente com custo na base">
    ${barraCoberturaHtml(Math.max(0, total - semCusto), total, "anúncios ML com custo")}
  </div>`;
}

function atualizarCoberturaNaTela(cli) {
  if (CLI_SEL !== cli.key) return;
  cli.cartoes.filter((c) => temCoberturaAnuncios(cli, c)).forEach(({ conta }) => {
    const sel = `[data-cov-chave="${CSS.escape(chaveCobertura(cli, conta))}"]`;
    const el = document.querySelector(`#bases-contas ${sel}`);
    if (el) el.outerHTML = coberturaAnunciosHtml(cli, conta);
  });
  const head = document.getElementById("bases-painel-cov");
  if (head) head.innerHTML = coberturaClienteHtml(cli);
}

async function carregarCoberturaAnuncios(cli) {
  const alvos = cli.cartoes.filter((c) => temCoberturaAnuncios(cli, c) && !COBERTURA_ANUNCIOS.has(chaveCobertura(cli, c.conta)));
  if (!alvos.length || !TOKEN) return;
  alvos.forEach(({ conta }) => COBERTURA_ANUNCIOS.set(chaveCobertura(cli, conta), { estado: "carregando" }));
  await Promise.all(alvos.map(async ({ conta }) => {
    const chave = chaveCobertura(cli, conta);
    try {
      const qs = `clienteSlug=${encodeURIComponent(cli.slug)}&clienteContaId=${encodeURIComponent(String(conta.id))}`;
      const res = await fetch(`${API_BASE}/anuncios-meli/resumo?${qs}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
      if (res.status === 401) { clearSession(); return; }
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false || !data.resumo) throw new Error(data.motivo || `HTTP ${res.status}`);
      const r = data.resumo;
      COBERTURA_ANUNCIOS.set(chave, {
        estado: "ok",
        total: Number(r.total) || 0,
        semCusto: r.semCusto == null ? null : Number(r.semCusto),
        motivo: r.semCustoMotivo || null,
      });
    } catch (err) {
      COBERTURA_ANUNCIOS.set(chave, { estado: "erro" });
    }
  }));
  atualizarCoberturaNaTela(cli);
}

function renderPainelCliente() {
  const head = document.getElementById("bases-painel-head");
  const contasEl = document.getElementById("bases-contas");
  const itens = document.getElementById("bases-drawer");
  if (!head || !contasEl) return;
  const cli = CARTEIRA.find((c) => c.key === CLI_SEL);
  if (!cli) {
    head.innerHTML = "";
    contasEl.innerHTML = `<p class="vf-bases-clientes__vazio">Escolha um cliente na lista.</p>`;
    if (itens) itens.hidden = true;
    DRAWER_SLUG = "";
    return;
  }

  const bases = cli.cartoes.filter((c) => c.base).map((c) => c.base);
  const partes = [];
  if (cli.squad) partes.push(escapeHTML(cli.squad));
  partes.push(`${bases.length} ${bases.length === 1 ? "base" : "bases"}`);
  if (cli.semBase) partes.push(`<span class="is-warning">${cli.semBase} ${cli.semBase > 1 ? "contas" : "conta"} sem base</span>`);
  else if (cli.contas.length) partes.push("todas as contas com base");
  const descricao = cli.semCliente
    ? (VINCULOS_EDITAVEIS
        ? "Bases que ainda não estão ligadas a um cliente. Use ⋯ → Definir cliente/vínculo."
        : "Bases que ainda não estão ligadas a um cliente. Peça a um admin para vincular.")
    : partes.join(" · ");
  head.innerHTML = `
    <div class="vf-bases-painel__id">${avatarCliente(cli, true)}
      <div><h2 class="vf-bases-painel__titulo" id="bases-painel-titulo">${escapeHTML(cli.nome)}</h2><p class="vf-bases-painel__desc">${descricao}</p></div>
    </div>
    <div class="vf-bases-painel__cov" id="bases-painel-cov">${coberturaClienteHtml(cli)}</div>`;

  if (!bases.some((b) => String(b.slug) === String(BASE_SEL))) BASE_SEL = bases[0]?.slug || null;
  contasEl.innerHTML = cli.cartoes.length
    ? cli.cartoes.map((c) => cartaoContaHtml(cli, c)).join("")
    : `<p class="vf-bases-clientes__vazio">Este cliente ainda não tem conta conectada nem base.</p>`;
  bindBaseRowActions(contasEl);
  carregarCoberturaAnuncios(cli);

  if (!BASE_SEL) {
    if (itens) itens.hidden = true;
    DRAWER_SLUG = "";
    return;
  }
  if (String(DRAWER_SLUG) !== String(BASE_SEL) || (itens && itens.hidden)) {
    const base = bases.find((b) => String(b.slug) === String(BASE_SEL));
    abrirDrawerCustos(BASE_SEL, getBaseMarketplaceKey(base));
  }
}

// ?cliente=<slug> abre direto no cliente (links de outras telas) e a URL
// acompanha a escolha, para recarregar no mesmo lugar.
function lerClienteDaUrl() {
  try {
    const slug = new URLSearchParams(location.search).get("cliente");
    if (!slug) return;
    const cli = CARTEIRA.find((c) => c.slug && c.slug === slug);
    if (cli) CLI_SEL = cli.key;
  } catch (err) { /* URL inválida: segue no primeiro cliente */ }
}

function gravarClienteNaUrl() {
  try {
    const cli = CARTEIRA.find((c) => c.key === CLI_SEL);
    const url = new URL(location.href);
    if (cli?.slug) url.searchParams.set("cliente", cli.slug);
    else url.searchParams.delete("cliente");
    history.replaceState(null, "", url);
  } catch (err) { /* sem history: ignora */ }
}

function selecionarCliente(key) {
  if (!key || key === CLI_SEL) return;
  CLI_SEL = key;
  BASE_SEL = null;
  gravarClienteNaUrl();
  renderBasesTela();
}

function renderBasesTela() {
  if (!(Array.isArray(TODAS_BASES) && TODAS_BASES.length) && !PORTFOLIO.length) {
    showEmpty();
    return;
  }
  CARTEIRA = montarCarteira();
  renderListaClientes();
  renderPainelCliente();
  showSections();
}

async function loadBases() {
  if (!TOKEN) return;
  if (!BASES_CARREGADAS) showLoading();
  // Custo salvo/importado muda a cobertura: relê os anúncios do cliente aberto.
  COBERTURA_ANUNCIOS.clear();

  let basesPrincipais = [];
  try {
    const [bases] = await Promise.all([carregarBasesPrincipais(), carregarPortfolio(), carregarImagensClientes()]);
    if (!bases) return;
    basesPrincipais = bases;
  } catch (err) {
    showError("Não foi possível carregar as bases. Tente novamente.");
    return;
  }

  // O cliente de cada base vem dos vínculos: sem eles a tela agruparia tudo
  // em "Bases sem cliente". Por isso desenha uma vez só, depois dos vínculos.
  TODAS_BASES = basesPrincipais;
  try {
    const basesComVinculos = await carregarVinculosComplementares();
    if (!basesComVinculos) return;
    TODAS_BASES = aplicarVinculosNasBases(basesPrincipais, basesComVinculos);
    if (VINCULOS_AVISO_ATIVO) {
      setDashboardFeedback("");
      VINCULOS_AVISO_ATIVO = false;
    }
    carregarClientesParaVinculos(true);
  } catch (err) {
    VINCULOS_AVISO_ATIVO = true;
    setDashboardFeedback("Vínculos indisponíveis no momento. As bases aparecem em “Bases sem cliente” até recarregar.", "neutral");
  }
  if (!BASES_CARREGADAS) {
    CARTEIRA = montarCarteira();
    lerClienteDaUrl();
  }
  BASES_CARREGADAS = true;
  renderBasesTela();
}

// ─── Status de atualização (idade + alerta) ───
const B_EDIT_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
// Lápis compacto para editar item dentro do drawer de custos
const B_EDIT_SM_SVG = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;

// ─── Menu "⋯" de ações secundárias ───
function renderMenuBase(base) {
  const id = escapeHTML(String(base.id || ""));
  const slug = escapeHTML(base.slug || "");
  const nome = escapeHTML(base.nome || base.slug || "");
  const vinculoItens = VINCULOS_EDITAVEIS ? `
    <button class="vf-menu__item vf-btn-vincular-base" data-base-id="${id}">${base.vinculo ? "Alterar cliente/vínculo" : "Definir cliente/vínculo"}</button>
    ${base.vinculo ? `<button class="vf-menu__item vf-btn-remover-vinculo" data-base-id="${id}">Remover vínculo</button>` : ""}
  ` : "";
  // Desativar é a ação operacional comum (preserva custos/histórico); hard
  // delete fica só para admin, com preflight de dependências no backend —
  // achado P0 da auditoria (delete físico sem guard rail).
  const desativarItem = base.ativo !== false
    ? `<button class="vf-menu__item btn-desativar-base" data-slug="${slug}" data-nome="${nome}">Desativar base</button>`
    : "";
  const excluirItem = IS_ADMIN
    ? `<button class="vf-menu__item is-danger btn-excluir-base" data-slug="${slug}" data-nome="${nome}">Excluir base (permanente)</button>`
    : "";
  return `
    <div class="b-menu">
      <button type="button" class="vf-btn vf-btn--ghost vf-btn--icon vf-btn--sm b-menu-trigger" aria-haspopup="true" aria-expanded="false" title="Mais ações" aria-label="Mais ações">⋯</button>
      <div class="b-menu-pop vf-menu">
        ${vinculoItens}
        <button class="vf-menu__item asst-btn-baixar-base" data-slug="${slug}" data-nome="${nome}">Baixar CSV</button>
        ${desativarItem}
        ${excluirItem}
      </div>
    </div>`;
}

// ─── Menu dropdown "⋯" (ações secundárias) ───
function fecharTodosMenus() {
  document.querySelectorAll(".vf-page-bases .b-menu-pop.is-open").forEach((p) => p.classList.remove("is-open"));
  document.querySelectorAll(".vf-page-bases .b-menu-trigger[aria-expanded='true']").forEach((t) => t.setAttribute("aria-expanded", "false"));
}
function togglePop(trigger, popSelector) {
  const pop = trigger.parentElement.querySelector(popSelector);
  if (!pop) return;
  const aberto = pop.classList.contains("is-open");
  fecharTodosMenus();
  if (!aberto) { pop.classList.add("is-open"); trigger.setAttribute("aria-expanded", "true"); }
}
function toggleRowMenu(trigger) { togglePop(trigger, ".b-menu-pop"); }

function bindBaseRowActions(tbody) {
  tbody.querySelectorAll(".asst-btn-baixar-base").forEach(btn => {
    btn.addEventListener("click", () => { const { slug, nome } = btn.dataset; asstBaixarBase(slug, nome, btn); });
  });
  tbody.querySelectorAll(".btn-excluir-base").forEach(btn => {
    btn.addEventListener("click", () => { const { slug, nome } = btn.dataset; abrirModalExcluirBase({ slug, nome, btn }); });
  });
  tbody.querySelectorAll(".btn-desativar-base").forEach(btn => {
    btn.addEventListener("click", () => { const { slug, nome } = btn.dataset; desativarBase(slug, nome, btn); });
  });
  tbody.querySelectorAll(".vf-btn-vincular-base").forEach(btn => {
    btn.addEventListener("click", () => abrirModalVinculo(btn.dataset.baseId));
  });
  tbody.querySelectorAll(".vf-btn-remover-vinculo").forEach(btn => {
    btn.addEventListener("click", () => removerVinculoBase(btn.dataset.baseId, btn));
  });
  tbody.querySelectorAll(".b-menu-trigger").forEach(btn => {
    btn.addEventListener("click", (e) => { e.stopPropagation(); toggleRowMenu(btn); });
  });
  tbody.querySelectorAll(".vf-menu__item").forEach(item => {
    item.addEventListener("click", () => fecharTodosMenus());
  });
}

async function deleteBase(slug, btn) {
  btn.disabled = true;
  btn.textContent = "Excluindo…";
  try {
    const res  = await fetch(`${API_BASE}/bases/${encodeURIComponent(slug)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${TOKEN}` }
    });
    if (res.status === 401) { clearSession(); return; }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // 409 estruturado (BASE_HAS_DEPENDENCIES): explica por que não pode
      // apagar, em vez de deixar o FK estourar em erro cru — achado P0 da
      // auditoria.
      const err = new Error(data.erro || `HTTP ${res.status}`);
      err.dependencies = Array.isArray(data.dependencies) ? data.dependencies : null;
      throw err;
    }
    setDashboardFeedback(`Base "${slug}" excluída com sucesso.`, "success");
    loadBases();
    return true;
  } catch (err) {
    if (!err.dependencies) setDashboardFeedback("Erro ao excluir: " + err.message, "danger");
    btn.disabled    = false;
    btn.textContent = "Excluir";
    throw err;
  }
}

// Ação operacional comum (preserva custos/histórico) — reaproveita
// POST /bases/:slug/desabilitar, que já existia mas não estava exposto na
// tela. Substitui o hard delete como caminho padrão (achado P0/decisão 7).
async function desativarBase(slug, nome, btn) {
  const confirmou = await vfConfirmar({
    title: `Desativar a base "${nome || slug}"?`,
    message: "Ela deixa de aparecer como ativa. Custos e histórico são preservados.",
    confirmLabel: "Desativar base",
  });
  if (!confirmou) return;
  const textoOriginal = btn ? btn.textContent : "";
  if (btn) { btn.disabled = true; btn.textContent = "Desativando…"; }
  try {
    const res = await fetch(`${API_BASE}/bases/${encodeURIComponent(slug)}/desabilitar`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    if (res.status === 401) { clearSession(); return; }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.erro || `HTTP ${res.status}`);
    setDashboardFeedback(`Base "${nome || slug}" desativada com sucesso.`, "success");
    await loadBases();
  } catch (err) {
    setDashboardFeedback("Erro ao desativar: " + (err.message || "tente novamente."), "danger");
    if (btn) { btn.disabled = false; btn.textContent = textoOriginal; }
  }
}

function getBasePorId(baseId) {
  const id = String(baseId || "");
  return (Array.isArray(TODAS_BASES) ? TODAS_BASES : []).find((b) => String(b.id) === id) || null;
}

function setVinculoModalDanger(msg) {
  const el = document.getElementById("vf-vinculo-base-danger");
  if (!el) return;
  el.textContent = msg || "";
  el.style.display = msg ? "block" : "none";
}

function setVinculoModalLoading(on) {
  const save = document.getElementById("vf-vinculo-base-save");
  const cliente = document.getElementById("vf-vinculo-cliente");
  const conta = document.getElementById("vf-vinculo-conta");
  if (save) {
    save.disabled = on || !VINCULOS_EDITAVEIS;
    save.textContent = on ? "Salvando..." : "Salvar vínculo";
  }
  if (cliente) cliente.disabled = on || !VINCULOS_EDITAVEIS;
  if (conta) conta.disabled = on || !VINCULOS_EDITAVEIS;
}

function renderClientesOptions(clienteIdSelecionado) {
  const select = document.getElementById("vf-vinculo-cliente");
  if (!select) return;
  const selected = String(clienteIdSelecionado || "");
  const clientes = Array.isArray(CLIENTES_DISPONIVEIS) ? CLIENTES_DISPONIVEIS : [];
  if (!clientes.length) {
    select.innerHTML = `<option value="">Nenhum cliente disponível</option>`;
    return;
  }
  select.innerHTML = `<option value="">Selecione um cliente...</option>` + clientes.map((c) => {
    const id = String(c.id || "");
    const nome = c.nome || c.slug || "Cliente";
    const slug = c.slug ? ` (${c.slug})` : "";
    const sel = id === selected ? " selected" : "";
    return `<option value="${escapeHTML(id)}"${sel}>${escapeHTML(nome + slug)}</option>`;
  }).join("");
}

function setModalPermissaoVisivel(visivel) {
  const msg = document.getElementById("vf-vinculo-base-permissao");
  if (!msg) return;
  msg.textContent = visivel ? "Não foi possível carregar os dados de vínculo de bases." : "";
  msg.style.display = visivel ? "block" : "none";
}

function renderSugestaoModal(base) {
  const el = document.getElementById("vf-vinculo-base-sugestao");
  if (!el) return;
  const s = base?.sugestao;
  if (!s || base?.vinculo) {
    el.style.display = "none";
    el.textContent = "";
    return;
  }
  el.classList.add("show");
  el.style.display = "flex";
  el.textContent = `Sugestão: ${s.cliente_nome || s.cliente_slug || "cliente sugerido"} — confirmar para tornar oficial (${marketplaceLabel(s.marketplace)}).`;
}

// Recarrega o picker de conta do modal de vínculo (marketplace é sempre o
// da BASE — nunca editável aqui, ver abrirModalVinculo).
async function popularContasVinculo(marketplaceBase, clienteIdSelecionado) {
  const contaField = document.getElementById("vf-vinculo-conta-field");
  const contaSel = document.getElementById("vf-vinculo-conta");
  const contaHint = document.getElementById("vf-vinculo-conta-hint");
  const contaReq = document.getElementById("vf-vinculo-conta-req");
  if (!contaField || !contaSel) return;

  if (!marketplaceTemConta(marketplaceBase) || !clienteIdSelecionado) {
    contaField.style.display = "none";
    contaSel.innerHTML = "";
    return;
  }

  contaField.style.display = "";
  contaSel.innerHTML = `<option value="">Carregando contas…</option>`;
  const contas = await carregarContasCliente(clienteIdSelecionado, marketplaceBase);
  CONTAS_CLIENTE_ATUAL = contas;
  popularContaOptions(contaSel, contas, "Selecione a conta…");

  const contaAtualId = VINCULO_BASE_ATUAL?.vinculo?.cliente_conta_id;
  if (contaAtualId && contas.some((c) => String(c.id) === String(contaAtualId))) {
    contaSel.value = String(contaAtualId);
  } else if (contas.length === 1) {
    contaSel.value = String(contas[0].id);
  }

  // Mercado Livre: conta explícita é obrigatória (nunca escolhida sozinha).
  // Shopee: preserva compatibilidade — sem conta cadastrada, o legado
  // (cliente_id + marketplace) ainda resolve no backend.
  const obrigatoria = marketplaceBase === "meli" && contas.length > 0;
  if (contaReq) contaReq.style.display = obrigatoria ? "" : "none";
  if (contaHint) {
    contaHint.textContent = !contas.length
      ? "Nenhuma conta cadastrada para este cliente/marketplace ainda — cadastre em /clientes."
      : marketplaceBase === "meli"
        ? "Obrigatório — nunca escolhida sozinha entre duas contas do mesmo cliente."
        : "Se o cliente tiver mais de uma conta Shopee, escolha explicitamente.";
  }
}

async function abrirModalVinculo(baseId) {
  const base = getBasePorId(baseId);
  if (!base) return;

  const modal = document.getElementById("vf-vinculo-base-modal");
  const title = document.getElementById("vf-vinculo-base-title");
  const sub = document.getElementById("vf-vinculo-base-subtitle");
  const contexto = document.getElementById("vf-vinculo-marketplace-contexto");
  if (!modal) return;

  VINCULO_BASE_ATUAL = base;
  setVinculoModalDanger("");
  setModalPermissaoVisivel(false);
  renderSugestaoModal(base);

  // Marketplace é sempre o da BASE (bases.marketplace) — nunca uma escolha
  // manual aqui. Base ML só pode listar contas ML; base Shopee só Shopee.
  const marketplaceBase = getBaseMarketplaceKey(base);
  if (title) title.textContent = base.vinculo ? "Alterar vínculo" : "Vincular base";
  if (sub) sub.textContent = `${base.nome || base.slug || "Base"} (${base.slug || "sem slug"})`;
  if (contexto) contexto.textContent = `Marketplace: ${marketplaceLabel(marketplaceBase)} (definido pela base, não é editável aqui).`;

  await carregarClientesParaVinculos(false);

  const clienteSugerido = base.vinculo?.cliente_id || base.sugestao?.cliente_id || "";
  renderClientesOptions(clienteSugerido);
  await popularContasVinculo(marketplaceBase, clienteSugerido);

  setModalPermissaoVisivel(!VINCULOS_EDITAVEIS);
  setVinculoModalLoading(false);
  modal.style.removeProperty("display");
  modal.classList.add("is-open");
}

function fecharModalVinculo() {
  const modal = document.getElementById("vf-vinculo-base-modal");
  if (modal) {
    modal.classList.remove("is-open");
    modal.style.removeProperty("display");
  }
  VINCULO_BASE_ATUAL = null;
  setVinculoModalDanger("");
}

document.getElementById("vf-vinculo-cliente")?.addEventListener("change", (e) => {
  if (!VINCULO_BASE_ATUAL) return;
  popularContasVinculo(getBaseMarketplaceKey(VINCULO_BASE_ATUAL), e.target.value);
});

async function salvarVinculoBase() {
  if (!VINCULO_BASE_ATUAL || !VINCULOS_EDITAVEIS) return;
  const clienteId = (document.getElementById("vf-vinculo-cliente") || {}).value || "";
  const contaId = (document.getElementById("vf-vinculo-conta") || {}).value || "";
  // Marketplace é sempre o da base — nunca vem de um select editável.
  const marketplace = getBaseMarketplaceKey(VINCULO_BASE_ATUAL);
  if (!clienteId) {
    setVinculoModalDanger("Selecione um cliente.");
    return;
  }
  if (marketplace === "meli" && Array.isArray(CONTAS_CLIENTE_ATUAL) && CONTAS_CLIENTE_ATUAL.length > 0 && !contaId) {
    setVinculoModalDanger("Selecione a conta Mercado Livre — nunca escolhida sozinha entre duas contas do mesmo cliente.");
    return;
  }

  setVinculoModalLoading(true);
  setVinculoModalDanger("");
  try {
    const payload = { base_id: VINCULO_BASE_ATUAL.id };
    if (contaId) {
      payload.cliente_conta_id = Number(contaId);
    } else {
      payload.cliente_id = Number(clienteId);
      payload.marketplace = marketplace;
    }
    const res = await fetch(`${API_BASE}/base-vinculos`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (res.status === 401) { clearSession(); return; }
    const data = await res.json().catch(() => ({}));
    if (res.status === 403) throw new Error("Não foi possível salvar o vínculo desta base.");
    if (!res.ok) throw new Error(mensagemErroImportacao(data) || `HTTP ${res.status}`);

    fecharModalVinculo();
    setDashboardFeedback("Vínculo salvo com sucesso.", "success");
    await loadBases();
  } catch (err) {
    setVinculoModalDanger(err.message || "Não foi possível salvar o vínculo.");
  } finally {
    setVinculoModalLoading(false);
  }
}

async function removerVinculoBase(baseId, btn) {
  const base = getBasePorId(baseId);
  if (!base || !base.vinculo) return;
  const confirmou = await vfConfirmar({
    title: `Remover o vínculo oficial da base "${base.nome || base.slug}"?`,
    confirmLabel: "Remover vínculo",
    tone: "danger",
  });
  if (!confirmou) return;

  const textoOriginal = btn ? btn.textContent : "";
  if (btn) { btn.disabled = true; btn.textContent = "Removendo..."; }
  try {
    const res = await fetch(`${API_BASE}/base-vinculos/${encodeURIComponent(base.id)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    if (res.status === 401) { clearSession(); return; }
    const data = await res.json().catch(() => ({}));
    if (res.status === 403) throw new Error("Não foi possível remover o vínculo desta base.");
    if (!res.ok) throw new Error(data.erro || `HTTP ${res.status}`);
    setDashboardFeedback("Vínculo removido com sucesso.", "success");
    await loadBases();
  } catch (err) {
    setDashboardFeedback("Erro ao remover vínculo: " + (err.message || "tente novamente."), "danger");
    if (btn) { btn.disabled = false; btn.textContent = textoOriginal; }
  }
}

// ─── File input label ───
document.getElementById("import-arquivo").addEventListener("change", (e) => {
  const f = e.target.files?.[0];
  document.getElementById("file-label-text").textContent = f ? f.name : "Escolher arquivo…";
  document.getElementById("file-label").classList.toggle("has-file", !!f);
});

// ══════════════════════════════════════════════════════════════════════════════
// ─── MODAL "IMPORTAR NOVA BASE" ────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════
// opts.clienteId / opts.contaId: atalho do cartão "conta sem base" — já
// chega com cliente e conta escolhidos (o usuário ainda vê e pode trocar).
function abrirModalImportar(mp, nomePrefill, opts = {}) {
  const backdrop = document.getElementById("bases-import-backdrop");
  if (!backdrop) return;
  const collapse = document.getElementById("bases-assist-collapse");
  if (collapse) collapse.classList.remove("is-open");
  setImportStatus("", "");
  if (mp) {
    const sel = document.getElementById("import-marketplace");
    if (sel) sel.value = mp;
  }
  if (nomePrefill != null && nomePrefill !== "") {
    const nomeEl = document.getElementById("import-nome");
    if (nomeEl) nomeEl.value = nomePrefill;
  }
  onImportMarketplaceChange();
  popularClientesImport().then(() => {
    const cliSel = document.getElementById("import-cliente");
    if (cliSel && opts.clienteId) cliSel.value = String(opts.clienteId);
    return popularContasImport();
  }).then(() => {
    const contaSel = document.getElementById("import-conta");
    if (contaSel && opts.contaId) contaSel.value = String(opts.contaId);
    atualizarBotaoImportarDisabled();
  });
  backdrop.classList.add("is-open");
}

function fecharModalImportar() {
  const backdrop = document.getElementById("bases-import-backdrop");
  if (backdrop) backdrop.classList.remove("is-open");
}

// Rótulo de conta com contexto operacional (nome + identidade externa +
// status do grant) — nunca token. "Mercado Livre 2 · ID: 123456789 · conectado".
function contaLabel(conta) {
  const partes = [conta?.nome || conta?.slug || "Conta"];
  if (conta?.external_account_id) partes.push(`ID: ${conta.external_account_id}`);
  if (conta?.grant) {
    partes.push(conta.grant.token_status === "valid" ? "conectado" : (conta.grant.token_status || "status desconhecido"));
  } else if (conta?.marketplace === "meli") {
    partes.push("aguardando conexão");
  }
  return partes.join(" · ");
}

function popularContaOptions(selectEl, contas, placeholder) {
  if (!selectEl) return;
  if (!Array.isArray(contas) || !contas.length) {
    selectEl.innerHTML = `<option value="">Nenhuma conta cadastrada para este cliente</option>`;
    return;
  }
  selectEl.innerHTML = `<option value="">${escapeHTML(placeholder || "Selecione a conta…")}</option>` +
    contas.map((c) => `<option value="${escapeHTML(String(c.id))}">${escapeHTML(contaLabel(c))}</option>`).join("");
}

function onImportMarketplaceChange() {
  const mp = getImportMarketplace();
  const field = document.getElementById("import-cliente-field");
  const req = document.getElementById("import-cliente-req");
  const hint = document.getElementById("import-cliente-hint");
  const label = document.getElementById("import-cliente-label");
  const desc = document.getElementById("bases-import-desc");
  const contaField = document.getElementById("import-conta-field");
  const contaReq = document.getElementById("import-conta-req");
  const contaHint = document.getElementById("import-conta-hint");
  const contaLabelEl = document.getElementById("import-conta-label");
  const contaSel = document.getElementById("import-conta");
  if (mp === "meli") {
    if (field) field.style.display = "";
    if (req) req.style.display = "";
    if (label) label.textContent = "Cliente";
    if (hint) hint.textContent = "Obrigatório para Mercado Livre.";
    if (desc) desc.textContent = "A base de Mercado Livre nasce vinculada à conta explícita escolhida abaixo.";
    if (contaField) contaField.style.display = "";
    if (contaReq) contaReq.style.display = "";
    if (contaLabelEl) contaLabelEl.textContent = "Conta Mercado Livre";
    if (contaHint) contaHint.textContent = "Obrigatório — nunca escolhida sozinha entre duas contas do mesmo cliente.";
  } else if (mp === "tiktok") {
    if (field) field.style.display = "";
    if (req) req.style.display = "none";
    if (label) label.textContent = "Cliente";
    if (hint) hint.textContent = "Opcional — a Base TikTok funciona de forma independente. Vincule depois pelo menu ⋯, se quiser.";
    if (desc) desc.textContent = "Base TikTok Shop: planilha com ID | ID DO SKU | CUSTO | IMPOSTO (o mesmo ID de produto repete — um ID DO SKU por variação).";
    if (contaField) contaField.style.display = "none";
    if (contaSel) contaSel.value = "";
  } else if (mp === "shopee") {
    if (field) field.style.display = "";
    if (req) req.style.display = "none";
    if (label) label.textContent = "Cliente";
    if (hint) hint.textContent = "Opcional para Shopee — pode ser criada sem cliente por enquanto.";
    if (desc) desc.textContent = "Base Shopee: informe o cliente e a conta, se já houver (opcional).";
    if (contaField) contaField.style.display = "";
    if (contaReq) contaReq.style.display = "none";
    if (contaLabelEl) contaLabelEl.textContent = "Conta Shopee";
    if (contaHint) contaHint.textContent = "Opcional — se o cliente tiver mais de uma conta Shopee, escolha explicitamente.";
  } else {
    if (field) field.style.display = "none";
    if (contaField) contaField.style.display = "none";
    if (desc) desc.textContent = "Envie uma planilha de custos. A pré-visualização aparece antes de confirmar.";
  }
  if (contaField && contaField.style.display === "none" && contaSel) contaSel.value = "";
  atualizarBotaoImportarDisabled();
}

async function popularClientesImport() {
  const sel = document.getElementById("import-cliente");
  if (!sel) return;
  await carregarClientesParaVinculos(true);
  const clientes = Array.isArray(CLIENTES_DISPONIVEIS) ? CLIENTES_DISPONIVEIS : [];
  const atual = sel.value;
  sel.innerHTML = `<option value="">Selecione o cliente…</option>` + clientes.map((c) => {
    const id = String(c.id || "");
    const nome = c.nome || c.slug || "Cliente";
    const slug = c.slug ? ` · ${c.slug}` : "";
    return `<option value="${escapeHTML(id)}">${escapeHTML(nome + slug)}</option>`;
  }).join("");
  if (atual) sel.value = atual;
  atualizarBotaoImportarDisabled();
}

// Recarrega o picker de conta do modal de importação sempre que cliente OU
// marketplace mudam — GET /clientes/:id/contas?marketplace=X (mesma rota
// account-aware que /clientes.html usa).
async function popularContasImport() {
  const contaSel = document.getElementById("import-conta");
  if (!contaSel) return;
  const mp = getImportMarketplace();
  const clienteId = (document.getElementById("import-cliente") || {}).value || "";
  if (!marketplaceTemConta(mp) || !clienteId) {
    popularContaOptions(contaSel, [], "Selecione o cliente primeiro…");
    atualizarBotaoImportarDisabled();
    return;
  }
  contaSel.innerHTML = `<option value="">Carregando contas…</option>`;
  const contas = await carregarContasCliente(clienteId, mp);
  popularContaOptions(contaSel, contas, "Selecione a conta…");
  // Só uma conta disponível: pré-seleciona, mas o usuário ainda vê e pode
  // trocar — não é uma escolha invisível do backend.
  if (contas.length === 1) contaSel.value = String(contas[0].id);
  atualizarBotaoImportarDisabled();
}

// ─── Marketplace / cliente: habilita "Pré-visualizar" e alterna campo cliente/conta ───
document.getElementById("import-marketplace")?.addEventListener("change", () => { onImportMarketplaceChange(); popularContasImport(); });
document.getElementById("import-cliente")?.addEventListener("change", () => { popularContasImport(); });
document.getElementById("import-conta")?.addEventListener("change", atualizarBotaoImportarDisabled);
onImportMarketplaceChange();

function validarArquivoImportacao(file) {
  const name = String(file?.name || "").toLowerCase();
  return name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".csv");
}

function setArquivoSelecionado(file) {
  const input = document.getElementById("import-arquivo");
  if (!input || !file) return;
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  document.getElementById("file-label-text").textContent = file.name;
  document.getElementById("file-label").classList.add("has-file");
}

// Drag & drop (1 arquivo) na dropzone
const dropLabel = document.getElementById("file-label");
if (dropLabel) {
  ["dragenter", "dragover"].forEach((evt) => {
    dropLabel.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropLabel.classList.add("is-dragging");
    });
  });
  ["dragleave", "drop"].forEach((evt) => {
    dropLabel.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropLabel.classList.remove("is-dragging");
    });
  });
  dropLabel.addEventListener("drop", (e) => {
    const files = Array.from(e.dataTransfer?.files || []);
    if (!files.length) return;
    const file = files[0];
    if (files.length > 1) {
      setImportStatus("Nesta versão, é permitido apenas 1 arquivo. Usando o primeiro.", "var(--vf-text-m)");
    }
    if (!validarArquivoImportacao(file)) {
      setImportStatus("Arquivo inválido. Envie .xlsx, .xls ou .csv.", "var(--vf-danger)");
      return;
    }
    setImportStatus("", "");
    setArquivoSelecionado(file);
  });
}

// ─── Preview ───
let pendingPreviewData = null; // guarda payload para confirmar depois

function openPreview(payload) {
  pendingPreviewData = payload;

  document.getElementById("preview-meta").textContent =
    `${payload.total} linhas · ${payload.idsDetectados} IDs válidos`;

  const mpPreview = normalizarMarketplaceKey(payload.marketplace);
  const isShopee = mpPreview === "shopee";
  const isTiktok = mpPreview === "tiktok";

  const thIdModel = document.getElementById("preview-th-idmodel");
  if (thIdModel) thIdModel.style.display = isShopee ? "" : "none";
  // TikTok: contrato ID | ID DO SKU | CUSTO | IMPOSTO — sem taxa fixa, sem
  // ID Model, sem SKU textual e sem nomes de produto/variação.
  const thId = document.getElementById("preview-th-id");
  if (thId) thId.textContent = isTiktok ? "ID" : "ID do Produto";
  const thSku = document.getElementById("preview-th-sku");
  if (thSku) thSku.style.display = isTiktok ? "" : "none";
  const thTaxa = document.getElementById("preview-th-taxa");
  if (thTaxa) thTaxa.style.display = isTiktok ? "none" : "";

  const tbody = document.getElementById("preview-tbody");
  tbody.innerHTML = "";
  (payload.preview || []).forEach(r => {
    const tr = document.createElement("tr");
    const idModelCell = isShopee
      ? `<td style="font-family:var(--vf-mono);font-size:.8rem;">${escapeHTML(String(r.id_model ?? "—"))}</td>`
      : "";
    const skuIdCell = isTiktok
      ? `<td style="font-family:var(--vf-mono);font-size:.8rem;">${escapeHTML(String(r.sku_id ?? "—"))}</td>`
      : "";
    const taxaCell = isTiktok ? "" : `<td style="text-align:right;">${r.taxa_fixa ?? 0}</td>`;
    tr.innerHTML = `
      <td style="font-family:var(--vf-mono);font-size:.8rem;">${escapeHTML(String(r.id ?? "") || "—")}</td>
      ${skuIdCell}
      ${idModelCell}
      <td style="text-align:right;">${r.custo_produto ?? 0}</td>
      <td style="text-align:right;">${r.imposto_percentual ?? 0}</td>
      ${taxaCell}`;
    tbody.appendChild(tr);
  });

  const overlay = document.getElementById("preview-overlay");
  overlay.style.display = "flex";
}

function closePreview() {
  document.getElementById("preview-overlay").style.display = "none";
  pendingPreviewData = null;
}

document.getElementById("preview-close").addEventListener("click",  closePreview);
document.getElementById("preview-cancel").addEventListener("click", closePreview);

// Fechar clicando fora do modal
document.getElementById("preview-overlay").addEventListener("click", (e) => {
  if (e.target === document.getElementById("preview-overlay")) closePreview();
});

// ─── Confirmar importação ───
// Mensagens específicas por código de erro estruturado do comando atômico
// de importação (server/services/bases/baseImportService.js). Sem isso a
// tela mostrava "sucesso" mesmo quando o vínculo falhava (achado P0 da
// auditoria) — agora a importação inteira falha/rollback e o erro é
// explícito.
function mensagemErroImportacao(data) {
  if (data?.code === "BASE_SLUG_ALREADY_EXISTS") {
    return "Já existe uma base com este nome/slug. Escolha outro nome ou use a atualização por planilha dentro da base existente.";
  }
  if (data?.code === "ML_ACCOUNT_REQUIRED") {
    return "Selecione a conta Mercado Livre explícita antes de importar.";
  }
  if (data?.code === "MULTIPLE_MARKETPLACE_ACCOUNTS") {
    return "Este cliente tem mais de uma conta para este marketplace. Selecione a conta explicitamente.";
  }
  if (data?.code === "BASE_MARKETPLACE_MISMATCH") {
    return "A conta selecionada é de outro marketplace. Verifique cliente/conta escolhidos.";
  }
  if (data?.code === "CONTA_INATIVA" || data?.code === "BASE_INATIVA") {
    return data.erro || "Conta ou base inativa não pode receber vínculo.";
  }
  return data?.erro || null;
}

document.getElementById("preview-confirm").addEventListener("click", async () => {
  const arquivo = document.getElementById("import-arquivo").files?.[0];
  const nome    = document.getElementById("import-nome").value.trim();
  const marketplace = getImportMarketplace();
  if (!arquivo || !nome || !marketplace) { closePreview(); return; }

  document.getElementById("preview-confirm").disabled                 = true;
  document.getElementById("preview-confirm-text").textContent        = "Importando…";
  document.getElementById("preview-confirm-spinner").style.display   = "inline-block";

  try {
    const clienteId = (document.getElementById("import-cliente") || {}).value || "";
    const contaId   = (document.getElementById("import-conta") || {}).value || "";

    const fd = new FormData();
    fd.append("arquivo", arquivo);
    fd.append("nomeBase", nome);
    fd.append("marketplace", marketplace);
    fd.append("confirmar", "true");
    if (clienteId) fd.append("cliente_id", clienteId);
    if (contaId) fd.append("cliente_conta_id", contaId);

    // Base + custos + vínculo (quando cliente/conta são informados) são
    // atômicos no backend: se o vínculo falhar, nada fica gravado — não há
    // mais "sucesso" seguido de tentativa de vínculo separada.
    const res  = await fetch(`${API_BASE}/importar-base`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}` },
      body: fd
    });
    const data = await res.json().catch(() => ({}));

    if (res.status === 401) { clearSession(); return; }
    if (!res.ok) throw new Error(mensagemErroImportacao(data) || `HTTP ${res.status}`);

    closePreview();
    fecharModalImportar();
    const vinculoMsg = data.vinculo ? " e vinculada" : "";
    setDashboardFeedback(`✓ ${data.mensagem || "Base importada"}${vinculoMsg} com sucesso. (${data.total ?? 0} produtos)`, "success");

    // reset do formulário
    document.getElementById("import-nome").value    = "";
    document.getElementById("import-arquivo").value = "";
    document.getElementById("file-label-text").textContent = "Escolher arquivo…";
    document.getElementById("file-label").classList.remove("has-file");
    const mpSel = document.getElementById("import-marketplace");
    if (mpSel) mpSel.value = "";
    const cliSel = document.getElementById("import-cliente");
    if (cliSel) cliSel.value = "";
    const contaSel = document.getElementById("import-conta");
    if (contaSel) contaSel.value = "";
    onImportMarketplaceChange();

    await loadBases();

  } catch (err) {
    closePreview();
    setImportStatus("Erro ao importar: " + err.message, "var(--vf-danger)");
  } finally {
    document.getElementById("preview-confirm").disabled                 = false;
    document.getElementById("preview-confirm-text").textContent        = "Confirmar importação";
    document.getElementById("preview-confirm-spinner").style.display   = "none";
  }
});

// ─── Botão importar (pré-visualizar) ───
document.getElementById("btn-importar").addEventListener("click", async () => {
  const arquivo = document.getElementById("import-arquivo").files?.[0];
  const nome    = document.getElementById("import-nome").value.trim();
  const marketplace = getImportMarketplace();

  setImportStatus("", "");
  if (!marketplace) { setImportStatus("Selecione o marketplace.", "var(--vf-danger)"); return; }
  if (marketplaceExigeCliente(marketplace)) {
    const cli = document.getElementById("import-cliente");
    if (!cli || !cli.value) {
      setImportStatus(`Selecione o cliente (obrigatório para ${marketplaceLabel(marketplace)}).`, "var(--vf-danger)");
      return;
    }
  }
  if (marketplaceExigeConta(marketplace)) {
    const conta = document.getElementById("import-conta");
    if (!conta || !conta.value) {
      setImportStatus(`Selecione a conta (obrigatória para ${marketplaceLabel(marketplace)} — nunca escolhida sozinha).`, "var(--vf-danger)");
      return;
    }
  }
  if (!nome)    { setImportStatus("Informe o nome da base.", "var(--vf-danger)"); return; }
  if (!arquivo) { setImportStatus("Selecione um arquivo .xlsx ou .csv.", "var(--vf-danger)"); return; }

  setImportLoading(true);

  try {
    const fd = new FormData();
    fd.append("arquivo", arquivo);
    fd.append("nomeBase", nome);
    fd.append("marketplace", marketplace);
    // sem "confirmar" → preview

    const res  = await fetch(`${API_BASE}/importar-base`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}` },
      body: fd
    });
    const data = await res.json().catch(() => ({}));

    if (res.status === 401) { clearSession(); return; }
    if (!res.ok) throw new Error(data.erro || `HTTP ${res.status}`);

    openPreview(data);

  } catch (err) {
    setImportStatus("Erro: " + err.message, "var(--vf-danger)");
  } finally {
    setImportLoading(false);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// ─── DRAWER "BASE DE CUSTOS" (visualizar + editar/adicionar/planilha) ──────────
//  Central única de custos da base: lista (GET /bases/:slug), edição/adição de
//  item via upsert (POST /bases/:slug/custos/upsert) e atualização por planilha
//  (preview seguro — Opção B, sem fluxo destrutivo).
// ══════════════════════════════════════════════════════════════════════════════
let DRAWER_ITENS = [];
// Filtros nativos no cabeçalho da tabela de custos (client-side, sem API).
let DRAWER_FILTROS = { produto: "", custo: "todos", imposto: "todos", taxa: "todos" };
// Chave única do marketplace da base aberta ("meli" | "shopee" | "tiktok").
// Substitui as flags booleanas por marketplace.
let DRAWER_MARKETPLACE = "meli";
let DRAWER_SLUG = "";
let DRAWER_BASE_ATUAL = null;       // objeto da base aberta no drawer
let DRAWER_ITEM_EDITANDO = null;    // item em edição (null = adicionar/planilha)
// Lote de linhas já classificadas do preview da planilha, aguardando confirmação.
// Formato: { marketplace, linhas: [{ id, id_model, custo, imposto, acao }] }.
let PLANILHA_STATE = null;
const DRAWER_LIMITE = 500;
const PLANILHA_PREVIEW_LIMITE = 300;

// Os itens da base escolhida moram no painel do cliente (era um drawer).
function abrirDrawer() {
  const el = document.getElementById("bases-drawer");
  if (el) el.hidden = false;
}

function setDrawerHint(msg, tipo) {
  const el = document.getElementById("bases-drawer-hint");
  if (!el) return;
  el.textContent = msg || "";
  el.style.color = tipo === "success" ? "var(--vf-success)"
    : tipo === "danger" ? "var(--vf-danger)" : "";
}

function drawerEhShopee() { return DRAWER_MARKETPLACE === "shopee"; }
function drawerEhTiktok() { return DRAWER_MARKETPLACE === "tiktok"; }

function abrirDrawerCustos(slug, mp) {
  DRAWER_SLUG = slug || "";
  DRAWER_MARKETPLACE = normalizarMarketplaceKey(mp);
  DRAWER_ITENS = [];
  resetarFiltrosDrawer();
  fecharPainelCusto();
  setDrawerHint("Clique no lápis de um item para editar, ou use “Adicionar item”.");

  const base = (Array.isArray(TODAS_BASES) ? TODAS_BASES : []).find((b) => String(b.slug) === String(slug));
  DRAWER_BASE_ATUAL = base || null;
  document.getElementById("bases-drawer-title").textContent = base?.nome || slug || "Base";
  const logoEl = document.getElementById("bases-drawer-logo");
  if (logoEl) logoEl.innerHTML = logoMarketplace(DRAWER_MARKETPLACE, "lg");
  const meta = document.getElementById("bases-drawer-meta");
  const mpLabel = marketplaceLabel(DRAWER_MARKETPLACE);
  const donoLabel = drawerEhTiktok() ? "Cliente" : "Cliente / Conta";
  const v = base?.vinculo;
  const dono = !v
    ? "—"
    : marketplaceTemConta(DRAWER_MARKETPLACE)
      ? (v.cliente_conta_id && v.conta_nome
          ? `${v.cliente_nome || v.cliente_slug || "—"} / ${v.conta_nome}`
          : `${v.cliente_nome || v.cliente_slug || "—"} (conta não definida)`)
      : (v.cliente_nome || v.cliente_slug || "—");
  if (meta) meta.innerHTML = `
    <span>Marketplace: <b>${escapeHTML(mpLabel)}</b></span>
    <span>${escapeHTML(donoLabel)}: <b>${escapeHTML(dono)}</b></span>
    <span>Idade: <b>${escapeHTML(base ? formatarIdadeBase(base) : "—")}</b></span>`;

  abrirDrawer();
  carregarCustosDrawer(slug);
}

// O cabeçalho da tabela (com os botões de filtro) é estático no HTML e nunca é
// recriado — só a mensagem de estado (loading/erro) ou o <tbody> são trocados.
function mostrarEstadoDrawer(html) {
  const table = document.getElementById("bases-costs-table");
  const state = document.getElementById("bases-drawer-state");
  if (table) table.style.display = "none";
  if (state) { state.style.display = ""; state.innerHTML = html; }
}
function mostrarTabelaCustos() {
  const table = document.getElementById("bases-costs-table");
  const state = document.getElementById("bases-drawer-state");
  if (table) table.style.display = "";
  if (state) { state.style.display = "none"; state.innerHTML = ""; }
}

async function carregarCustosDrawer(slug) {
  mostrarEstadoDrawer(`<div class="loading-dots"><span></span><span></span><span></span></div>
    <p>Carregando custos…</p>`);
  const countEl = document.getElementById("bases-drawer-count");
  if (countEl) countEl.textContent = "Carregando…";
  try {
    const res = await fetch(`${API_BASE}/bases/${encodeURIComponent(slug)}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    if (res.status === 401) { clearSession(); return; }
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error(data.erro || `HTTP ${res.status}`);
    const dados = data.dados || {};
    // A chave do objeto é só um identificador único de mapa (no TikTok é o
    // sku_id, identidade real da variação) — o produto_id vem sempre de
    // v.produto_id, com fallback pra chave antiga (respostas de antes do
    // campo existir).
    DRAWER_ITENS = Object.entries(dados).map(([chave, v]) => ({
      id: v.produto_id ?? chave,
      sku_id: v.sku_id ?? null,
      sku: v.sku ?? null,
      id_model: v.id_model ?? v.idModel ?? null,
      custo: v.custo_produto ?? v.custo ?? null,
      imposto: v.imposto_percentual ?? v.imposto ?? null,
      taxa: v.taxa_fixa ?? v.taxa ?? null,
      produto_nome: v.produto_nome ?? null,
      variacao_nome: v.variacao_nome ?? null,
      updated_at: v.updated_at ?? null,
    }));
    renderDrawerItens();
  } catch (err) {
    mostrarEstadoDrawer(`<p>Não foi possível carregar os custos desta base.</p>
      <button type="button" class="vf-btn vf-btn--secondary vf-btn--sm b-drawer-retry">Tentar novamente</button>`);
    if (countEl) countEl.textContent = "—";
    const retry = document.querySelector("#bases-drawer-state .b-drawer-retry");
    if (retry) retry.addEventListener("click", () => carregarCustosDrawer(slug));
  }
}

function isValorPreenchido(valor) {
  const n = Number(valor);
  return Number.isFinite(n) && n > 0;
}

// "todos": não filtra · "zerado": 0, vazio, null ou inválido · "preenchido": > 0
function passaFiltroNumerico(estado, valor) {
  if (estado !== "zerado" && estado !== "preenchido") return true;
  const preenchido = isValorPreenchido(valor);
  return estado === "preenchido" ? preenchido : !preenchido;
}

function drawerFiltrarItens() {
  const termo = String(DRAWER_FILTROS.produto || "").toLowerCase().trim();
  return DRAWER_ITENS.filter((it) => {
    if (!passaFiltroNumerico(DRAWER_FILTROS.custo, it.custo)) return false;
    if (!passaFiltroNumerico(DRAWER_FILTROS.imposto, it.imposto)) return false;
    if (!passaFiltroNumerico(DRAWER_FILTROS.taxa, it.taxa)) return false;
    if (termo) {
      const hay = `${it.id ?? ""} ${it.sku_id ?? ""} ${it.sku ?? ""} ${it.id_model ?? ""} ${it.produto_nome ?? ""} ${it.variacao_nome ?? ""}`.toLowerCase();
      if (!hay.includes(termo)) return false;
    }
    return true;
  });
}

function fmtMoedaDrawer(v) {
  if (v == null || v === "" || !Number.isFinite(Number(v))) return "—";
  return "R$ " + Number(v).toFixed(2).replace(".", ",");
}
// Imposto é guardado como decimal (0.05 = 5%) — exibe em percentual.
function fmtPercentDrawer(v) {
  if (v == null || v === "" || !Number.isFinite(Number(v))) return "—";
  const pct = Math.round(Number(v) * 100 * 100) / 100;
  return String(pct).replace(".", ",") + "%";
}

// Reflete o estado dos filtros nos wrappers estáticos do cabeçalho (.is-filtered).
function atualizarEstadoFiltrosHeader() {
  const estados = {
    produto: String(DRAWER_FILTROS.produto || "").trim() !== "",
    custo: DRAWER_FILTROS.custo !== "todos",
    imposto: DRAWER_FILTROS.imposto !== "todos",
    taxa: DRAWER_FILTROS.taxa !== "todos",
  };
  Object.keys(estados).forEach((campo) => {
    document.getElementById(`cost-filter-wrap-${campo}`)?.classList.toggle("is-filtered", estados[campo]);
  });
}

// Zera o estado e os controles nativos do cabeçalho ao abrir uma nova base no drawer.
function resetarFiltrosDrawer() {
  DRAWER_FILTROS = { produto: "", custo: "todos", imposto: "todos", taxa: "todos" };
  const produtoEl = document.getElementById("cost-filter-produto");
  if (produtoEl) produtoEl.value = "";
  ["custo", "imposto", "taxa"].forEach((campo) => {
    const el = document.getElementById(`cost-filter-${campo}`);
    if (el) el.value = "todos";
  });
  atualizarEstadoFiltrosHeader();
}

function renderDrawerItens() {
  const filtrados = drawerFiltrarItens();
  const totalFiltrado = filtrados.length;
  const exibidos = filtrados.slice(0, DRAWER_LIMITE);
  const isShopee = drawerEhShopee();
  const isTiktok = drawerEhTiktok();

  // TikTok: ID | ID DO SKU | CUSTO | IMPOSTO | ATUALIZAÇÃO | AÇÃO.
  // Sem ID Model, sem taxa fixa, sem SKU textual e sem nomes: o custo da
  // variação é identificado só pelo ID DO SKU (sku_id).
  const thIdModel = document.getElementById("bases-costs-th-idmodel");
  if (thIdModel) thIdModel.style.display = isShopee ? "" : "none";
  const thProdutoLabel = document.getElementById("bases-costs-th-produto-label");
  if (thProdutoLabel) thProdutoLabel.textContent = isTiktok ? "ID" : "Produto";
  const thSku = document.getElementById("bases-costs-th-sku");
  if (thSku) thSku.style.display = isTiktok ? "" : "none";
  const thTaxa = document.getElementById("bases-costs-th-taxa");
  if (thTaxa) thTaxa.style.display = isTiktok ? "none" : "";
  const thAtualizacao = document.getElementById("bases-costs-th-atualizacao");
  if (thAtualizacao) thAtualizacao.style.display = isTiktok ? "" : "none";

  const rows = exibidos.map((it, idx) => {
    const custoZero = Number(it.custo) === 0;
    const impostoZero = Number(it.imposto) === 0;
    const taxaZero = Number(it.taxa) === 0;
    const idModelTd = isShopee ? `<td class="vf-mono">${escapeHTML(String(it.id_model ?? "—"))}</td>` : "";
    const skuIdTd = isTiktok ? `<td class="vf-mono">${escapeHTML(String(it.sku_id || "—"))}</td>` : "";
    const taxaTd = isTiktok
      ? ""
      : `<td class="num vf-mono ${taxaZero ? "vf-bases-zero" : ""}">${escapeHTML(fmtMoedaDrawer(it.taxa))}</td>`;
    const atualizacaoTd = isTiktok
      ? `<td class="vf-bases-muted">${escapeHTML(it.updated_at ? formatDateTime(it.updated_at) : "—")}</td>`
      : "";
    // No TikTok a 1ª coluna é o ID do produto (informativo, pode repetir).
    const idExibido = isTiktok ? (it.id || "—") : (it.id ?? "—");
    return `<tr class="b-cost-row" data-cost-idx="${idx}" tabindex="0">
      <td class="vf-mono">${escapeHTML(String(idExibido))}</td>
      ${skuIdTd}
      ${idModelTd}
      <td class="num vf-mono ${custoZero ? "vf-bases-zero" : ""}">${escapeHTML(fmtMoedaDrawer(it.custo))}</td>
      <td class="num vf-mono ${impostoZero ? "vf-bases-zero" : ""}">${escapeHTML(fmtPercentDrawer(it.imposto))}</td>
      ${taxaTd}
      ${atualizacaoTd}
      <td class="vf-bases-cost-actions">
        <button type="button" class="vf-btn vf-btn--ghost vf-btn--icon vf-btn--sm b-cost-edit" data-cost-idx="${idx}" title="Editar item" aria-label="Editar item">${B_EDIT_SM_SVG}</button>
      </td>
    </tr>`;
  }).join("");

  // Cabeçalho com filtros continua visível mesmo sem resultados, para o
  // usuário conseguir trocar/limpar o filtro que zerou a lista.
  // TikTok: ID, ID DO SKU, Custo, Imposto, Atualização, Ações.
  const colspan = isTiktok ? 6 : (isShopee ? 6 : 5);
  const rowsOuVazio = totalFiltrado
    ? rows
    : `<tr class="vf-table__empty"><td colspan="${colspan}">Nenhum item para os filtros atuais.</td></tr>`;

  const tbody = document.getElementById("bases-costs-tbody");
  if (tbody) tbody.innerHTML = rowsOuVazio;
  mostrarTabelaCustos();
  atualizarEstadoFiltrosHeader();

  tbody?.querySelectorAll(".b-cost-edit").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = Number(btn.dataset.costIdx);
      if (Number.isFinite(idx) && exibidos[idx]) abrirFormularioItem(exibidos[idx]);
    });
  });
  tbody?.querySelectorAll(".b-cost-row").forEach((tr) => {
    tr.addEventListener("click", () => {
      // Não dispara se o usuário está apenas selecionando texto da linha.
      const sel = window.getSelection && window.getSelection().toString();
      if (sel) return;
      const idx = Number(tr.dataset.costIdx);
      if (Number.isFinite(idx) && exibidos[idx]) abrirFormularioItem(exibidos[idx]);
    });
    tr.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      const idx = Number(tr.dataset.costIdx);
      if (Number.isFinite(idx) && exibidos[idx]) abrirFormularioItem(exibidos[idx]);
    });
  });

  const totalBase = DRAWER_ITENS.length;
  const countEl = document.getElementById("bases-drawer-count");
  if (!countEl) return;
  if (exibidos.length < totalFiltrado) {
    countEl.textContent = `Mostrando ${exibidos.length} de ${totalFiltrado} itens (limite ${DRAWER_LIMITE}) · refine a busca`;
  } else {
    countEl.textContent = `Mostrando ${totalFiltrado} de ${totalBase} itens`;
  }
}

// ─── Filtros nativos no cabeçalho da tabela de custos ───
// Controles fixos no HTML (nunca recriados) — listeners diretos, sem popover
// nem delegação: cada input/select já existe assim que a página carrega.
document.getElementById("cost-filter-produto")?.addEventListener("input", (e) => {
  DRAWER_FILTROS.produto = e.target.value || "";
  renderDrawerItens();
});
["custo", "imposto", "taxa"].forEach((campo) => {
  document.getElementById(`cost-filter-${campo}`)?.addEventListener("change", (e) => {
    DRAWER_FILTROS[campo] = e.target.value || "todos";
    renderDrawerItens();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ─── EDIÇÃO DE CUSTOS DENTRO DO DRAWER ─────────────────────────────────────────
//  · Editar item / Adicionar item → upsert REAL (POST /bases/:slug/custos/upsert).
//    Atualiza se o produto existe, adiciona se não. Nunca apaga itens ausentes.
//  · Atualizar por planilha → preview seguro (Opção B). NÃO chama /importar-base,
//    NÃO usa confirmar=true, NÃO substitui a base, NÃO apaga ausentes.
// ══════════════════════════════════════════════════════════════════════════════

// Imposto é digitado em % e persistido como decimal (5 → 0.05), igual ao editor
// rápido de relatorios.js. Mantém o contrato real do endpoint de upsert.
function parsePercentualUpdate(valorUsuario) {
  const raw = String(valorUsuario ?? "").trim();
  if (!raw) return { tem: false, valor: null, invalido: false };
  const n = Number(raw.replace(",", "."));
  if (!Number.isFinite(n)) return { tem: false, valor: null, invalido: true };
  return { tem: true, valor: n / 100, invalido: false };
}

function parseNumeroUpdate(valorUsuario) {
  const raw = String(valorUsuario ?? "").trim();
  if (!raw) return { tem: false, valor: null, invalido: false };
  const n = Number(raw.replace(",", "."));
  if (!Number.isFinite(n)) return { tem: false, valor: null, invalido: true };
  return { tem: true, valor: n, invalido: false };
}

function validarArquivoUpdate(file) {
  const name = String(file?.name || "").toLowerCase();
  return name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".csv");
}

// Feedback dentro do painel de edição/planilha (só há um painel aberto por vez).
function setCostFeedback(msg, tipo) {
  const el = document.querySelector("#bases-cost-panel .vf-bases-cost-feedback");
  if (!el) return;
  el.className = "vf-alert vf-bases-cost-feedback" + (tipo ? ` is-${tipo}` : "");
  el.textContent = msg || "";
  el.style.display = msg ? "flex" : "none";
}

function fecharPainelCusto() {
  const panel = document.getElementById("bases-cost-panel");
  if (panel) { panel.style.display = "none"; panel.innerHTML = ""; }
  DRAWER_ITEM_EDITANDO = null;
}

const B_FILE_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;

// ─── Formulário de item (editar existente ou adicionar novo) ───
function abrirFormularioItem(item = null) {
  const panel = document.getElementById("bases-cost-panel");
  if (!panel || !DRAWER_SLUG) return;

  DRAWER_ITEM_EDITANDO = item || null;
  const editando = !!item;
  const isShopee = drawerEhShopee();
  const isTiktok = drawerEhTiktok();
  const titulo = editando ? "Editar item da base" : "Adicionar item à base";
  const btnLabel = editando ? "Salvar alterações" : "Adicionar item";
  const microcopy = editando
    ? (isTiktok
      ? "O ID DO SKU não muda na edição — ele é a identidade da variação. As alterações sobrescrevem custo e imposto."
      : "As alterações sobrescrevem custo, imposto e taxa deste item.")
    : (isTiktok
      ? "O ID DO SKU identifica a variação: se já existir na base, os valores serão atualizados. O mesmo ID de produto pode aparecer em vários itens, um por variação."
      : "Se o produto já existir na base, os valores serão atualizados.");

  const produtoVal = editando ? escapeHTML(String(item.id ?? "")) : "";
  const skuIdVal = editando ? escapeHTML(String(item.sku_id ?? "")) : "";
  const idModelVal = editando ? escapeHTML(String(item.id_model ?? "")) : "";
  const custoVal = editando && Number.isFinite(Number(item.custo)) ? Number(item.custo) : "";
  const impostoVal = editando && Number.isFinite(Number(item.imposto))
    ? (Math.round(Number(item.imposto) * 100 * 1e6) / 1e6) : "";
  const taxaVal = editando && Number.isFinite(Number(item.taxa)) ? Number(item.taxa) : "";

  const idModelField = isShopee ? `
    <div class="vf-field vf-field--full">
      <label class="vf-field__label" for="cost-form-id-model">ID Model</label>
      <input type="text" class="vf-input" id="cost-form-id-model" value="${idModelVal}" placeholder="ID da variação. Vazio = custo do item (sem variação)" autocomplete="off"${editando ? " readonly" : ""}>
      ${editando ? `<span class="vf-field__hint">Item + Model identificam a variação: para outra variação, use Adicionar item.</span>` : ""}
    </div>` : "";

  // TikTok: ID DO SKU obrigatório (é a chave do custo). Sem SKU textual, sem
  // nomes, sem taxa fixa e sem ID Model.
  const skuIdField = isTiktok ? `
    <div class="vf-field vf-field--full">
      <label class="vf-field__label" for="cost-form-sku-id">ID DO SKU <span class="vf-field__required">*</span></label>
      <input type="text" class="vf-input" id="cost-form-sku-id" value="${skuIdVal}" placeholder="Ex.: 1736898108355347594" autocomplete="off"${editando ? " readonly" : ""}>
      <span class="vf-field__hint">ID da variação no TikTok Shop — é o campo comparado com o "ID do SKU" do Income no fechamento.</span>
    </div>` : "";

  const taxaField = isTiktok ? "" : `
        <div class="vf-field">
          <label class="vf-field__label" for="cost-form-taxa">Taxa fixa</label>
          <input type="number" class="vf-input" id="cost-form-taxa" step="0.01" min="0" value="${taxaVal}" placeholder="0.00">
        </div>`;

  const labelProduto = isTiktok ? "ID" : "Produto / MLB / SKU";
  const placeholderProduto = isTiktok ? "Ex.: 1736898364814492810 (opcional)" : "Ex.: MLB123456789 ou SKU";

  panel.innerHTML = `
    <div class="vf-bases-cost-form">
      <div class="vf-bases-cost-form-head">
        <strong>${escapeHTML(titulo)}</strong>
        <button type="button" class="vf-btn vf-btn--ghost vf-btn--icon vf-btn--sm" id="cost-form-close" aria-label="Fechar">✕</button>
      </div>
      <div class="vf-form-grid vf-bases-cost-grid">
        <div class="vf-field vf-field--full">
          <label class="vf-field__label" for="cost-form-produto">${escapeHTML(labelProduto)}${isTiktok ? "" : ` <span class="vf-field__required">*</span>`}</label>
          <input type="text" class="vf-input" id="cost-form-produto" value="${produtoVal}" placeholder="${escapeHTML(placeholderProduto)}" autocomplete="off"${editando ? " readonly" : ""}>
          ${isTiktok ? `<span class="vf-field__hint">ID do produto no TikTok Shop. Informativo: repete entre as variações e não é usado para achar o custo.</span>` : ""}
        </div>
        ${skuIdField}
        ${idModelField}
        <div class="vf-field">
          <label class="vf-field__label" for="cost-form-custo">${isTiktok ? "Custo unitário" : "Custo"} <span class="vf-field__required">*</span></label>
          <input type="number" class="vf-input" id="cost-form-custo" step="0.01" min="0" value="${custoVal}" placeholder="0.00">
        </div>
        <div class="vf-field">
          <label class="vf-field__label" for="cost-form-imposto">Imposto %</label>
          <input type="number" class="vf-input" id="cost-form-imposto" step="0.01" min="0" value="${impostoVal}" placeholder="0">
        </div>
        ${taxaField}
      </div>
      <p class="vf-field__hint vf-bases-microcopy">${escapeHTML(microcopy)}</p>
      <div class="vf-alert vf-bases-cost-feedback" id="cost-form-feedback" style="display:none;" aria-live="polite"></div>
      <div class="vf-form-actions">
        <button type="button" class="vf-btn vf-btn--secondary vf-btn--sm" id="cost-form-cancel">Cancelar</button>
        <button type="button" class="vf-btn vf-btn--primary vf-btn--sm" id="cost-form-save">${escapeHTML(btnLabel)}</button>
      </div>
    </div>`;
  panel.style.display = "block";

  document.getElementById("cost-form-close")?.addEventListener("click", fecharPainelCusto);
  document.getElementById("cost-form-cancel")?.addEventListener("click", fecharPainelCusto);
  document.getElementById("cost-form-save")?.addEventListener("click", salvarItemManual);
  ["cost-form-produto", "cost-form-sku-id", "cost-form-id-model", "cost-form-custo", "cost-form-imposto", "cost-form-taxa"].forEach((id) => {
    document.getElementById(id)?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); salvarItemManual(); }
    });
  });

  setTimeout(() => {
    const first = editando
      ? document.getElementById("cost-form-custo")
      : document.getElementById(isTiktok ? "cost-form-sku-id" : "cost-form-produto");
    first?.focus();
  }, 30);
  panel.scrollIntoView({ block: "nearest" });
}

async function salvarItemManual() {
  const slug = String(DRAWER_SLUG || "").trim();
  if (!slug) return;

  const produtoEl = document.getElementById("cost-form-produto");
  const skuIdEl = document.getElementById("cost-form-sku-id");
  const idModelEl = document.getElementById("cost-form-id-model");
  const custoEl = document.getElementById("cost-form-custo");
  const impostoEl = document.getElementById("cost-form-imposto");
  const taxaEl = document.getElementById("cost-form-taxa");
  const saveBtn = document.getElementById("cost-form-save");
  const isTiktok = drawerEhTiktok();

  // TikTok: o ID do produto é opcional (informativo). O obrigatório é o
  // ID DO SKU, que identifica a variação e resolve o custo no fechamento.
  const produto = String(produtoEl?.value || "").trim();
  if (!isTiktok && !produto) {
    setCostFeedback("Informe o produto / MLB / SKU.", "danger");
    produtoEl?.focus();
    return;
  }
  if (isTiktok && produto && /e[+-]?\d/i.test(produto)) {
    setCostFeedback("ID TikTok em notação científica. Formate a coluna como texto antes de importar.", "danger");
    produtoEl?.focus();
    return;
  }

  const skuId = isTiktok ? String(skuIdEl?.value || "").trim() : "";
  if (isTiktok && !skuId) {
    setCostFeedback("Informe o ID DO SKU (id da variação).", "danger");
    skuIdEl?.focus();
    return;
  }
  if (isTiktok && /e[+-]?\d/i.test(skuId)) {
    setCostFeedback("ID do SKU TikTok em notação científica. Formate a coluna como texto antes de importar.", "danger");
    skuIdEl?.focus();
    return;
  }

  const custo = parseNumeroUpdate(custoEl?.value);
  if (!custo.tem) { setCostFeedback("Informe o custo (pode ser 0).", "danger"); custoEl?.focus(); return; }
  if (custo.invalido) { setCostFeedback("Custo inválido — use apenas números.", "danger"); custoEl?.focus(); return; }

  const imposto = parsePercentualUpdate(impostoEl?.value);
  if (imposto.invalido) { setCostFeedback("Imposto % deve ser numérico.", "danger"); impostoEl?.focus(); return; }

  const taxa = parseNumeroUpdate(taxaEl?.value);
  if (taxa.invalido) { setCostFeedback("Taxa fixa deve ser numérica.", "danger"); taxaEl?.focus(); return; }

  const payload = { produto_id: produto, custo_produto: custo.valor };
  if (imposto.tem) payload.imposto_percentual = imposto.valor;
  // TikTok não tem taxa fixa — o campo nem existe no formulário.
  if (!isTiktok && taxa.tem) payload.taxa_fixa = taxa.valor;
  if (drawerEhShopee()) {
    const idModel = String(idModelEl?.value || "").trim();
    if (idModel) payload.id_model = idModel;
  }
  // TikTok: sku_id é a chave do custo no servidor (base_id + sku_id).
  if (isTiktok) payload.sku_id = skuId;

  const editando = !!DRAWER_ITEM_EDITANDO;
  const textoOriginal = saveBtn ? saveBtn.textContent : "Salvar";
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "Salvando..."; }
  setCostFeedback("", "");

  try {
    const res = await fetch(`${API_BASE}/bases/${encodeURIComponent(slug)}/custos/upsert`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.status === 401) { clearSession(); return; }
    if (res.status === 403) { setCostFeedback("Você não tem permissão para ajustar esta base.", "danger"); return; }
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error(data.erro || `HTTP ${res.status}`);

    // Recarrega os custos do drawer (drawer permanece aberto).
    await carregarCustosDrawer(slug);

    if (editando) {
      fecharPainelCusto();
      setDrawerHint("Item atualizado com sucesso.", "success");
    } else {
      // Mantém o formulário aberto p/ adicionar outro item; limpa os campos.
      if (produtoEl) produtoEl.value = "";
      if (skuIdEl) skuIdEl.value = "";
      if (idModelEl) idModelEl.value = "";
      if (custoEl) custoEl.value = "";
      if (impostoEl) impostoEl.value = "";
      if (taxaEl) taxaEl.value = "";
      setCostFeedback(
        isTiktok
          ? "Item adicionado. Se o ID DO SKU já existia, os valores foram atualizados."
          : "Item adicionado. Se o produto já existia, os valores foram atualizados.",
        "success"
      );
      (isTiktok ? skuIdEl : produtoEl)?.focus();
    }
  } catch (err) {
    setCostFeedback("Erro ao salvar item: " + (err?.message || "tente novamente."), "danger");
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = textoOriginal; }
  }
}

// ─── Painel "Atualizar por planilha" (preview seguro — Opção B) ───
function abrirPainelPlanilha() {
  const panel = document.getElementById("bases-cost-panel");
  if (!panel || !DRAWER_SLUG) return;
  DRAWER_ITEM_EDITANDO = null;

  panel.innerHTML = `
    <div class="vf-bases-planilha-panel">
      <div class="vf-bases-cost-form-head">
        <strong>Atualizar por planilha</strong>
        <button type="button" class="vf-btn vf-btn--ghost vf-btn--icon vf-btn--sm" id="cost-planilha-close" aria-label="Fechar">✕</button>
      </div>
      <div class="vf-banner vf-banner--compact is-info">A atualização por planilha atualiza produtos existentes e adiciona novos, sem apagar itens ausentes da planilha.</div>
      <div class="vf-field">
        <label class="vf-field__label">Planilha (.xlsx, .xls, .csv)</label>
        <input class="vf-visually-hidden" type="file" id="cost-planilha-arquivo" accept=".xlsx,.xls,.csv">
        <label class="vf-dropzone" id="cost-planilha-label" for="cost-planilha-arquivo">
          <span class="vf-dropzone__icon" aria-hidden="true">${B_FILE_SVG}</span>
          <span class="vf-dropzone__title" id="cost-planilha-label-text">Escolher arquivo…</span>
          <span class="vf-dropzone__hint">.xlsx · .xls · .csv · clique para selecionar</span>
        </label>
      </div>
      <div class="vf-banner vf-banner--compact is-success">Nenhum item será apagado neste fluxo.</div>
      <div class="vf-alert vf-bases-cost-feedback" id="cost-planilha-feedback" style="display:none;" aria-live="polite"></div>
      <div class="vf-form-actions">
        <button type="button" class="vf-btn vf-btn--secondary vf-btn--sm" id="cost-planilha-cancel">Cancelar</button>
        <button type="button" class="vf-btn vf-btn--primary vf-btn--sm" id="cost-planilha-preview">Pré-visualizar atualização</button>
      </div>
      <div class="vf-bases-cost-preview" id="cost-planilha-preview-box" style="display:none;"></div>
    </div>`;
  panel.style.display = "block";

  document.getElementById("cost-planilha-close")?.addEventListener("click", fecharPainelCusto);
  document.getElementById("cost-planilha-cancel")?.addEventListener("click", fecharPainelCusto);
  document.getElementById("cost-planilha-preview")?.addEventListener("click", previewPlanilhaDrawer);
  document.getElementById("cost-planilha-arquivo")?.addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    const text = document.getElementById("cost-planilha-label-text");
    const label = document.getElementById("cost-planilha-label");
    if (text) text.textContent = f ? f.name : "Escolher arquivo…";
    if (label) label.classList.toggle("has-file", !!f);
    const box = document.getElementById("cost-planilha-preview-box");
    if (box) { box.style.display = "none"; box.innerHTML = ""; }
  });
  panel.scrollIntoView({ block: "nearest" });
}

// Deduplica as linhas normalizadas do preview (mantém a ÚLTIMA ocorrência por
// chave de identidade, contando quantas foram sobrescritas) e classifica cada
// uma contra DRAWER_ITENS.
//
// A chave de identidade é a MESMA que o upsert do servidor usa:
//   TikTok        → sku_id  (ID DO SKU da variação)
//   MELI/Shopee   → produto_id
// Assim o rótulo "Atualizar/Adicionar" reflete o que vai acontecer de fato.
// Identidade de uma linha da base: TikTok = ID DO SKU; Shopee (FIN-508) =
// Item + Model (várias variações por Item); MELI = ID.
function chaveIdentidadePlanilha(linha, isTiktok) {
  const bruto = isTiktok ? linha?.sku_id : linha?.id;
  if (bruto == null || String(bruto).trim() === "") return "";
  if (!isTiktok && drawerEhShopee()) return `${String(bruto).trim()}|${String(linha?.id_model ?? "").trim()}`;
  return String(bruto);
}

function dedupEClassificarPlanilha(rows) {
  const isTiktok = drawerEhTiktok();
  const existentes = new Set(
    DRAWER_ITENS.map((it) => chaveIdentidadePlanilha(it, isTiktok)).filter(Boolean)
  );
  const porChave = new Map();
  let duplicadosSobrescritos = 0;

  for (const r of rows) {
    const chave = chaveIdentidadePlanilha(r, isTiktok);
    if (!chave) continue;
    if (porChave.has(chave)) duplicadosSobrescritos++;
    porChave.set(chave, r); // última ocorrência vence
  }

  const linhas = [];
  let nAtualizar = 0;
  let nAdicionar = 0;
  for (const [chave, r] of porChave) {
    const existe = existentes.has(chave);
    if (existe) nAtualizar++; else nAdicionar++;
    linhas.push({
      id: r.id == null ? "" : String(r.id),
      sku_id: r.sku_id == null ? null : String(r.sku_id),
      chave,
      id_model: r.id_model ?? null,
      custo: r.custo,
      imposto: r.imposto,
      acao: existe ? "atualizar" : "adicionar",
    });
  }

  return { linhas, nAtualizar, nAdicionar, duplicadosSobrescritos };
}

function badgeAcaoPlanilha(acao) {
  if (acao === "atualizar") return `<span class="vf-tag is-info">Atualizar</span>`;
  if (acao === "adicionar") return `<span class="vf-tag is-success">Adicionar</span>`;
  return `<span class="vf-tag is-neutral">Ignorar</span>`;
}

// Preview REAL: parseia a planilha via endpoint seguro (não salva nada), classifica
// e mostra o resumo + tabela. Não chama /importar-base, não reimporta, não apaga.
async function previewPlanilhaDrawer() {
  const fileInput = document.getElementById("cost-planilha-arquivo");
  const file = fileInput?.files?.[0];
  const box = document.getElementById("cost-planilha-preview-box");
  const previewBtn = document.getElementById("cost-planilha-preview");

  PLANILHA_STATE = null;
  if (!file) { setCostFeedback("Selecione um arquivo .xlsx, .xls ou .csv.", "danger"); return; }
  if (!validarArquivoUpdate(file)) { setCostFeedback("Arquivo inválido. Envie .xlsx, .xls ou .csv.", "danger"); return; }

  const textoBtn = previewBtn ? previewBtn.textContent : "Pré-visualizar atualização";
  if (previewBtn) { previewBtn.disabled = true; previewBtn.textContent = "Processando…"; }
  setCostFeedback("Lendo e classificando a planilha…", "neutral");
  if (box) { box.style.display = "none"; box.innerHTML = ""; }

  try {
    // O preview precisa saber o marketplace da base para escolher a
    // normalização de ID correta (TikTok nunca vira MLB).
    const marketplace = DRAWER_MARKETPLACE;
    const fd = new FormData();
    fd.append("arquivo", file);
    // Preview seguro: o servidor apenas parseia/normaliza e devolve dados_importacao.
    // NÃO usa /importar-base e NÃO envia confirmar=true — nada é gravado aqui.
    fd.append("config", JSON.stringify({ marketplace }));

    const res = await fetch(`${API_BASE}/bases/assistente/preview`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}` },
      body: fd,
    });
    if (res.status === 401) { clearSession(); return; }
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error(data.erro || `HTTP ${res.status}`);

    const dados = Array.isArray(data.dados_importacao) ? data.dados_importacao : [];
    const resumo = data.resumo || {};
    const { linhas, nAtualizar, nAdicionar, duplicadosSobrescritos } = dedupEClassificarPlanilha(dados);

    const isTiktokPreview = drawerEhTiktok();
    const chavesPlanilha = new Set(linhas.map((l) => l.chave));
    const preservados = DRAWER_ITENS.filter(
      (it) => !chavesPlanilha.has(chaveIdentidadePlanilha(it, isTiktokPreview))
    ).length;
    const ignoradas = Number(resumo.linhas_ignoradas || 0);
    const lidas = Number(resumo.linhas_lidas || dados.length);

    PLANILHA_STATE = { marketplace, linhas };

    renderPreviewPlanilha({
      lidas, nAtualizar, nAdicionar, ignoradas, duplicadosSobrescritos, preservados,
    });
    setCostFeedback("", "");
  } catch (err) {
    PLANILHA_STATE = null;
    setCostFeedback("Erro ao processar a planilha: " + (err?.message || "tente novamente."), "danger");
  } finally {
    if (previewBtn) { previewBtn.disabled = false; previewBtn.textContent = textoBtn; }
  }
}

function renderPreviewPlanilha({ lidas, nAtualizar, nAdicionar, ignoradas, duplicadosSobrescritos, preservados }) {
  const box = document.getElementById("cost-planilha-preview-box");
  if (!box) return;

  const linhas = (PLANILHA_STATE && PLANILHA_STATE.linhas) || [];
  const validos = linhas.length;
  const isShopee = drawerEhShopee();
  const isTiktok = drawerEhTiktok();

  const resumoLinhas = [
    `${lidas} linha(s) lida(s)`,
    `${validos} item(ns) válido(s)`,
    `${nAtualizar} será(ão) atualizado(s)`,
    `${nAdicionar} será(ão) adicionado(s)`,
    ignoradas ? `${ignoradas} linha(s) ignorada(s)` : null,
    duplicadosSobrescritos ? `${duplicadosSobrescritos} duplicado(s) na planilha (mantida a última ocorrência)` : null,
    `${preservados} item(ns) atual(is) da base será(ão) preservado(s) se não vieram na planilha`,
  ].filter(Boolean);

  const exibidos = linhas.slice(0, PLANILHA_PREVIEW_LIMITE);
  const thIdModel = isShopee ? `<th>ID Model</th>` : "";
  const thSkuId = isTiktok ? `<th>ID DO SKU</th>` : "";
  const thTaxa = isTiktok ? "" : `<th class="num">Taxa fixa</th>`;
  const corpo = exibidos.map((l) => {
    const obs = l.acao === "adicionar"
      ? "Novo item"
      : (Number.isFinite(Number(l.imposto)) ? "Sobrescreve custo e imposto" : "Sobrescreve custo · imposto atual mantido");
    const idModelTd = isShopee ? `<td class="vf-mono">${escapeHTML(String(l.id_model ?? "—"))}</td>` : "";
    const skuIdTd = isTiktok ? `<td class="vf-mono">${escapeHTML(String(l.sku_id || "—"))}</td>` : "";
    const taxaTd = isTiktok ? "" : `<td class="num vf-mono">—</td>`;
    return `<tr>
      <td class="vf-mono">${escapeHTML(String(l.id || "—"))}</td>
      ${skuIdTd}
      ${idModelTd}
      <td class="num vf-mono">${escapeHTML(fmtMoedaDrawer(l.custo))}</td>
      <td class="num vf-mono">${escapeHTML(fmtPercentDrawer(l.imposto))}</td>
      ${taxaTd}
      <td>${badgeAcaoPlanilha(l.acao)}</td>
      <td>${escapeHTML(obs)}</td>
    </tr>`;
  }).join("");

  const truncado = linhas.length > exibidos.length
    ? `<p class="vf-field__hint" style="margin-top:6px;">Mostrando ${exibidos.length} de ${linhas.length} itens válidos. Todos serão salvos ao confirmar.</p>`
    : "";

  box.innerHTML = `
    <div class="vf-bases-preview-title">Preview da atualização incremental</div>
    <ul class="vf-bases-resumo">${resumoLinhas.map((t) => `<li>${escapeHTML(t)}</li>`).join("")}</ul>
    <p class="vf-field__hint" style="margin:0 0 8px;">${isTiktok
      ? "TikTok Shop não usa taxa fixa: cada item fica com taxa zero."
      : "Taxa fixa não vem nesta planilha: o valor atual de cada item é preservado."}</p>
    <div class="vf-table-wrap vf-bases-planilha-wrap">
      <table class="vf-table vf-table--compact">
        <thead><tr>
          <th>${isTiktok ? "ID" : "Produto / MLB / SKU"}</th>${thSkuId}${thIdModel}
          <th class="num">Custo</th><th class="num">Imposto</th>${thTaxa}
          <th>Ação</th><th>Observação</th>
        </tr></thead>
        <tbody>${corpo || `<tr class="vf-table__empty"><td colspan="${isTiktok ? 6 : (isShopee ? 7 : 6)}">Nenhum item válido para salvar.</td></tr>`}</tbody>
      </table>
    </div>
    ${truncado}
    <div class="vf-alert vf-bases-cost-feedback" id="cost-planilha-result" style="display:none;" aria-live="polite"></div>
    <div class="vf-form-actions" style="margin-top:12px;">
      <button type="button" class="vf-btn vf-btn--primary vf-btn--sm" id="cost-planilha-confirm"${validos ? "" : " disabled"}>Confirmar atualização incremental</button>
    </div>`;
  box.style.display = "block";
  document.getElementById("cost-planilha-confirm")?.addEventListener("click", confirmarPlanilhaDrawer);
  box.scrollIntoView({ block: "nearest" });
}

function setPlanilhaResult(msg, tipo) {
  const el = document.getElementById("cost-planilha-result");
  if (!el) return;
  el.className = "vf-alert vf-bases-cost-feedback" + (tipo ? ` is-${tipo}` : "");
  el.textContent = msg || "";
  el.style.display = msg ? "flex" : "none";
}

// Atualização incremental: usa upsert por item para preservar produtos ausentes.
// Nunca chama /importar-base, nunca envia confirmar=true, nunca faz DELETE.
async function confirmarPlanilhaDrawer() {
  const slug = String(DRAWER_SLUG || "").trim();
  if (!slug || !PLANILHA_STATE || !Array.isArray(PLANILHA_STATE.linhas) || !PLANILHA_STATE.linhas.length) return;

  const linhas = PLANILHA_STATE.linhas;
  const marketplace = PLANILHA_STATE.marketplace;
  const confirmBtn = document.getElementById("cost-planilha-confirm");
  const previewBtn = document.getElementById("cost-planilha-preview");

  if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = "Atualizando…"; }
  if (previewBtn) previewBtn.disabled = true;
  setCostFeedback("Atualizando itens… não feche o painel.", "neutral");
  setPlanilhaResult("", "");

  let atualizados = 0;
  let adicionados = 0;
  let falhas = 0;
  const errosDetalhe = [];

  for (const linha of linhas) {
    const payload = { produto_id: linha.id, custo_produto: linha.custo };
    // Imposto só é enviado quando veio na planilha; ausente preserva o valor atual
    // (item existente) ou usa o padrão da base (item novo). Nunca zera à força.
    if (Number.isFinite(Number(linha.imposto))) payload.imposto_percentual = Number(linha.imposto);
    // Taxa fixa não é extraída deste preview → omitida → preservada.
    // (Em TikTok o backend força 0 e nunca aceita taxa.)
    if (marketplace === "shopee" && linha.id_model) payload.id_model = linha.id_model;
    // TikTok: sku_id é a chave — sem ele o servidor recusa a linha (400).
    if (marketplace === "tiktok") payload.sku_id = linha.sku_id || "";

    try {
      const res = await fetch(`${API_BASE}/bases/${encodeURIComponent(slug)}/custos/upsert`, {
        method: "POST",
        headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.status === 401) { clearSession(); return; }
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        falhas++;
        if (errosDetalhe.length < 10) errosDetalhe.push(`${linha.chave}: ${data.erro || `HTTP ${res.status}`}`);
        continue;
      }
      if (data.acao === "criado") adicionados++; else atualizados++;
    } catch (err) {
      falhas++;
      if (errosDetalhe.length < 10) errosDetalhe.push(`${linha.chave}: ${err?.message || "erro de conexão"}`);
    }
  }

  // Recarrega os custos do drawer e a lista de bases (contagens/KPIs).
  await carregarCustosDrawer(slug);
  await loadBases();

  const houveSucesso = (atualizados + adicionados) > 0;
  const tipoFinal = falhas ? (houveSucesso ? "neutral" : "danger") : "success";
  const msgFinal = `Atualização concluída: ${atualizados} atualizados, ${adicionados} adicionados, ${falhas} falhas. Nenhum item ausente foi apagado.`;
  setCostFeedback(msgFinal, tipoFinal);

  const detalhe = falhas && errosDetalhe.length
    ? `<p class="vf-field__hint" style="margin:6px 0 0;">Falhas (até 10): ${escapeHTML(errosDetalhe.join(" · "))}</p>`
    : "";
  const resultTipo = falhas ? (houveSucesso ? "neutral" : "danger") : "success";
  setPlanilhaResult(msgFinal, resultTipo);
  const resultEl = document.getElementById("cost-planilha-result");
  if (resultEl && detalhe) resultEl.insertAdjacentHTML("beforeend", detalhe);

  // Evita reconfirmar o mesmo lote; painel permanece aberto com o resultado final.
  PLANILHA_STATE = null;
  if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = "Atualização concluída"; }
  if (previewBtn) previewBtn.disabled = false;
}

// ══════════════════════════════════════════════════════════════════════════════
// ─── WIRING (toolbar, KPIs, chips, modal importar, drawer, menus) ─────────────
// ══════════════════════════════════════════════════════════════════════════════

// Busca: filtra a lista de clientes (cliente, conta ou base)
const basesBuscaInput = document.getElementById("bases-busca");
if (basesBuscaInput) {
  basesBuscaInput.addEventListener("input", (e) => {
    BASES_BUSCA = e.target.value || "";
    renderBasesTela();
  });
}
document.querySelectorAll("[data-cli-filtro]").forEach((b) => b.addEventListener("click", () => {
  BASES_FILTRO_CLI = b.dataset.cliFiltro || "";
  renderBasesTela();
}));
document.getElementById("bases-refresh")?.addEventListener("click", loadBases);

// Lista de clientes: clique e setas (listbox)
const listaClientesEl = document.getElementById("bases-clientes-lista");
if (listaClientesEl) {
  listaClientesEl.addEventListener("click", (e) => {
    const item = e.target.closest("[data-cli-key]");
    if (item) selecionarCliente(item.dataset.cliKey);
  });
  listaClientesEl.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const itens = [...listaClientesEl.querySelectorAll("[data-cli-key]")];
    const i = itens.indexOf(document.activeElement);
    const prox = itens[i + (e.key === "ArrowDown" ? 1 : -1)];
    if (!prox) return;
    e.preventDefault();
    selecionarCliente(prox.dataset.cliKey);
    listaClientesEl.querySelector(`[data-cli-key="${CSS.escape(prox.dataset.cliKey)}"]`)?.focus();
  });
}

// Cartões de conta: abrir itens da base / importar para conta sem base
document.getElementById("bases-contas")?.addEventListener("click", (e) => {
  const abrir = e.target.closest("[data-base-slug]");
  if (abrir) {
    if (String(abrir.dataset.baseSlug) === String(BASE_SEL)) return;
    BASE_SEL = abrir.dataset.baseSlug;
    renderPainelCliente();
    document.getElementById("bases-drawer")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    return;
  }
  const imp = e.target.closest("[data-import-conta]");
  if (imp) abrirModalImportar(imp.dataset.importMp, null, { clienteId: imp.dataset.importCliente, contaId: imp.dataset.importConta });
});

// Abrir modal de importação
document.getElementById("btn-abrir-importar")?.addEventListener("click", () => abrirModalImportar());
document.querySelectorAll("[data-import-open]").forEach((b) => b.addEventListener("click", () => abrirModalImportar()));
document.querySelectorAll(".mp-action[data-import-mp]").forEach((b) => b.addEventListener("click", () => abrirModalImportar(b.dataset.importMp)));
document.getElementById("bases-import-close")?.addEventListener("click", fecharModalImportar);
document.getElementById("bases-import-cancel")?.addEventListener("click", fecharModalImportar);
document.getElementById("bases-import-backdrop")?.addEventListener("click", (e) => {
  if (e.target?.id === "bases-import-backdrop") fecharModalImportar();
});

// Toggle do assistente dentro do modal
document.getElementById("bases-assist-toggle")?.addEventListener("click", () => {
  const c = document.getElementById("bases-assist-collapse");
  if (c) c.classList.toggle("is-open");
});

// Ações da seção de itens: adicionar item / atualizar por planilha (dentro do drawer)
document.getElementById("bases-drawer-add")?.addEventListener("click", () => abrirFormularioItem(null));
document.getElementById("bases-drawer-planilha")?.addEventListener("click", abrirPainelPlanilha);

// Fechar menus "⋯" ao clicar fora
document.addEventListener("click", (e) => {
  if (!e.target.closest(".b-menu")) fecharTodosMenus();
});
// Esc fecha menus, painel de custo, drawer e modal de importação
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  fecharTodosMenus();
  // Se um painel de edição/planilha está aberto no drawer, Esc fecha só o painel.
  const panel = document.getElementById("bases-cost-panel");
  if (panel && panel.style.display !== "none" && panel.innerHTML.trim()) { fecharPainelCusto(); return; }
  const importBackdrop = document.getElementById("bases-import-backdrop");
  if (importBackdrop && importBackdrop.classList.contains("is-open")) fecharModalImportar();
});

// ─── Retry ───
document.getElementById("btn-retry").addEventListener("click", loadBases);

// Modal excluir base
document.getElementById("vf-excluir-base-close")?.addEventListener("click", fecharModalExcluirBase);
document.getElementById("vf-excluir-base-cancel")?.addEventListener("click", fecharModalExcluirBase);
document.getElementById("vf-excluir-base-confirm")?.addEventListener("click", confirmarExclusaoBase);
document.getElementById("vf-excluir-base-modal")?.addEventListener("click", (e) => {
  if (e.target?.id === "vf-excluir-base-modal") fecharModalExcluirBase();
});
document.getElementById("vf-vinculo-base-close")?.addEventListener("click", fecharModalVinculo);
document.getElementById("vf-vinculo-base-cancel")?.addEventListener("click", fecharModalVinculo);
document.getElementById("vf-vinculo-base-save")?.addEventListener("click", salvarVinculoBase);
document.getElementById("vf-vinculo-base-modal")?.addEventListener("click", (e) => {
  if (e.target?.id === "vf-vinculo-base-modal") fecharModalVinculo();
});
document.addEventListener("keydown", (e) => {
  const modalExcluir = document.getElementById("vf-excluir-base-modal");
  const modalVinculo = document.getElementById("vf-vinculo-base-modal");
  if (e.key !== "Escape") return;
  if (modalVinculo && modalVinculo.classList.contains("is-open")) fecharModalVinculo();
  if (modalExcluir && modalExcluir.classList.contains("is-open")) fecharModalExcluirBase();
});

// ─── Init ───
if (TOKEN) loadBases();

// ══════════════════════════════════════════════════════════════════════════════
// ─── ASSISTENTE DE BASE ───────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

// ── Estado ────────────────────────────────────────────────────────────────────
let asstUltimoArquivo = null;
let asstUltimosDados  = null;

// ── Helpers de status e loading ───────────────────────────────────────────────
function asstSetStatus(msg, tipo) {
  const el = document.getElementById("asst-status");
  if (!el) return;
  el.textContent = msg || "";
  el.className = "asst-status-msg" + (tipo ? ` asst-status-${tipo}` : "");
  el.style.display = msg ? "block" : "none";
}

function asstSetLoading(on) {
  const btn = document.getElementById("asst-btn-preview");
  const txt = document.getElementById("asst-btn-text");
  const spn = document.getElementById("asst-btn-spinner");
  if (btn) btn.disabled = on;
  if (txt) txt.textContent = on ? "Analisando…" : "Analisar planilha";
  if (spn) spn.style.display = on ? "inline-block" : "none";
}

function asstSetReanaliseLoading(on) {
  const btn = document.getElementById("asst-btn-reanalisar");
  const txt = document.getElementById("asst-btn-reanalisar-text");
  const spn = document.getElementById("asst-btn-reanalisar-spinner");
  if (btn) btn.disabled = on;
  if (txt) txt.textContent = on ? "Analisando…" : "Reanalisar com colunas selecionadas";
  if (spn) spn.style.display = on ? "inline-block" : "none";
}

function asstReset() {
  asstSetStatus("", "");
  asstUltimosDados = null;
  const el = document.getElementById("asst-preview");
  if (el) { el.innerHTML = ""; el.style.display = "none"; }
  const sec = document.getElementById("asst-import-section");
  if (sec) sec.style.display = "none";
  asstSetImportStatus("", "");
}

// ── Dropzone ──────────────────────────────────────────────────────────────────
function asstValidarExtensao(file) {
  const n = String(file && file.name || "").toLowerCase();
  return n.endsWith(".xlsx") || n.endsWith(".xls") || n.endsWith(".csv");
}

function asstMostrarArquivoDropzone(file) {
  const idle     = document.getElementById("asst-dz-idle");
  const fileEl   = document.getElementById("asst-dz-file");
  const filename = document.getElementById("asst-dz-filename");
  const dz       = document.getElementById("asst-dropzone");
  if (idle)     idle.style.display   = "none";
  if (fileEl)   fileEl.style.display = "flex";
  if (filename) filename.textContent = file ? file.name : "—";
  if (dz)       dz.classList.add("asst-dz-has-file");
}

function asstLimparDropzone() {
  const input = document.getElementById("asst-arquivo");
  const idle  = document.getElementById("asst-dz-idle");
  const fileEl = document.getElementById("asst-dz-file");
  const dz    = document.getElementById("asst-dropzone");
  if (input) { try { input.value = ""; } catch (_) {} }
  if (idle)   idle.style.display   = "";
  if (fileEl) fileEl.style.display = "none";
  if (dz)     dz.classList.remove("asst-dz-has-file", "asst-dz-active");
  asstUltimoArquivo = null;
  asstReset();
}

function asstDefinirArquivo(file) {
  if (!file) return;
  try {
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = document.getElementById("asst-arquivo");
    if (input) input.files = dt.files;
  } catch (_) {}
  asstUltimoArquivo = file;
  asstMostrarArquivoDropzone(file);
  asstReset();
}

(function asstInitDropzone() {
  const dz       = document.getElementById("asst-dropzone");
  const input    = document.getElementById("asst-arquivo");
  const clearBtn = document.getElementById("asst-dz-clear");
  if (!dz || !input) return;

  dz.addEventListener("click", (e) => {
    if (e.target.closest("#asst-dz-clear")) return;
    input.click();
  });
  dz.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); }
  });
  input.addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    if (!asstValidarExtensao(f)) { asstSetStatus("Formato inválido. Envie .xlsx, .xls ou .csv.", "erro"); return; }
    asstUltimoArquivo = f;
    asstMostrarArquivoDropzone(f);
    asstReset();
  });
  ["dragenter", "dragover"].forEach((evt) => {
    dz.addEventListener(evt, (e) => { e.preventDefault(); e.stopPropagation(); dz.classList.add("asst-dz-active"); });
  });
  ["dragleave", "dragend"].forEach((evt) => {
    dz.addEventListener(evt, (e) => { if (!dz.contains(e.relatedTarget)) dz.classList.remove("asst-dz-active"); });
  });
  dz.addEventListener("drop", (e) => {
    e.preventDefault(); e.stopPropagation();
    dz.classList.remove("asst-dz-active");
    const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
    if (!files.length) return;
    const file = files[0];
    if (!asstValidarExtensao(file)) { asstSetStatus("Formato inválido. Envie .xlsx, .xls ou .csv.", "erro"); return; }
    asstDefinirArquivo(file);
  });
  if (clearBtn) {
    clearBtn.addEventListener("click", (e) => { e.stopPropagation(); asstLimparDropzone(); });
  }
})();

// ── Confiança ─────────────────────────────────────────────────────────────────
function asstConfiancaClass(score) {
  if (score === null || score === undefined) return "asst-conf-none";
  if (score >= 80) return "asst-conf-high";
  if (score >= 60) return "asst-conf-med";
  return "asst-conf-low";
}

// ── Selects de colunas manuais ────────────────────────────────────────────────
function asstBuildSelectOptions(disponiveis, valorAtual) {
  const opts = ['<option value="">— Selecionar manualmente —</option>'];
  (Array.isArray(disponiveis) ? disponiveis : []).forEach((c) => {
    const v   = escapeHTML(String(c.coluna || ""));
    const lbl = escapeHTML(c.coluna + " — " + c.cabecalho);
    const sel = c.coluna === valorAtual ? " selected" : "";
    opts.push(`<option value="${v}"${sel}>${lbl}</option>`);
  });
  return opts.join("");
}

function asstRenderSelects(disponiveis, detectadas, isTiktok) {
  const valId      = (detectadas && detectadas.id      && detectadas.id.coluna)      || "";
  const valSkuId   = (detectadas && detectadas.sku_id  && detectadas.sku_id.coluna)  || "";
  const valCusto   = (detectadas && detectadas.custo   && detectadas.custo.coluna)   || "";
  const valImposto = (detectadas && detectadas.imposto && detectadas.imposto.coluna) || "";

  // TikTok: a coluna obrigatória é ID DO SKU. A coluna ID (produto) é opcional.
  const alertaId = !valId && !isTiktok
    ? `<div class="asst-select-alerta">Não foi possível detectar a coluna de ID — selecione manualmente e reanalise.</div>`
    : "";
  const alertaSkuId = isTiktok && !valSkuId
    ? `<div class="asst-select-alerta">Não foi possível detectar a coluna "ID DO SKU" — ela é obrigatória no TikTok. Selecione manualmente e reanalise.</div>`
    : "";

  const selectSkuId = isTiktok ? `
        <div class="asst-select-item${!valSkuId ? " asst-select-item-needed" : ""}">
          <label class="asst-select-label" for="asst-sel-sku-id">Coluna de ID DO SKU</label>
          ${alertaSkuId}
          <select id="asst-sel-sku-id" class="vf-input asst-select">
            ${asstBuildSelectOptions(disponiveis, valSkuId)}
          </select>
        </div>` : "";

  return `
    <div class="asst-result-section asst-manual-section">
      <div class="asst-section-title">Ajuste de colunas</div>
      <div class="asst-selects-grid">
        <div class="asst-select-item${!valId && !isTiktok ? " asst-select-item-needed" : ""}">
          <label class="asst-select-label" for="asst-sel-id">${isTiktok ? "Coluna de ID (produto)" : "Coluna de ID"}</label>
          ${alertaId}
          <select id="asst-sel-id" class="vf-input asst-select">
            ${asstBuildSelectOptions(disponiveis, valId)}
          </select>
        </div>
        ${selectSkuId}
        <div class="asst-select-item">
          <label class="asst-select-label" for="asst-sel-custo">Coluna de Custo</label>
          <select id="asst-sel-custo" class="vf-input asst-select">
            ${asstBuildSelectOptions(disponiveis, valCusto)}
          </select>
        </div>
        <div class="asst-select-item">
          <label class="asst-select-label" for="asst-sel-imposto">Coluna de Imposto</label>
          <select id="asst-sel-imposto" class="vf-input asst-select">
            ${asstBuildSelectOptions(disponiveis, valImposto)}
          </select>
        </div>
      </div>
      <div style="margin-top:14px;display:flex;justify-content:flex-end;">
        <button id="asst-btn-reanalisar" onclick="asstReanalisar()" class="vf-btn-secondary" style="width:auto;margin:0;">
          <span id="asst-btn-reanalisar-text">Reanalisar com colunas selecionadas</span>
          <span id="asst-btn-reanalisar-spinner" class="btn-spinner" style="display:none;"></span>
        </button>
      </div>
    </div>`;
}

// ── Render principal ──────────────────────────────────────────────────────────
function asstRenderColunas(colunas, isTiktok) {
  const tipos  = isTiktok ? ["id", "sku_id", "custo", "imposto"] : ["id", "custo", "imposto"];
  const labels = { id: "ID", sku_id: "ID DO SKU", custo: "Custo", imposto: "Imposto" };
  return tipos.map((t) => {
    const c = colunas && colunas[t];
    if (!c) {
      return `<div class="asst-col-item asst-col-missing">
        <span class="asst-col-label">${labels[t]}</span>
        <span class="asst-col-not-found">Não detectado</span>
      </div>`;
    }
    const cls = asstConfiancaClass(c.confianca);
    return `<div class="asst-col-item">
      <span class="asst-col-label">${labels[t]}</span>
      <span class="asst-col-value"><strong>${escapeHTML(String(c.coluna || "—"))}</strong>&nbsp;—&nbsp;${escapeHTML(String(c.cabecalho || "—"))}</span>
      <span class="asst-conf-badge ${cls}">${c.confianca != null ? c.confianca + "%" : "—"}</span>
    </div>`;
  }).join("");
}

function asstRenderAlertas(alertas) {
  if (!Array.isArray(alertas) || !alertas.length) return "";
  return alertas.map((a) => {
    const cls = a.nivel === "erro"    ? "asst-alerta-erro"
              : a.nivel === "warning" ? "asst-alerta-warning"
              : a.nivel === "aviso"   ? "asst-alerta-aviso"
              : "asst-alerta-info";
    return `<div class="asst-alerta-item ${cls}">${escapeHTML(String(a.mensagem || ""))}</div>`;
  }).join("");
}

function asstRenderPreview(data) {
  const el = document.getElementById("asst-preview");
  if (!el) return;

  const resumo      = data.resumo   || {};
  const alertas     = data.alertas  || [];
  const rows        = Array.isArray(data.preview) ? data.preview : [];
  const disponiveis = Array.isArray(data.colunas_disponiveis) ? data.colunas_disponiveis : [];
  const isTiktokAsst = normalizarMarketplaceKey(data.marketplace) === "tiktok";

  // ── Resumo cards ──
  const summaryCards = [
    { label: "Linhas lidas",       value: resumo.linhas_lidas        != null ? resumo.linhas_lidas        : "—" },
    { label: "Linhas válidas",     value: resumo.linhas_validas      != null ? resumo.linhas_validas      : "—" },
    { label: "Importáveis",        value: resumo.linhas_importaveis  != null ? resumo.linhas_importaveis  : "—" },
    { label: "Ignoradas",          value: resumo.linhas_ignoradas    != null ? resumo.linhas_ignoradas    : "—" },
    { label: "Duplicados",         value: resumo.duplicados          != null ? resumo.duplicados          : "—" },
  ].map((c) => `
    <div class="asst-summary-card">
      <div class="asst-summary-label">${escapeHTML(String(c.label))}</div>
      <div class="asst-summary-value">${escapeHTML(String(c.value))}</div>
    </div>`).join("");

  // ── Detecção strip ──
  const linhaExibida = data.linha_cabecalho != null ? data.linha_cabecalho + 1 : "—";
  const confianca    = data.confianca_geral != null ? data.confianca_geral + "%" : "—";
  const detecHtml = `
    <div class="asst-detec-info">
      <span><strong>Aba:</strong> ${escapeHTML(String(data.aba_detectada || "—"))}</span>
      <span><strong>Cabeçalho na linha:</strong> ${linhaExibida}</span>
      <span><strong>Confiança geral:</strong> ${confianca}</span>
    </div>`;

  // ── Alertas ──
  const alertasRendered = asstRenderAlertas(alertas);
  const alertasHtml = alertasRendered
    ? `<div class="asst-result-section">
        <div class="asst-section-title">Alertas</div>
        <div class="asst-alertas-wrap">${alertasRendered}</div>
       </div>`
    : "";

  // ── Tabela de preview ──
  let tableHtml = "";
  if (rows.length) {
    const tbody = rows.map((r, i) => {
      const custo   = r.custo   != null ? Number(r.custo).toFixed(2)              : "—";
      const imposto = r.imposto != null ? (Number(r.imposto) * 100).toFixed(2) + "%" : "—";
      const skuIdTd = isTiktokAsst
        ? `<td style="font-family:var(--vf-mono);font-size:.8rem;">${escapeHTML(String(r.sku_id || "—"))}</td>`
        : "";
      return `<tr>
        <td style="color:var(--vf-text-l);font-family:var(--vf-mono);font-size:.8rem;">${i + 1}</td>
        <td style="font-family:var(--vf-mono);font-size:.8rem;">${escapeHTML(String(r.id || "—"))}</td>
        ${skuIdTd}
        <td style="text-align:right;">${escapeHTML(custo)}</td>
        <td style="text-align:right;">${escapeHTML(imposto)}</td>
      </tr>`;
    }).join("");
    tableHtml = `
      <div class="asst-preview-table-wrap">
        <div class="asst-preview-table-title">Prévia — até 50 linhas (${rows.length} exibida${rows.length !== 1 ? "s" : ""})</div>
        <table class="vf-table">
          <thead>
            <tr>
              <th style="width:40px;">#</th>
              <th>ID</th>
              ${isTiktokAsst ? `<th>ID DO SKU</th>` : ""}
              <th style="text-align:right;width:120px;">Custo (R$)</th>
              <th style="text-align:right;width:120px;">Imposto</th>
            </tr>
          </thead>
          <tbody>${tbody}</tbody>
        </table>
      </div>`;
  } else {
    tableHtml = `<div class="asst-empty-preview">Nenhuma linha válida encontrada na prévia.</div>`;
  }

  el.innerHTML = `
    <div class="vf-assistente-base-result">
      <div class="asst-result-section">
        <div class="asst-section-title">Resumo da análise</div>
        <div class="asst-summary-grid">${summaryCards}</div>
        ${detecHtml}
      </div>
      <div class="asst-result-section">
        <div class="asst-section-title">Colunas detectadas</div>
        <div class="asst-colunas-grid">${asstRenderColunas(data.colunas_detectadas, isTiktokAsst)}</div>
      </div>
      ${asstRenderSelects(disponiveis, data.colunas_detectadas, isTiktokAsst)}
      ${alertasHtml}
      ${tableHtml}
    </div>`;

  el.style.display = "block";

  const importSec = document.getElementById("asst-import-section");
  if (importSec) importSec.style.display = "block";
  asstAtualizarBotaoImportar();
}

// ── Reanálise ─────────────────────────────────────────────────────────────────
async function asstReanalisar() {
  const selId      = ((document.getElementById("asst-sel-id")      || {}).value || "").trim();
  const selSkuId   = ((document.getElementById("asst-sel-sku-id")  || {}).value || "").trim();
  const selCusto   = ((document.getElementById("asst-sel-custo")   || {}).value || "").trim();
  const selImposto = ((document.getElementById("asst-sel-imposto") || {}).value || "").trim();

  const config = { colunas: {} };
  if (selId)      config.colunas.id      = selId;
  if (selSkuId)   config.colunas.sku_id  = selSkuId;
  if (selCusto)   config.colunas.custo   = selCusto;
  if (selImposto) config.colunas.imposto = selImposto;

  // Preservar aba e linha detectadas na análise anterior
  if (asstUltimosDados) {
    if (asstUltimosDados.aba_detectada)       config.aba             = asstUltimosDados.aba_detectada;
    if (asstUltimosDados.linha_cabecalho != null) config.linhaCabecalho = asstUltimosDados.linha_cabecalho;
  }

  await asstEnviarPreview(config);
}

// ── Envio principal ───────────────────────────────────────────────────────────
async function asstEnviarPreview(configOverride) {
  const fileInput = document.getElementById("asst-arquivo");
  const arquivo   = asstUltimoArquivo || (fileInput && fileInput.files && fileInput.files[0]);

  asstSetStatus("", "");

  if (!arquivo) {
    asstSetStatus("Selecione um arquivo .xlsx, .xls ou .csv.", "erro");
    return;
  }
  if (!asstValidarExtensao(arquivo)) {
    asstSetStatus("Formato inválido. Envie .xlsx, .xls ou .csv.", "erro");
    return;
  }

  const isReanalisar = !!configOverride;
  if (isReanalisar) {
    asstSetReanaliseLoading(true);
  } else {
    asstSetLoading(true);
    const el = document.getElementById("asst-preview");
    if (el) { el.innerHTML = ""; el.style.display = "none"; }
    const importSec = document.getElementById("asst-import-section");
    if (importSec) importSec.style.display = "none";
    asstSetImportStatus("", "");
  }

  try {
    const fd = new FormData();
    fd.append("arquivo", arquivo);
    // O assistente vive dentro do modal de importação: segue o marketplace já
    // escolhido ali. Sem isso um ID do TikTok receberia prefixo MLB no preview.
    const mpSelecionado = getImportMarketplace();
    if (mpSelecionado) fd.append("marketplace", mpSelecionado);
    if (configOverride && Object.keys(configOverride).length) {
      fd.append("config", JSON.stringify(configOverride));
    }

    const res = await fetch(`${API_BASE}/bases/assistente/preview`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}` },
      body: fd,
    });

    if (res.status === 401) { clearSession(); return; }

    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.ok) {
      asstSetStatus(data.erro || `Erro ${res.status} ao analisar a planilha.`, "erro");
      return;
    }

    asstUltimoArquivo = arquivo;
    asstUltimosDados  = data;
    asstRenderPreview(data);

  } catch (err) {
    asstSetStatus("Erro de conexão: " + (err.message || "tente novamente."), "erro");
  } finally {
    asstSetLoading(false);
    asstSetReanaliseLoading(false);
  }
}

// ── Baixar base existente ─────────────────────────────────────────────────────
async function asstBaixarBase(slug, nome, btn) {
  const textoOriginal = btn ? btn.textContent : "";
  if (btn) { btn.disabled = true; btn.textContent = "Aguarde…"; }

  try {
    const res = await fetch(`${API_BASE}/bases/${encodeURIComponent(slug)}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    if (res.status === 401) { clearSession(); return; }
    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.ok) {
      vfAvisar("Erro ao buscar base", data.erro || `HTTP ${res.status}`);
      return;
    }

    const dados = data.dados || {};
    const entradas = Object.entries(dados);
    if (!entradas.length) {
      vfAvisar(`A base "${nome}" não tem itens para baixar`, "Cadastre custos nela antes de exportar.", "warning");
      return;
    }

    // TikTok baixa no contrato canônico ID | ID DO SKU | CUSTO | IMPOSTO, para
    // que o arquivo baixado possa ser reimportado sem edição.
    const isTiktokDownload = normalizarMarketplaceKey(data.marketplace) === "tiktok";
    const isShopeeDownload = normalizarMarketplaceKey(data.marketplace) === "shopee";
    const csvTexto = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const linhas = entradas.map(([chave, v]) => {
      const custo   = v.custo_produto   != null ? Number(v.custo_produto).toFixed(2)  : "";
      const imposto = v.imposto_percentual != null ? Number(v.imposto_percentual).toFixed(6) : "";
      if (isTiktokDownload) {
        return `${csvTexto(v.produto_id ?? "")},${csvTexto(v.sku_id ?? chave)},${custo},${imposto}`;
      }
      // Shopee (FIN-508): com o Model, o arquivo baixado reimporta as variações.
      if (isShopeeDownload) {
        return `${csvTexto(v.produto_id ?? chave)},${csvTexto(v.id_model ?? "")},${custo},${imposto}`;
      }
      return `${csvTexto(v.produto_id ?? chave)},${custo},${imposto}`;
    });
    const cabecalhoCsv = isTiktokDownload
      ? "ID,ID DO SKU,CUSTO,IMPOSTO\n"
      : isShopeeDownload ? "ID,ID Model,Custo,Imposto\n" : "ID,Custo,Imposto\n";
    const csv = cabecalhoCsv + linhas.join("\n");

    const nomeArquivo = "base-" + String(slug || nome).replace(/[^a-z0-9_\-]/gi, "_") + ".csv";
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = nomeArquivo;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    vfAvisar("Erro ao baixar base", err.message || "Tente novamente.");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = textoOriginal; }
  }
}

// ── Importação final ──────────────────────────────────────────────────────────
function asstSetImportStatus(msg, tipo) {
  const el = document.getElementById("asst-import-status");
  if (!el) return;
  el.textContent = msg || "";
  el.className = "asst-status-msg" + (tipo ? ` asst-status-${tipo}` : "");
  el.style.display = msg ? "block" : "none";
}

function asstSetImportLoading(on) {
  const btn = document.getElementById("asst-btn-importar-limpa");
  const txt = document.getElementById("asst-btn-importar-text");
  const spn = document.getElementById("asst-btn-importar-spinner");
  if (btn) btn.disabled = on;
  if (txt) txt.textContent = on ? "Importando…" : "Importar base limpa";
  if (spn) spn.style.display = on ? "inline-block" : "none";
}

function asstAtualizarBotaoImportar() {
  const btn = document.getElementById("asst-btn-importar-limpa");
  if (!btn) return;
  const nome = (document.getElementById("asst-nome-base") || {}).value || "";
  const temDados = asstUltimosDados &&
    Array.isArray(asstUltimosDados.dados_importacao) &&
    asstUltimosDados.dados_importacao.length > 0;
  btn.disabled = !(temDados && nome.trim().length > 0);
}

function asstGerarCsv(linhas, marketplace) {
  const csvTexto = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

  // TikTok: contrato canônico ID | ID DO SKU | CUSTO | IMPOSTO. A identidade da
  // linha é o ID DO SKU (sku_id) — linha sem ele não é importável.
  if (marketplace === "tiktok") {
    const lines = linhas
      .filter(r => r.sku_id != null && String(r.sku_id).trim() !== "")
      .map(r => {
        const custo   = r.custo   != null ? Number(r.custo).toFixed(2)  : "";
        const imposto = r.imposto != null ? Number(r.imposto).toFixed(6) : "";
        return `${csvTexto(r.id)},${csvTexto(r.sku_id)},${custo},${imposto}`;
      });
    return "ID,ID DO SKU,CUSTO,IMPOSTO\n" + lines.join("\n");
  }

  const rows = linhas.filter(r => r.id != null && String(r.id).trim() !== "");
  // Shopee (FIN-508): o Model ID é a identidade da variação — sem a coluna, o
  // /importar-base gravaria cada Item uma vez só e perderia as variações.
  if (marketplace === "shopee") {
    const lines = rows.map(r => {
      const custo   = r.custo   != null ? Number(r.custo).toFixed(2)   : "";
      const imposto = r.imposto != null ? Number(r.imposto).toFixed(6)  : "";
      return `${csvTexto(r.id)},${csvTexto(r.id_model ?? "")},${custo},${imposto}`;
    });
    return "ID,ID Model,Custo,Imposto\n" + lines.join("\n");
  }
  const lines = rows.map(r => {
    const custo   = r.custo   != null ? Number(r.custo).toFixed(2)   : "";
    const imposto = r.imposto != null ? Number(r.imposto).toFixed(6)  : "";
    return `${csvTexto(r.id)},${custo},${imposto}`;
  });
  return "ID,Custo,Imposto\n" + lines.join("\n");
}

async function asstImportarBaseLimpa() {
  if (!asstUltimosDados) return;

  const nome = ((document.getElementById("asst-nome-base") || {}).value || "").trim();
  if (!nome) {
    asstSetImportStatus("Informe o nome da base antes de importar.", "erro");
    return;
  }

  if (!Array.isArray(asstUltimosDados.dados_importacao) || !asstUltimosDados.dados_importacao.length) {
    asstSetImportStatus("Não foi possível carregar todas as linhas normalizadas. Reanalise a planilha.", "erro");
    return;
  }

  const linhasImportaveis = asstUltimosDados.dados_importacao;

  // Respeita o marketplace escolhido no modal — importar como "meli" por
  // padrão prefixaria MLB em IDs de Shopee/TikTok.
  const marketplace = getImportMarketplace() || "meli";
  const clienteId = (document.getElementById("import-cliente") || {}).value || "";
  const contaId   = (document.getElementById("import-conta") || {}).value || "";

  // O Assistente é só um parser alternativo — usa o MESMO comando atômico e
  // a MESMA regra de conta do fluxo padrão (achado P0 da auditoria: o
  // Assistente tinha um segundo caminho de importação que não exigia nem
  // executava vínculo de conta para ML).
  if (marketplaceExigeConta(marketplace) && !contaId) {
    asstSetImportStatus(`Selecione a conta ${marketplaceLabel(marketplace)} no campo acima antes de importar.`, "erro");
    return;
  }

  const confirmou = await vfConfirmar({
    title: `Importar "${nome}"?`,
    message: `${linhasImportaveis.length} linha(s) normalizada(s).\n\nSe já existir uma base com este nome, a importação será recusada — nada é substituído.`,
    confirmLabel: "Importar base",
  });
  if (!confirmou) return;

  asstSetImportLoading(true);
  asstSetImportStatus("", "");

  try {
    const csv      = asstGerarCsv(linhasImportaveis, marketplace);
    const blob     = new Blob([csv], { type: "text/csv" });
    const arquivo  = new File([blob], `${nome.replace(/[^a-z0-9_\-]/gi, "_")}.csv`, { type: "text/csv" });

    const fd = new FormData();
    fd.append("arquivo",   arquivo);
    fd.append("nomeBase",  nome);
    fd.append("marketplace", marketplace);
    fd.append("confirmar", "true");
    if (clienteId) fd.append("cliente_id", clienteId);
    if (contaId) fd.append("cliente_conta_id", contaId);

    const res = await fetch(`${API_BASE}/importar-base`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}` },
      body: fd,
    });

    if (res.status === 401) { clearSession(); return; }

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      asstSetImportStatus(mensagemErroImportacao(data) || `Erro ${res.status} ao importar.`, "erro");
      return;
    }

    asstSetImportStatus(`Base "${nome}" importada${data.vinculo ? " e vinculada" : ""} com sucesso!`, "ok");
    loadBases();

  } catch (err) {
    asstSetImportStatus("Erro de conexão: " + (err.message || "tente novamente."), "erro");
  } finally {
    asstSetImportLoading(false);
  }
}

(function asstInitImportacao() {
  const input = document.getElementById("asst-nome-base");
  if (input) input.addEventListener("input", asstAtualizarBotaoImportar);

  const btn = document.getElementById("asst-btn-importar-limpa");
  if (btn) btn.addEventListener("click", asstImportarBaseLimpa);
})();

// ── Botão analisar ────────────────────────────────────────────────────────────
(function () {
  const btn = document.getElementById("asst-btn-preview");
  if (btn) btn.addEventListener("click", () => asstEnviarPreview());
})();


// ── Confirmação e aviso da Fundação (Portal/vf-ui.js) ──────────────────────
// Modal e toast da V2 no lugar de confirm()/alert() do navegador. Sem o
// vf-ui.js (página antiga em cache, sandbox de teste) cai no nativo, com o
// mesmo texto.
function vfConfirmar(opcoes) {
  if (window.VF && typeof window.VF.confirm === "function") return window.VF.confirm(opcoes);
  return Promise.resolve(window.confirm([opcoes.title, opcoes.message].filter(Boolean).join("\n\n")));
}

function vfAvisar(titulo, descricao, tom) {
  if (window.VF && typeof window.VF.toast === "function") {
    window.VF.toast({ title: titulo, description: descricao, tone: tom || "danger" });
    return;
  }
  window.alert(descricao ? titulo + "\n\n" + descricao : titulo);
}
