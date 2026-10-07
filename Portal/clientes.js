const STORAGE_KEY = "vf-token";
const API_BASE = "https://venforce-server.onrender.com";

function getToken() {
  const t = localStorage.getItem(STORAGE_KEY);
  if (!t) { window.location.replace("index.html"); return null; }
  return t;
}
const TOKEN = getToken();
const user = JSON.parse(localStorage.getItem("vf-user") || "{}");
// Clientes e Contas passou a ser tela de TODOS os usuários internos (antes
// redirecionava não-admin para a Carteira). Sem mudar backend nenhum:
//   - admin    → GET /clientes (todos) + todas as ações, como sempre;
//   - os demais → a própria carteira (GET /me/portfolio, filtrada por
//     Squad no servidor) e as contas via GET /clientes/:slug/contas, que já
//     é liberado para admin/user/membro com gate de carteira. Toda mutação
//     (criar/remover cliente, criar conta, base, grant, ativar…) continua
//     requireAdmin no backend — então a UI simplesmente não as oferece a
//     quem não é admin, em vez de deixar o clique cair num 403. Exceção:
//     Conectar/Reconectar e "Copiar link de conexão" do Mercado Livre são
//     para todos (rota pública; ver acoesConexaoMl).
// Persona seller continua sendo desviada pelo Shell V3 para seller.html.
const IS_ADMIN = String(user.role || "").toLowerCase() === "admin";
initLayout();

const { diagnosticarConta, diagnosticarCliente } = window.VF_CLIENTES_CONTAS_RESUMO;

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

// Mesma regra de Portal/squads-config.js: squad "Legado" é reconhecido pelo
// slug, não por um campo dedicado.
function isLegado(squad) {
  return String(squad.slug || "").includes("legado");
}

let SQUADS_ATIVOS = [];

// Link account-scoped (Fundação de Contas): identifica a cliente_conta
// específica, nunca o cliente genérico — necessário para diferenciar
// ML1/ML2/ML3 do mesmo cliente. O link legado /ml/conectar/:clienteSlug
// continua existindo no backend por compatibilidade, mas /clientes.html
// usa exclusivamente este.
function getMlConectarContaLink(contaId) {
  return `${API_BASE}/ml/conectar-conta/${contaId}`;
}

async function copiarLinkConta(link, btn) {
  try {
    await navigator.clipboard.writeText(link);
  } catch (err) {
    setClientesFeedback(`Não foi possível copiar automaticamente. Link: ${link}`, "danger");
    return;
  }
  // Vindo do menu "⋯", o botão é só um ícone: o retorno vai para o banner.
  if (!btn || btn.classList.contains("vf-btn--icon")) {
    setClientesFeedback("Link de conexão copiado. Envie para o cliente autorizar a conta no Mercado Livre.", "success");
    return;
  }
  const original = btn.textContent;
  btn.textContent = "✓ Link copiado";
  setTimeout(() => { btn.textContent = original; }, 1800);
}

// Acentos viram a letra base ("Eletrônico" → "eletronico") em vez de sumir.
function slugify(nome) {
  return String(nome || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
}

const stateLoading = document.getElementById("state-loading");
const stateLayout = document.getElementById("clientes-layout");
const stateEmpty = document.getElementById("state-empty");
const stateError = document.getElementById("state-error");
const clientesCount = document.getElementById("clientes-count");
const clientesLista = document.getElementById("clientes-lista");
const clientesListaVazia = document.getElementById("clientes-lista-vazia");
const clientesFiltros = document.getElementById("clientes-filtros");
const clientesDetalhe = document.getElementById("clientes-detalhe");
const clientesFeedback = document.getElementById("clientes-feedback");

let CLIENTES_LISTA = [];
let CLIENTES_CONFIRM_OPEN = false;
let CLIENTES_CONFIRM_ACTION = null;
let CLIENTES_CONFIRM_LABEL = "Confirmar";
let BASE_PICKER_CONTA = null; // conta sendo editada no modal "Definir/Trocar base"

// Estado da tela (lista + painel).
const CONTAS_POR_CLIENTE = new Map(); // slug -> { estado: 'carregando'|'ok'|'erro', contas, erro }
let SELECIONADO = null;               // slug do cliente aberto no painel
let FILTRO = "todos";                 // 'todos' | 'atencao' | 'sem_contas'
let RECARREGAR_AO_VOLTAR = null;      // slug cujo grant pode ter mudado numa aba de conexão ML

const MARKETPLACES = [
  { key: "meli", label: "Mercado Livre", sigla: "ML" },
  { key: "shopee", label: "Shopee", sigla: "SH" },
  { key: "tiktok", label: "TikTok Shop", sigla: "TT" },
];

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
  CLIENTES_CONFIRM_LABEL = confirmLabel || "Confirmar";

  t.textContent = title || "Confirmar";
  if (sub) sub.textContent = subtitle || "";
  desc.textContent = description || "";

  ok.textContent = CLIENTES_CONFIRM_LABEL;
  ok.classList.remove("vf-btn--secondary", "vf-btn--danger", "vf-btn--primary");
  ok.classList.add(danger ? "vf-btn--danger" : "vf-btn--primary");

  if (dangerBox) { dangerBox.style.display = "none"; dangerBox.textContent = ""; }
  modal.classList.add("is-open");
}

function fecharModalConfirmacaoClientes() {
  document.getElementById("vf-clientes-confirm-modal")?.classList.remove("is-open");
  CLIENTES_CONFIRM_OPEN = false;
  CLIENTES_CONFIRM_ACTION = null;
}

async function confirmarModalClientes() {
  const ok = document.getElementById("vf-clientes-confirm-ok");
  const dangerBox = document.getElementById("vf-clientes-confirm-danger");
  if (!CLIENTES_CONFIRM_ACTION) return;

  if (dangerBox) { dangerBox.style.display = "none"; dangerBox.textContent = ""; }
  if (ok) { ok.disabled = true; ok.textContent = "Processando…"; }

  try {
    await CLIENTES_CONFIRM_ACTION();
    fecharModalConfirmacaoClientes();
  } catch (err) {
    const msg = err?.message || "Não foi possível concluir a ação.";
    const dependencias = err?.dependencias;
    if (dangerBox) {
      dangerBox.style.display = "block";
      if (dependencias?.length) {
        const itens = dependencias.map((d) => `• ${d.label}: ${d.total}`).join("\n");
        dangerBox.textContent = `${msg}\n\n${itens}`;
      } else {
        dangerBox.textContent = msg;
      }
    } else {
      setClientesFeedback(msg, "danger");
    }
  } finally {
    if (ok) { ok.disabled = false; ok.textContent = CLIENTES_CONFIRM_LABEL; }
  }
}

function mostrarEstado(qual) {
  stateLoading.style.display = qual === "loading" ? "flex" : "none";
  stateEmpty.style.display = qual === "empty" ? "block" : "none";
  stateError.style.display = qual === "error" ? "block" : "none";
  stateLayout.hidden = qual !== "layout";
}
function showLoading() { mostrarEstado("loading"); }
function showEmpty() {
  const desc = document.getElementById("state-empty-desc");
  if (desc) {
    desc.textContent = IS_ADMIN
      ? "Crie o primeiro cliente em “Novo cliente”."
      : "Sua carteira ainda não tem clientes. Fale com o coordenador do seu squad.";
  }
  mostrarEstado("empty");
}
function showError(msg) {
  document.getElementById("error-message").textContent = msg;
  mostrarEstado("error");
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
    err.status = res.status;
    err.code = data?.code;
    err.dependencias = data?.dependencias;
    err.contas = data?.contas;
    throw err;
  }
  return data;
}

// ── CARGA ────────────────────────────────────────────────────────────────

// Admin: GET /clientes (todos, inclusive inativos, já com squad).
// Demais: a carteira do usuário. GET /me/portfolio é a fonte autoritativa por
// Squad; /operacao/cliente-360/clientes é a mesma carteira num payload mais
// pobre (sem squad) e só entra se o servidor implantado ainda não conhece
// /me (404) — mesma regra de queda de vf-shell.js.
async function buscarClientes() {
  if (IS_ADMIN) {
    const data = await apiFetch("/clientes");
    return Array.isArray(data.clientes) ? data.clientes : [];
  }
  let data;
  try {
    data = await apiFetch("/me/portfolio");
  } catch (err) {
    if (err.status !== 404) throw err;
    data = await apiFetch("/operacao/cliente-360/clientes");
  }
  const lista = Array.isArray(data.clientes) ? data.clientes : [];
  return lista.map((c) => ({
    id: c.id,
    nome: c.nome,
    slug: c.slug,
    ativo: c.ativo !== false,
    squad: c.squad ? { id: c.squad.id, nome: c.squad.nome, slug: c.squad.slug } : null,
  }));
}

async function loadClientes({ selecionar } = {}) {
  if (!TOKEN) return;
  showLoading();
  fecharMenuConta();
  CONTAS_POR_CLIENTE.clear();
  try {
    const clientes = await buscarClientes();
    clientes.sort((a, b) => String(a.nome || "").localeCompare(String(b.nome || ""), "pt-BR", { sensitivity: "base" }));
    CLIENTES_LISTA = clientes;
  } catch (err) {
    showError("Não foi possível carregar os clientes. Tente novamente.");
    return;
  }
  if (!CLIENTES_LISTA.length) { showEmpty(); return; }

  const alvo = selecionar || SELECIONADO;
  SELECIONADO = CLIENTES_LISTA.some((c) => c.slug === alvo) ? alvo : CLIENTES_LISTA[0].slug;
  mostrarEstado("layout");
  renderFiltros();
  renderLista();
  renderDetalhe();
  carregarTodasAsContas();
}

// As contas de cada cliente alimentam a saúde na lista e os filtros. O
// cliente aberto vai primeiro; o resto em lotes pequenos para não disparar
// dezenas de requisições ao mesmo tempo.
async function carregarTodasAsContas() {
  const fila = CLIENTES_LISTA.map((c) => c.slug).filter((s) => s && s !== SELECIONADO);
  if (SELECIONADO) await carregarContas(SELECIONADO);
  const LOTE = 6;
  const trabalhar = async () => {
    while (fila.length) {
      const slug = fila.shift();
      if (!CONTAS_POR_CLIENTE.has(slug)) await carregarContas(slug);
    }
  };
  await Promise.all(Array.from({ length: LOTE }, trabalhar));
}

async function carregarContas(slug) {
  if (!slug) return;
  const anterior = CONTAS_POR_CLIENTE.get(slug);
  CONTAS_POR_CLIENTE.set(slug, { estado: "carregando", contas: anterior?.contas || [] });
  try {
    const data = await apiFetch(`/clientes/${encodeURIComponent(slug)}/contas`);
    const contas = Array.isArray(data.contas) ? data.contas : [];
    CONTAS_POR_CLIENTE.set(slug, { estado: "ok", contas });
  } catch (err) {
    CONTAS_POR_CLIENTE.set(slug, { estado: "erro", contas: [], erro: err.message });
  }
  renderFiltros();
  renderLista();
  if (slug === SELECIONADO) renderDetalhe();
}

// Recarrega as contas do cliente aberto depois de qualquer ação (criar conta,
// vincular base, conectar/testar/desconectar grant, ativar/desativar).
async function atualizarAposAcao(slug) {
  await carregarContas(slug);
}

const ROTULO_MARKETPLACE_CONTA = { meli: "Mercado Livre", shopee: "Shopee", tiktok: "TikTok Shop" };
function rotuloMarketplaceConta(marketplace) {
  return ROTULO_MARKETPLACE_CONTA[marketplace] || marketplace;
}

// Remoção de cliente (admin): o que o modal oferece é decidido ANTES,
// checando GET /clientes/:slug/dependencias (nunca "tem certeza?" genérico,
// nunca "não pode, tente de novo" sem alternativa):
//   - Cliente vazio      -> modal simples, hard delete direto.
//   - Cliente c/ histórico -> abrirModalRemoverComDependencias(): admin
//     escolhe entre "Remover da operação" (PATCH .../desativar, preserva
//     tudo) e "Excluir permanentemente" (2ª confirmação obrigatória —
//     digitar nome/slug — antes do DELETE com purge real).
async function abrirModalRemoverCliente(btn) {
  const slug = btn.getAttribute("data-slug") || "";
  if (!slug) return;
  const cliente = CLIENTES_LISTA.find((c) => c.slug === slug);
  const nomeCliente = cliente?.nome || slug;
  const squadLabel = cliente?.squad ? cliente.squad.nome : "Sem Squad";

  const textoOriginal = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Verificando…";
  let dependencias = [];
  try {
    const data = await apiFetch(`/clientes/${encodeURIComponent(slug)}/dependencias`);
    dependencias = Array.isArray(data.dependencias) ? data.dependencias : [];
  } catch (err) {
    setClientesFeedback(err.message || "Não foi possível verificar dependências do cliente.", "danger");
    return;
  } finally {
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }

  if (!dependencias.length) {
    abrirModalConfirmacaoClientes({
      title: "Excluir cliente",
      subtitle: `${nomeCliente} · Squad: ${squadLabel}`,
      description: `Este cliente não possui dados vinculados e pode ser excluído permanentemente. Esta ação não pode ser desfeita.`,
      confirmLabel: "Excluir permanentemente",
      danger: true,
      onConfirm: async () => {
        await apiFetch(`/clientes/${encodeURIComponent(slug)}`, { method: "DELETE" });
        setClientesFeedback(`Cliente "${nomeCliente}" excluído permanentemente.`, "success");
        loadClientes();
      },
    });
  } else {
    abrirModalRemoverComDependencias({ slug, nomeCliente, squadLabel, dependencias });
  }
}

// ── Modal dedicado "Remover cliente" (cliente COM dependências) ──────────
// Dois passos: 1) escolha entre remover da operação (soft) ou ir para a
// exclusão permanente; 2) 2ª confirmação — digitar nome/slug — antes do
// purge real. "Admin tem a palavra final": nunca bloqueia sem alternativa.
let CLIENTES_REMOVER_OPEN = false;
let CLIENTES_REMOVER_CTX = null; // { slug, nomeCliente, squadLabel }

function mostrarErroRemover(msg) {
  const erro = document.getElementById("vf-clientes-remover-erro");
  if (!erro) return;
  erro.style.display = "block";
  erro.textContent = msg;
}

function limparErroRemover() {
  const erro = document.getElementById("vf-clientes-remover-erro");
  if (!erro) return;
  erro.style.display = "none";
  erro.textContent = "";
}

function atualizarBotaoPurgeHabilitado() {
  const input = document.getElementById("vf-clientes-remover-input");
  const btn = document.getElementById("vf-clientes-remover-btn-purge");
  if (!input || !btn || !CLIENTES_REMOVER_CTX) return;
  const digitado = input.value.trim().toLowerCase();
  const alvoNome = CLIENTES_REMOVER_CTX.nomeCliente.trim().toLowerCase();
  const alvoSlug = CLIENTES_REMOVER_CTX.slug.trim().toLowerCase();
  btn.disabled = !digitado || (digitado !== alvoNome && digitado !== alvoSlug);
}

function mostrarPassoEscolhaRemover() {
  document.getElementById("vf-clientes-remover-passo-escolha").style.display = "block";
  document.getElementById("vf-clientes-remover-passo-purge").style.display = "none";
  document.getElementById("vf-clientes-remover-rodape-escolha").style.display = "flex";
  document.getElementById("vf-clientes-remover-rodape-purge").style.display = "none";
  const input = document.getElementById("vf-clientes-remover-input");
  if (input) input.value = "";
  limparErroRemover();
}

function mostrarPassoPurgeRemover() {
  document.getElementById("vf-clientes-remover-passo-escolha").style.display = "none";
  document.getElementById("vf-clientes-remover-passo-purge").style.display = "block";
  document.getElementById("vf-clientes-remover-rodape-escolha").style.display = "none";
  document.getElementById("vf-clientes-remover-rodape-purge").style.display = "flex";
  const alvo = document.getElementById("vf-clientes-remover-alvo");
  if (alvo) alvo.textContent = CLIENTES_REMOVER_CTX?.nomeCliente || "";
  const input = document.getElementById("vf-clientes-remover-input");
  if (input) { input.value = ""; input.focus(); }
  atualizarBotaoPurgeHabilitado();
}

function fecharModalRemoverCliente() {
  document.getElementById("vf-clientes-remover-modal")?.classList.remove("is-open");
  CLIENTES_REMOVER_OPEN = false;
  CLIENTES_REMOVER_CTX = null;
}

function abrirModalRemoverComDependencias({ slug, nomeCliente, squadLabel, dependencias }) {
  CLIENTES_REMOVER_CTX = { slug, nomeCliente, squadLabel };
  CLIENTES_REMOVER_OPEN = true;

  document.getElementById("vf-clientes-remover-subtitle").textContent = `${nomeCliente} · Squad: ${squadLabel}`;
  document.getElementById("vf-clientes-remover-desc").textContent =
    "Este cliente possui dados históricos e não será apagado fisicamente por padrão. Escolha o que deseja fazer:";
  document.getElementById("vf-clientes-remover-deps").innerHTML =
    dependencias.map((d) => `<li>${escapeHTML(d.label)}: ${d.total}</li>`).join("");

  mostrarPassoEscolhaRemover();
  document.getElementById("vf-clientes-remover-modal").classList.add("is-open");
}

async function confirmarRemoverDaOperacao() {
  const ctx = CLIENTES_REMOVER_CTX;
  if (!ctx) return;
  limparErroRemover();
  const btn = document.getElementById("vf-clientes-remover-btn-desativar");
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Removendo…";
  try {
    await apiFetch(`/clientes/${encodeURIComponent(ctx.slug)}/desativar`, { method: "PATCH" });
    setClientesFeedback(`Cliente "${ctx.nomeCliente}" removido da operação ativa. Dados preservados.`, "success");
    fecharModalRemoverCliente();
    loadClientes();
  } catch (err) {
    mostrarErroRemover(err.message || "Não foi possível remover o cliente.");
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

async function confirmarExcluirPermanentemente() {
  const ctx = CLIENTES_REMOVER_CTX;
  if (!ctx) return;
  limparErroRemover();
  const input = document.getElementById("vf-clientes-remover-input");
  const btn = document.getElementById("vf-clientes-remover-btn-purge");
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Excluindo…";
  try {
    await apiFetch(`/clientes/${encodeURIComponent(ctx.slug)}?confirmarPurge=true`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmar: input.value.trim() }),
    });
    setClientesFeedback(`Cliente "${ctx.nomeCliente}" e todos os dados relacionados foram excluídos permanentemente.`, "success");
    fecharModalRemoverCliente();
    loadClientes();
  } catch (err) {
    mostrarErroRemover(err.message || "Não foi possível excluir o cliente.");
    btn.textContent = original;
    atualizarBotaoPurgeHabilitado();
  }
}

async function carregarSquadsAtivos() {
  const select = document.getElementById("cliente-squad");
  select.innerHTML = `<option value="">Carregando squads…</option>`;
  try {
    const data = await apiFetch("/squads");
    const todos = Array.isArray(data.squads) ? data.squads : [];
    SQUADS_ATIVOS = todos.filter((s) => s.ativo === true);
    renderOpcoesSquad();
  } catch (err) {
    select.innerHTML = `<option value="">Erro ao carregar squads</option>`;
    setFormStatus(`Erro ao carregar squads: ${err.message}`, true);
  }
  atualizarEstadoBotaoCriar();
}

function renderOpcoesSquad() {
  const select = document.getElementById("cliente-squad");
  if (!SQUADS_ATIVOS.length) {
    select.innerHTML = `<option value="">Nenhum squad ativo disponível</option>`;
    return;
  }
  const opcoes = SQUADS_ATIVOS
    .map((s) => `<option value="${s.id}">${escapeHTML(s.nome)}${isLegado(s) ? " · Legado" : ""}</option>`)
    .join("");
  // Sempre começa com placeholder vazio — a pré-seleção (quando há
  // exatamente 1 squad elegível) é aplicada depois, explicitamente, nunca
  // via "primeira <option> da lista" (nunca escolher em silêncio).
  select.innerHTML = `<option value="">Selecione um squad</option>${opcoes}`;
  if (SQUADS_ATIVOS.length === 1) {
    select.value = String(SQUADS_ATIVOS[0].id);
  }
}

function squadSelecionadoValido() {
  const select = document.getElementById("cliente-squad");
  const id = Number(select.value);
  return Number.isInteger(id) && id > 0;
}

function atualizarEstadoBotaoCriar() {
  const nome = document.getElementById("cliente-nome").value.trim();
  const slug = document.getElementById("cliente-slug").value.trim();
  const btn = document.getElementById("btn-criar-cliente");
  btn.disabled = !(nome && slug && squadSelecionadoValido());
}


async function createCliente() {
  const nomeEl = document.getElementById("cliente-nome");
  const slugEl = document.getElementById("cliente-slug");
  const squadEl = document.getElementById("cliente-squad");
  const nome = nomeEl.value.trim();
  const slug = slugEl.value.trim();
  const squadId = Number(squadEl.value);
  const squadNome = squadEl.options[squadEl.selectedIndex]?.textContent || "";

  setFormStatus("", false);
  if (!nome) { setFormStatus("Informe o nome do cliente.", true); return; }
  if (!slug) { setFormStatus("Informe o slug do cliente.", true); return; }
  if (!Number.isInteger(squadId) || squadId <= 0) { setFormStatus("Selecione um squad.", true); return; }

  setCreateLoading(true);
  try {
    const data = await apiFetch("/clientes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nome, slug, squadId }),
    });
    const slugCriado = data?.cliente?.slug || data?.slug || slug;
    const squadFinal = data?.squad?.nome || squadNome;
    fecharModalNovoCliente();
    setClientesFeedback(`✓ Cliente "${nome}" criado no Squad ${squadFinal}. Agora adicione as contas dele.`, "success");
    await loadClientes({ selecionar: slugCriado });
  } catch (err) {
    setFormStatus("Erro ao criar: " + err.message, true);
  } finally {
    setCreateLoading(false);
    atualizarEstadoBotaoCriar();
  }
}

// ── MODAL "NOVO CLIENTE" ─────────────────────────────────────────────────
let slugTouched = false;
let CLIENTES_NOVO_OPEN = false;

function abrirModalNovoCliente() {
  const nomeEl = document.getElementById("cliente-nome");
  document.getElementById("cliente-slug").value = "";
  nomeEl.value = "";
  slugTouched = false;
  setFormStatus("", false);
  if (!SQUADS_ATIVOS.length) carregarSquadsAtivos();
  else { renderOpcoesSquad(); atualizarEstadoBotaoCriar(); }
  CLIENTES_NOVO_OPEN = true;
  document.getElementById("vf-clientes-novo-modal").classList.add("is-open");
  setTimeout(() => nomeEl.focus(), 50);
}

function fecharModalNovoCliente() {
  document.getElementById("vf-clientes-novo-modal")?.classList.remove("is-open");
  CLIENTES_NOVO_OPEN = false;
}

// ── LISTA (coluna esquerda) ──────────────────────────────────────────────

function iniciais(nome) {
  const partes = String(nome || "").trim().split(/\s+/).filter(Boolean);
  return (partes.slice(0, 2).map((p) => p[0]).join("") || "?").toUpperCase();
}

function squadTexto(c) {
  return c.squad ? `${c.squad.nome}${isLegado(c.squad) ? " · Legado" : ""}` : "Sem Squad";
}

function diagnosticoDoCliente(slug) {
  const reg = CONTAS_POR_CLIENTE.get(slug);
  if (!reg || (reg.estado === "carregando" && !reg.contas.length)) return null;
  if (reg.estado === "erro") return { code: "erro", tom: "neutral", curto: "—", label: "Não foi possível carregar" };
  return diagnosticarCliente(reg.contas);
}

function categoriaFiltro(diag) {
  if (!diag) return null;
  if (diag.code === "problema" || diag.code === "pendencia") return "atencao";
  if (diag.code === "sem_contas") return "sem_contas";
  return "ok";
}

function textoBuscaCliente(c) {
  const contas = CONTAS_POR_CLIENTE.get(c.slug)?.contas || [];
  return [c.nome, c.slug, squadTexto(c), ...contas.map((k) => `${k.nome || ""} ${k.grant?.ml_user_id || k.external_account_id || ""}`)]
    .join(" ").toLowerCase();
}

function clientesVisiveis() {
  const termo = (document.getElementById("busca-cliente")?.value || "").toLowerCase().trim();
  return CLIENTES_LISTA.filter((c) => {
    if (FILTRO !== "todos" && categoriaFiltro(diagnosticoDoCliente(c.slug)) !== FILTRO) return false;
    return !termo || textoBuscaCliente(c).includes(termo);
  });
}

function renderFiltros() {
  const conta = { todos: CLIENTES_LISTA.length, atencao: 0, sem_contas: 0 };
  CLIENTES_LISTA.forEach((c) => {
    const cat = categoriaFiltro(diagnosticoDoCliente(c.slug));
    if (cat === "atencao") conta.atencao += 1;
    if (cat === "sem_contas") conta.sem_contas += 1;
  });
  const defs = [
    { key: "todos", label: "Todos" },
    { key: "atencao", label: "Precisam de atenção" },
    { key: "sem_contas", label: "Sem contas" },
  ];
  clientesFiltros.innerHTML = defs.map((d) => `
    <button type="button" class="vf-chip${FILTRO === d.key ? " is-active" : ""}" data-filtro="${d.key}" aria-pressed="${FILTRO === d.key}">
      ${escapeHTML(d.label)} <span class="vf-cli-chip-n">${conta[d.key]}</span>
    </button>`).join("");
}

function renderLista() {
  const visiveis = clientesVisiveis();
  clientesLista.innerHTML = visiveis.map((c) => {
    const diag = diagnosticoDoCliente(c.slug);
    const contas = CONTAS_POR_CLIENTE.get(c.slug)?.contas || [];
    const ativas = contas.filter((k) => k.ativo !== false).length;
    const metaContas = diag ? (ativas ? `${ativas} ${ativas === 1 ? "conta" : "contas"}` : "nenhuma conta") : "carregando…";
    const saude = diag
      ? `<span class="vf-status is-${diag.tom === "neutral" ? "empty" : diag.tom} vf-cli-item__saude">${escapeHTML(diag.curto)}</span>`
      : `<span class="vf-cli-item__saude vf-cli-item__saude--carregando" aria-label="Carregando"></span>`;
    const ativo = c.slug === SELECIONADO;
    const inativo = c.ativo === false ? `<span class="vf-tag is-neutral vf-cli-item__tag">Inativo</span>` : "";
    return `
      <button type="button" class="vf-cli-item${ativo ? " is-active" : ""}" data-slug="${escapeHTML(c.slug)}"${ativo ? ' aria-current="true"' : ""}>
        <span class="vf-cli-avatar" aria-hidden="true">${escapeHTML(iniciais(c.nome))}</span>
        <span class="vf-cli-item__main">
          <span class="vf-cli-item__nome"><span class="vf-cli-item__nome-texto">${escapeHTML(c.nome || c.slug)}</span>${inativo}</span>
          <span class="vf-cli-item__meta"><span class="vf-cli-cell-squad${c.squad ? "" : " is-missing"}">${escapeHTML(squadTexto(c))}</span> · ${escapeHTML(metaContas)}</span>
        </span>
        ${saude}
      </button>`;
  }).join("");
  clientesListaVazia.hidden = visiveis.length > 0;
  clientesCount.textContent = visiveis.length === CLIENTES_LISTA.length
    ? `${CLIENTES_LISTA.length} ${CLIENTES_LISTA.length === 1 ? "cliente" : "clientes"}`
    : `${visiveis.length} de ${CLIENTES_LISTA.length} clientes`;
}

function selecionarCliente(slug) {
  if (!slug || slug === SELECIONADO) return;
  SELECIONADO = slug;
  fecharMenuConta();
  renderLista();
  renderDetalhe();
  const reg = CONTAS_POR_CLIENTE.get(slug);
  if (!reg || reg.estado === "erro") carregarContas(slug);
  // Em tela estreita o painel fica abaixo da lista: leva o usuário até ele.
  if (window.matchMedia("(max-width: 899.98px)").matches) {
    clientesDetalhe.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

// ── PAINEL DO CLIENTE (coluna direita) ───────────────────────────────────

const ICONE_CHECK = {
  ok: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>',
  warn: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M12 7v6M12 17h.01"/></svg>',
  bad: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M12 7v6M12 17h.01"/></svg>',
  na: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M7 12h10"/></svg>',
};
const ROTULO_CHECK = { ok: "ok", warn: "pendente", bad: "com problema", na: "não se aplica" };
const ICONE_MAIS = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
const ICONE_MENU = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>';

function textoVazioMarketplace(mp) {
  if (mp === "tiktok") return "Nenhuma conta TikTok Shop. Sem integração: os números entram como lançamento manual no Painel de Contas.";
  return `Nenhuma conta ${rotuloMarketplaceConta(mp)} cadastrada.`;
}

function identificadorConta(conta) {
  if (conta.marketplace === "meli") {
    if (conta.grant?.ml_user_id) return `Seller ${conta.grant.ml_user_id}`;
    if (conta.external_account_id) return `Seller ${conta.external_account_id} · sem conexão`;
    return "Seller ainda não identificado";
  }
  return "";
}

function renderDetalhe() {
  fecharMenuConta();
  const c = CLIENTES_LISTA.find((x) => x.slug === SELECIONADO);
  if (!c) { clientesDetalhe.innerHTML = ""; return; }
  const reg = CONTAS_POR_CLIENTE.get(c.slug);
  const carregando = !reg || (reg.estado === "carregando" && !reg.contas.length);
  const contas = reg?.contas || [];
  const diag = carregando || reg?.estado === "erro" ? null : diagnosticarCliente(contas);

  let situacao;
  if (carregando) {
    situacao = `<span class="vf-spinner vf-spinner--sm" aria-hidden="true"></span><span class="vf-cli-situacao__texto">Carregando contas…</span>`;
  } else if (reg.estado === "erro") {
    situacao = `<span class="vf-status is-danger">Não foi possível carregar as contas</span>
      <span class="vf-cli-situacao__texto">${escapeHTML(reg.erro || "")}</span>
      <button type="button" class="vf-btn vf-btn--sm vf-btn--secondary" data-acao="recarregar-contas">Tentar de novo</button>`;
  } else {
    situacao = `<span class="vf-status is-${diag.tom === "neutral" ? "empty" : diag.tom}">${escapeHTML(diag.label)}</span>
      <span class="vf-cli-situacao__texto">${escapeHTML(diag.descricao)}</span>`;
  }

  const acoesCliente = IS_ADMIN
    ? `<div class="vf-cli-cabecalho__acoes">
         <button type="button" class="vf-btn vf-btn--sm vf-btn--ghost vf-cli-btn-perigo" data-action="delete" data-slug="${escapeHTML(c.slug)}">Remover cliente</button>
       </div>`
    : "";

  const avisoLeitura = IS_ADMIN ? "" : `
    <div class="vf-alert is-info vf-cli-aviso-leitura" role="note">
      Você pode conectar contas do Mercado Livre e copiar o link de conexão para o cliente. Definir bases, criar contas e outras alterações são feitas por um administrador.
    </div>`;

  const secoes = carregando || reg.estado === "erro" ? "" : MARKETPLACES.map((mp) => {
    const doMp = contas.filter((k) => k.marketplace === mp.key);
    const contagem = doMp.length ? `${doMp.length} ${doMp.length === 1 ? "conta" : "contas"}` : "";
    const botaoAdd = IS_ADMIN
      ? `<button type="button" class="vf-btn vf-btn--sm vf-btn--secondary" data-action="add-conta" data-mp="${mp.key}">${ICONE_MAIS} Adicionar conta</button>`
      : "";
    const formAdd = IS_ADMIN ? `
      <form class="vf-cli-nova-conta" data-form="${mp.key}" hidden>
        <div class="vf-field">
          <label class="vf-field__label" for="nova-conta-${mp.key}">Nome da nova conta ${escapeHTML(mp.label)}</label>
          <input type="text" id="nova-conta-${mp.key}" class="vf-input" data-input="nome" placeholder="ex: ${escapeHTML(mp.label)} 1" autocomplete="off">
        </div>
        <div class="vf-cli-nova-conta__acoes">
          <button type="button" class="vf-btn vf-btn--sm vf-btn--secondary" data-action="cancelar-conta" data-mp="${mp.key}">Cancelar</button>
          <button type="submit" class="vf-btn vf-btn--sm vf-btn--primary" data-action="salvar-conta" data-mp="${mp.key}">Criar conta</button>
        </div>
      </form>` : "";
    return `
      <section class="vf-cli-mp" data-mp="${mp.key}" aria-labelledby="mp-titulo-${mp.key}">
        <div class="vf-cli-mp__cabecalho">
          <span class="vf-cli-mp__sigla" aria-hidden="true">${mp.sigla}</span>
          <h3 class="vf-cli-mp__titulo" id="mp-titulo-${mp.key}">${escapeHTML(mp.label)}</h3>
          <span class="vf-cli-mp__contagem">${escapeHTML(contagem)}</span>
          <span class="vf-cli-mp__espaco"></span>
          ${botaoAdd}
        </div>
        ${formAdd}
        ${doMp.length ? `<div class="vf-cli-contas" data-list="${mp.key}"></div>` : `<p class="vf-cli-mp__vazio">${escapeHTML(textoVazioMarketplace(mp.key))}</p>`}
      </section>`;
  }).join("");

  const inativo = c.ativo === false ? `<span class="vf-tag is-neutral">Cliente inativo</span>` : "";

  clientesDetalhe.innerHTML = `
    <div class="vf-cli-cabecalho">
      <span class="vf-cli-avatar vf-cli-avatar--lg" aria-hidden="true">${escapeHTML(iniciais(c.nome))}</span>
      <div class="vf-cli-cabecalho__main">
        <h2 class="vf-cli-cabecalho__nome">${escapeHTML(c.nome || c.slug)}</h2>
        <div class="vf-cli-cabecalho__meta">
          <span class="vf-cli-cell-squad${c.squad ? "" : " is-missing"}">${escapeHTML(squadTexto(c))}</span>
          <span class="vf-cli-sep" aria-hidden="true">·</span>
          <span class="vf-mono vf-cli-slug">${escapeHTML(c.slug)}</span>
          ${inativo}
        </div>
      </div>
      ${acoesCliente}
      <div class="vf-cli-situacao">${situacao}</div>
    </div>
    ${avisoLeitura}
    ${secoes}
  `;

  if (!carregando && reg.estado !== "erro") {
    MARKETPLACES.forEach((mp) => {
      const list = clientesDetalhe.querySelector(`[data-list="${mp.key}"]`);
      if (!list) return;
      contas.filter((k) => k.marketplace === mp.key)
        .forEach((conta) => list.appendChild(criarCardConta(c.slug, conta)));
    });
  }
}

function criarCardConta(slug, conta) {
  const diag = diagnosticarConta(conta);
  const card = document.createElement("article");
  card.className = `vf-cli-conta${conta.ativo === false ? " is-off" : ""}`;

  const tags = [
    conta.is_primary ? `<span class="vf-tag is-primary">Principal</span>` : "",
    conta.ativo === false ? `<span class="vf-tag is-neutral">Desativada</span>` : "",
  ].join("");
  const ident = identificadorConta(conta);

  card.innerHTML = `
    <div class="vf-cli-conta__topo">
      <div class="vf-cli-conta__titulo">
        <span class="vf-cli-conta__nome">${escapeHTML(conta.nome)}</span>
        ${ident ? `<span class="vf-mono vf-cli-conta__id">${escapeHTML(ident)}</span>` : ""}
      </div>
      <div class="vf-cli-conta__tags">${tags}</div>
    </div>
    <span class="vf-status is-${diag.tom === "neutral" ? "empty" : diag.tom} vf-cli-conta__estado">${escapeHTML(diag.label)}</span>
    <ul class="vf-cli-checks">
      ${diag.checks.map((ck) => `
        <li class="vf-cli-check is-${ck.tom}">
          <span class="vf-cli-check__ico" role="img" aria-label="${ROTULO_CHECK[ck.tom]}">${ICONE_CHECK[ck.tom]}</span>
          <span class="vf-cli-check__label">${escapeHTML(ck.label)}</span>
          <span class="vf-cli-check__texto" title="${escapeHTML(ck.texto)}">${escapeHTML(ck.texto)}</span>
        </li>`).join("")}
    </ul>
    ${diag.dica ? `<p class="vf-cli-conta__dica">${escapeHTML(diag.dica)}</p>` : ""}
  `;

  const acoes = IS_ADMIN ? montarAcoesConta(slug, conta, diag) : montarAcoesContaLeitura(slug, conta, diag);
  if (acoes.primaria || acoes.secundaria || acoes.menu.length) card.appendChild(renderAcoesConta(acoes));
  return card;
}

// ── AÇÕES DA CONTA (só admin — toda mutação é requireAdmin no backend) ───
// Uma ação principal pelo ESTADO da conta (o próximo passo dela), uma
// secundária, e o resto num menu "⋯". Todas chamam exatamente as mesmas
// rotas da tela anterior.
// Conectar/Reconectar e "Copiar link de conexão" são para TODOS os usuários:
// o link /ml/conectar-conta/:id é público no backend (é o mesmo link que o
// cliente vendedor recebe) e a proteção de reconexão — mesmo seller
// esperado — é aplicada no callback do servidor, não aqui. Todo o resto
// (base, principal, ativar, testar, desconectar) é requireAdmin no backend
// e por isso só aparece para admin, em montarAcoesConta().
function acoesConexaoMl(slug, conta) {
  const link = getMlConectarContaLink(conta.id);
  return {
    conectar: { label: conta.grant ? "Reconectar" : "Conectar conta", href: link, externo: true, aoAbrir: () => { RECARREGAR_AO_VOLTAR = slug; } },
    copiar: { label: "Copiar link de conexão", run: (btn) => copiarLinkConta(link, btn) },
  };
}

function montarAcoesContaLeitura(slug, conta, diag) {
  const vazio = { primaria: null, secundaria: null, menu: [] };
  if (conta.marketplace !== "meli" || conta.ativo === false) return vazio;
  const { conectar, copiar } = acoesConexaoMl(slug, conta);
  if (["sem_grant", "desconectada", "grant_problema"].includes(diag.code)) {
    return { primaria: conectar, secundaria: copiar, menu: [] };
  }
  // Conta já conectada: a conexão continua à mão, sem competir com nada.
  return { primaria: null, secundaria: copiar, menu: [conectar] };
}

function montarAcoesConta(slug, conta, diag) {
  if (conta.ativo === false) {
    return {
      primaria: null,
      secundaria: { label: "Reativar conta", run: () => alternarAtivoConta(slug, conta) },
      menu: [],
    };
  }

  const principal = !conta.is_primary
    ? { label: "Tornar principal", run: () => acaoConta(slug, () => apiFetch(`/cliente-contas/${conta.id}/principal`, { method: "PATCH" })) }
    : null;
  const desativar = { label: "Desativar conta", run: () => confirmarDesativarConta(slug, conta) };
  const base = conta.marketplace !== "tiktok"
    ? { label: conta.base?.base_id ? "Trocar base" : "Definir base", run: () => abrirBasePicker(slug, conta) }
    : null;

  if (conta.marketplace === "tiktok") {
    return {
      primaria: null,
      secundaria: { label: "Abrir Painel de Contas", href: "painel-contas.html" },
      menu: [principal, desativar].filter(Boolean),
    };
  }

  if (conta.marketplace !== "meli") {
    const semBase = diag.code === "sem_base";
    return {
      primaria: semBase ? base : null,
      secundaria: null,
      menu: [semBase ? null : base, principal, desativar].filter(Boolean),
    };
  }

  const temGrant = !!conta.grant;
  const { conectar, copiar } = acoesConexaoMl(slug, conta);
  const testar = temGrant ? { label: "Testar conexão", run: (btn) => testarGrantConta(slug, conta, btn) } : null;
  const desconectar = temGrant ? {
    label: "Desconectar do Mercado Livre",
    perigo: true,
    run: () => abrirModalConfirmacaoClientes({
      title: "Desconectar conta Mercado Livre",
      subtitle: conta.nome,
      description: `Remove só o grant desta conta (${conta.nome}). As demais contas Mercado Livre deste cliente não são afetadas.`,
      confirmLabel: "Desconectar",
      danger: true,
      onConfirm: () => acaoConta(slug, () => apiFetch(`/cliente-contas/${conta.id}/ml-grant`, { method: "DELETE" })),
    }),
  } : null;

  switch (diag.code) {
    case "sem_grant":
    case "desconectada":
      return { primaria: conectar, secundaria: copiar, menu: [base, principal, desativar].filter(Boolean) };
    case "grant_problema":
      return { primaria: conectar, secundaria: copiar, menu: [testar, base, principal, desativar, desconectar].filter(Boolean) };
    case "sem_base":
      return { primaria: base, secundaria: testar, menu: [conectar, copiar, principal, desativar, desconectar].filter(Boolean) };
    default:
      return { primaria: null, secundaria: testar, menu: [conectar, copiar, base, principal, desativar, desconectar].filter(Boolean) };
  }
}

function criarBotaoAcao(acao, variante) {
  const el = document.createElement(acao.href ? "a" : "button");
  el.className = `vf-btn vf-btn--sm vf-btn--${variante}`;
  el.textContent = acao.label;
  if (acao.href) {
    el.href = acao.href;
    if (acao.externo) { el.target = "_blank"; el.rel = "noopener"; }
    if (acao.aoAbrir) el.addEventListener("click", acao.aoAbrir);
  } else {
    el.type = "button";
    el.addEventListener("click", () => executarAcao(acao, el));
  }
  return el;
}

async function executarAcao(acao, el) {
  try {
    await acao.run(el);
  } catch {
    // acaoConta/testarGrantConta já mostraram o erro no banner da página.
  }
}

function renderAcoesConta(acoes) {
  const wrap = document.createElement("div");
  wrap.className = "vf-cli-conta__acoes";
  if (acoes.primaria) wrap.appendChild(criarBotaoAcao(acoes.primaria, "primary"));
  if (acoes.secundaria) wrap.appendChild(criarBotaoAcao(acoes.secundaria, "secondary"));
  if (acoes.menu.length) {
    const btnMenu = document.createElement("button");
    btnMenu.type = "button";
    btnMenu.className = "vf-btn vf-btn--sm vf-btn--secondary vf-btn--icon vf-cli-conta__mais";
    btnMenu.setAttribute("aria-label", "Mais ações da conta");
    btnMenu.setAttribute("aria-haspopup", "menu");
    btnMenu.setAttribute("aria-expanded", "false");
    btnMenu.innerHTML = ICONE_MENU;
    btnMenu.addEventListener("click", (e) => {
      e.stopPropagation();
      if (MENU_ABERTO && MENU_ABERTO.botao === btnMenu) { fecharMenuConta(); return; }
      abrirMenuConta(btnMenu, acoes.menu);
    });
    wrap.appendChild(btnMenu);
  }
  return wrap;
}

// Menu "⋯": um único popover por vez, ancorado no botão e anexado ao card
// (posição absoluta — rola junto com a página, sem cálculo de viewport).
let MENU_ABERTO = null; // { botao, el }

function abrirMenuConta(botao, itens) {
  fecharMenuConta();
  const menu = document.createElement("div");
  menu.className = "vf-menu vf-cli-menu";
  menu.setAttribute("role", "menu");
  itens.forEach((acao, i) => {
    if (acao.perigo && i > 0) {
      const sep = document.createElement("div");
      sep.className = "vf-menu__separator";
      sep.setAttribute("role", "separator");
      menu.appendChild(sep);
    }
    const item = document.createElement(acao.href ? "a" : "button");
    item.className = `vf-menu__item${acao.perigo ? " is-danger" : ""}`;
    item.setAttribute("role", "menuitem");
    item.textContent = acao.label;
    if (acao.href) {
      item.href = acao.href;
      if (acao.externo) { item.target = "_blank"; item.rel = "noopener"; }
      item.addEventListener("click", () => { if (acao.aoAbrir) acao.aoAbrir(); fecharMenuConta(); });
    } else {
      item.type = "button";
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        // "Copiar link" dá o retorno no próprio botão "⋯" (o menu fecha).
        fecharMenuConta();
        executarAcao(acao, botao);
      });
    }
    menu.appendChild(item);
  });
  botao.parentElement.appendChild(menu);
  botao.setAttribute("aria-expanded", "true");
  MENU_ABERTO = { botao, el: menu };
  menu.querySelector(".vf-menu__item")?.focus();
}

function fecharMenuConta() {
  if (!MENU_ABERTO) return;
  MENU_ABERTO.el.remove();
  MENU_ABERTO.botao.setAttribute("aria-expanded", "false");
  MENU_ABERTO = null;
}

function confirmarDesativarConta(slug, conta) {
  abrirModalConfirmacaoClientes({
    title: "Desativar conta",
    subtitle: `${conta.nome} · ${rotuloMarketplaceConta(conta.marketplace)}`,
    description: "A conta sai da operação, mas nada é apagado: conexão, base e histórico ficam guardados. Você pode reativá-la quando quiser.",
    confirmLabel: "Desativar conta",
    onConfirm: () => alternarAtivoConta(slug, conta),
  });
}

function alternarAtivoConta(slug, conta) {
  return acaoConta(slug, () =>
    apiFetch(`/cliente-contas/${conta.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ativo: conta.ativo === false }),
    })
  );
}

// ── "+ Adicionar conta" (mini-form por marketplace) ──────────────────────
function abrirFormNovaConta(mp) {
  const form = clientesDetalhe.querySelector(`[data-form="${mp}"]`);
  if (!form) return;
  const input = form.querySelector('[data-input="nome"]');
  const existentes = (CONTAS_POR_CLIENTE.get(SELECIONADO)?.contas || []).filter((c) => c.marketplace === mp).length;
  input.value = `${rotuloMarketplaceConta(mp)} ${existentes + 1}`;
  form.hidden = false;
  input.focus();
  input.select();
}

async function criarContaNoCliente(slug, marketplace) {
  const form = clientesDetalhe.querySelector(`[data-form="${marketplace}"]`);
  if (!form) return;
  const input = form.querySelector('[data-input="nome"]');
  const btn = form.querySelector('[data-action="salvar-conta"]');
  const nome = input.value.trim();
  const label = rotuloMarketplaceConta(marketplace);
  if (!nome) { setClientesFeedback(`Informe o nome da conta ${label}.`, "danger"); input.focus(); return; }

  btn.disabled = true;
  try {
    await apiFetch(`/clientes/${encodeURIComponent(slug)}/contas`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ marketplace, nome }),
    });
    setClientesFeedback(`Conta ${label} "${nome}" criada.`, "success");
    await carregarContas(slug);
  } catch (err) {
    btn.disabled = false;
    setClientesFeedback(`Erro ao criar conta ${label}: ${err.message}`, "danger");
  }
}

async function testarGrantConta(slug, conta, btn) {
  if (!conta.grant) return;
  const original = btn.textContent;
  const ehIcone = btn.classList.contains("vf-btn--icon");
  btn.disabled = true;
  if (!ehIcone) btn.textContent = "Testando…";
  try {
    await apiFetch(`/admin/ml-tokens/${conta.grant.id}/testar`, { method: "POST" });
    setClientesFeedback(`Conexão de "${conta.nome}" testada com sucesso.`, "success");
  } catch (err) {
    setClientesFeedback(`Falha ao testar a conexão de "${conta.nome}": ${err.message}`, "danger");
  } finally {
    if (btn.isConnected) {
      btn.disabled = false;
      if (!ehIcone) btn.textContent = original;
    }
    await atualizarAposAcao(slug);
  }
}

async function acaoConta(slug, fn) {
  try {
    await fn();
    await atualizarAposAcao(slug);
  } catch (err) {
    setClientesFeedback(err.message || "Não foi possível concluir a ação.", "danger");
    throw err;
  }
}

// ── MODAL "DEFINIR BASE" / "TROCAR BASE" (item 5 do Fechamento da Fase 1) ──
// Só lista bases do MESMO marketplace da conta (GET /cliente-contas/:id/
// bases-elegiveis, que reaproveita baseVinculosService — nunca duplica a
// regra de compatibilidade, que é validada de novo no backend ao salvar).

async function abrirBasePicker(slug, conta) {
  BASE_PICKER_CONTA = { slug, conta };
  const modal = document.getElementById("vf-base-picker-modal");
  const subtitle = document.getElementById("vf-base-picker-subtitle");
  const loading = document.getElementById("vf-base-picker-loading");
  const field = document.getElementById("vf-base-picker-field");
  const empty = document.getElementById("vf-base-picker-empty");
  const select = document.getElementById("vf-base-picker-select");
  const danger = document.getElementById("vf-base-picker-danger");
  const okBtn = document.getElementById("vf-base-picker-ok");

  document.getElementById("vf-base-picker-title").textContent = conta.base?.base_id ? "Trocar base" : "Definir base";
  subtitle.textContent = `${conta.nome} · ${rotuloMarketplaceConta(conta.marketplace)}`;
  loading.style.display = "block";
  field.style.display = "none";
  empty.style.display = "none";
  danger.style.display = "none";
  danger.textContent = "";
  select.innerHTML = "";
  okBtn.disabled = true;
  modal.classList.add("is-open");

  try {
    const data = await apiFetch(`/cliente-contas/${conta.id}/bases-elegiveis`);
    const bases = Array.isArray(data.bases) ? data.bases : [];
    loading.style.display = "none";
    if (!bases.length) { empty.style.display = "block"; return; }

    field.style.display = "block";
    select.innerHTML = bases.map((b) => {
      const ocupada = b.vinculo && b.vinculo.cliente_slug && b.vinculo.cliente_slug !== slug;
      const rotulo = ocupada ? `${b.nome} (${b.slug}) — hoje em ${b.vinculo.cliente_nome || b.vinculo.cliente_slug}` : `${b.nome} (${b.slug})`;
      return `<option value="${b.id}">${escapeHTML(rotulo)}</option>`;
    }).join("");
    if (conta.base?.base_id) select.value = String(conta.base.base_id);
    okBtn.disabled = false;
  } catch (err) {
    loading.style.display = "none";
    danger.style.display = "block";
    danger.textContent = `Não foi possível carregar as bases elegíveis: ${err.message}`;
  }
}

function fecharBasePicker() {
  document.getElementById("vf-base-picker-modal")?.classList.remove("is-open");
  BASE_PICKER_CONTA = null;
}

async function confirmarBasePicker() {
  if (!BASE_PICKER_CONTA) return;
  const { slug, conta } = BASE_PICKER_CONTA;
  const select = document.getElementById("vf-base-picker-select");
  const okBtn = document.getElementById("vf-base-picker-ok");
  const danger = document.getElementById("vf-base-picker-danger");
  const baseId = select.value;
  if (!baseId) return;

  okBtn.disabled = true;
  okBtn.textContent = "Vinculando…";
  try {
    await apiFetch(`/cliente-contas/${conta.id}/base`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base_id: Number(baseId) }),
    });
    setClientesFeedback(`Base vinculada à conta "${conta.nome}".`, "success");
    fecharBasePicker();
    await atualizarAposAcao(slug);
  } catch (err) {
    danger.style.display = "block";
    danger.textContent = err.message || "Não foi possível vincular a base.";
  } finally {
    okBtn.disabled = false;
    okBtn.textContent = "Vincular base";
  }
}


// ── LIGAÇÕES ─────────────────────────────────────────────────────────────

// Slug auto (editável)
const nomeInput = document.getElementById("cliente-nome");
const slugInput = document.getElementById("cliente-slug");
slugInput.addEventListener("input", () => { slugTouched = slugInput.value.trim().length > 0; });
nomeInput.addEventListener("input", () => {
  if (slugTouched) return;
  slugInput.value = slugify(nomeInput.value);
});

nomeInput.addEventListener("input", atualizarEstadoBotaoCriar);
slugInput.addEventListener("input", atualizarEstadoBotaoCriar);
document.getElementById("cliente-squad").addEventListener("change", atualizarEstadoBotaoCriar);

if (IS_ADMIN) {
  document.getElementById("clientes-header-acoes").hidden = false;
  if (TOKEN) carregarSquadsAtivos();
}

document.getElementById("btn-novo-cliente")?.addEventListener("click", abrirModalNovoCliente);
document.getElementById("btn-criar-cliente").addEventListener("click", createCliente);
document.getElementById("vf-clientes-novo-close")?.addEventListener("click", fecharModalNovoCliente);
document.getElementById("vf-clientes-novo-cancel")?.addEventListener("click", fecharModalNovoCliente);
document.getElementById("vf-clientes-novo-modal")?.addEventListener("click", (e) => {
  if (e.target?.id === "vf-clientes-novo-modal") fecharModalNovoCliente();
});
[nomeInput, slugInput].forEach((el) => el.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !document.getElementById("btn-criar-cliente").disabled) createCliente();
}));

document.getElementById("btn-retry").addEventListener("click", () => loadClientes());

// Lista: seleção e filtros (delegação — a lista é re-renderizada a cada carga).
clientesLista.addEventListener("click", (e) => {
  const item = e.target.closest(".vf-cli-item");
  if (item) selecionarCliente(item.getAttribute("data-slug") || "");
});
clientesFiltros.addEventListener("click", (e) => {
  const chip = e.target.closest("[data-filtro]");
  if (!chip) return;
  FILTRO = chip.getAttribute("data-filtro");
  renderFiltros();
  renderLista();
});

const buscaInput = document.getElementById("busca-cliente");
if (buscaInput) {
  let debounceTimer;
  buscaInput.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(renderLista, 200);
  });
}

// Painel: ações por delegação (o painel é re-renderizado após cada ação).
clientesDetalhe.addEventListener("click", (e) => {
  const alvo = e.target.closest("[data-action], [data-acao]");
  if (!alvo) return;
  const acao = alvo.getAttribute("data-action") || alvo.getAttribute("data-acao");
  const mp = alvo.getAttribute("data-mp");
  if (acao === "delete") abrirModalRemoverCliente(alvo);
  else if (acao === "add-conta") abrirFormNovaConta(mp);
  else if (acao === "cancelar-conta") {
    const form = clientesDetalhe.querySelector(`[data-form="${mp}"]`);
    if (form) form.hidden = true;
  } else if (acao === "recarregar-contas") carregarContas(SELECIONADO);
});
clientesDetalhe.addEventListener("submit", (e) => {
  const form = e.target.closest("[data-form]");
  if (!form) return;
  e.preventDefault();
  criarContaNoCliente(SELECIONADO, form.getAttribute("data-form"));
});

document.addEventListener("click", (e) => {
  if (MENU_ABERTO && !MENU_ABERTO.el.contains(e.target) && e.target !== MENU_ABERTO.botao) fecharMenuConta();
});

// Conectar/Reconectar abre o OAuth do ML em outra aba. Ao voltar para esta,
// as contas daquele cliente são relidas — o status atualiza sem F5.
window.addEventListener("focus", () => {
  if (!RECARREGAR_AO_VOLTAR) return;
  const slug = RECARREGAR_AO_VOLTAR;
  RECARREGAR_AO_VOLTAR = null;
  carregarContas(slug);
});

document.getElementById("vf-clientes-confirm-close")?.addEventListener("click", fecharModalConfirmacaoClientes);
document.getElementById("vf-clientes-confirm-cancel")?.addEventListener("click", fecharModalConfirmacaoClientes);
document.getElementById("vf-clientes-confirm-ok")?.addEventListener("click", confirmarModalClientes);
document.getElementById("vf-clientes-confirm-modal")?.addEventListener("click", (e) => {
  if (e.target?.id === "vf-clientes-confirm-modal") fecharModalConfirmacaoClientes();
});

document.getElementById("vf-clientes-remover-close")?.addEventListener("click", fecharModalRemoverCliente);
document.getElementById("vf-clientes-remover-cancelar")?.addEventListener("click", fecharModalRemoverCliente);
document.getElementById("vf-clientes-remover-modal")?.addEventListener("click", (e) => {
  if (e.target?.id === "vf-clientes-remover-modal") fecharModalRemoverCliente();
});
document.getElementById("vf-clientes-remover-btn-desativar")?.addEventListener("click", confirmarRemoverDaOperacao);
document.getElementById("vf-clientes-remover-btn-ir-purge")?.addEventListener("click", () => { limparErroRemover(); mostrarPassoPurgeRemover(); });
document.getElementById("vf-clientes-remover-voltar")?.addEventListener("click", () => { limparErroRemover(); mostrarPassoEscolhaRemover(); });
document.getElementById("vf-clientes-remover-btn-purge")?.addEventListener("click", confirmarExcluirPermanentemente);
document.getElementById("vf-clientes-remover-input")?.addEventListener("input", atualizarBotaoPurgeHabilitado);

document.getElementById("vf-base-picker-close")?.addEventListener("click", fecharBasePicker);
document.getElementById("vf-base-picker-cancel")?.addEventListener("click", fecharBasePicker);
document.getElementById("vf-base-picker-ok")?.addEventListener("click", confirmarBasePicker);
document.getElementById("vf-base-picker-modal")?.addEventListener("click", (e) => {
  if (e.target?.id === "vf-base-picker-modal") fecharBasePicker();
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (MENU_ABERTO) { const b = MENU_ABERTO.botao; fecharMenuConta(); b.focus(); }
  else if (CLIENTES_CONFIRM_OPEN) fecharModalConfirmacaoClientes();
  else if (CLIENTES_REMOVER_OPEN) fecharModalRemoverCliente();
  else if (BASE_PICKER_CONTA) fecharBasePicker();
  else if (CLIENTES_NOVO_OPEN) fecharModalNovoCliente();
});

if (TOKEN) loadClientes();
