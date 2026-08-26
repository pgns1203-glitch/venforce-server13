// Portal/vf-shell.js
//
// Shell V3 (F0.5) — MASTER_SPEC §5 (contrato do shell), §9 (sidebar
// completa), §14 (marketplace × capacidade), §19 (responsividade).
//
// Responsabilidades (e só estas):
//   · ler data-vf-scope / data-vf-module / data-vf-marketplaces / data-vf-capability
//   · montar a sidebar de coluna única (logo, contexto, módulos, gestão
//     global, administração, rodapé)
//   · montar os dois dropdowns (Cliente, Operação) e refletir vf-context
//   · aplicar o gating (esconder `main`, mostrar o painel de estado)
//   · reparentar o bloco de contexto em telas estreitas (§19.1) — um nó só
//   · publicar window.VF.shell — espelho, nunca fonte
//
// NÃO decide cardinalidade (vf-context.js, e só lá — R8), não decide acesso
// (403 é estado, não filtro — I10), não busca dado de módulo. Portado de
// Squads_migration/preview_v3/js/vf-shell.js, adaptado para: (a) ES module
// real (vf-context.js exporta statusOperacao/rotuloExterno diretamente, sem
// namespace `contextFactory`); (b) wiring real com vf-api.js — o rascunho
// usava um mock; (c) fabricação do DOM da página migrada (o rascunho tinha
// mount points fixos no harness do protótipo; aqui a página real só troca 3
// atributos, então o shell precisa construir `.vf-shell` em volta do
// conteúdo existente, sem reescrevê-lo).
//
// ES Module. Espelhado em window.VF.shell.

import { vfContext } from "./vf-context.js";
import { vfApi } from "./vf-api.js";
import { format as fmt } from "./vf-format.js";
import { statusOperacao, rotuloExterno } from "./vf-context.js";

const TOKEN_KEY = "vf-token";
const USER_KEY = "vf-user";
const COLLAPSE_KEY = "vf-sidebar-collapsed"; // preferência de UI (§9.2) — localStorage é correto AQUI

/* ── Modelo de navegação (MASTER_SPEC §9.5) ──────────────────────────────
   30 links em 5 grupos incoerentes → 8 módulos contextuais + globais +
   admin. `rota: null` = módulo ainda sem destino real nesta execução
   (Visão, F3, fora de escopo) — item PREPARADO, nunca link quebrado (§5 do
   prompt desta execução). `marketplaces` ausente = disponível em todos. */
export const MODULOS = [
  { id: "visao", label: "Visão", rota: null, futuro: true },
  { id: "financeiro", label: "Financeiro", rota: "financeiro.html" },
  { id: "central-vendas", label: "Central de Vendas", rota: "fechamentos-api.html" },
  { id: "ads", label: "Ads", rota: "ads.html", marketplaces: ["meli"] },
  { id: "anuncios", label: "Anúncios", rota: "anuncios-meli.html", marketplaces: ["meli"] },
  // F2.3 — Motor de Margem só resolve base MELI (contextoPrecificacaoService);
  // achado lendo o código real, não previsto no MASTER_SPEC original.
  { id: "margem", label: "Margem", rota: "central-margem.html", marketplaces: ["meli"] },
  { id: "diagnosticos", label: "Diagnósticos", rota: "diagnostico-inicial.html" },
  { id: "automacoes", label: "Automações", rota: "automacoes.html", marketplaces: ["meli"] },
];

export const GLOBAIS = [
  { id: "carteira", label: "Carteira", rota: "carteira.html" },
  { id: "bases", label: "Bases", rota: "bases.html" },
  { id: "clientes-contas", label: "Clientes e Contas", rota: "clientes.html" },
  { id: "ferramentas", label: "Ferramentas", rota: "ferramentas.html" },
  { id: "pessoas", label: "Pessoas", rota: "usuarios.html" },
  { id: "guia", label: "Guia do Vendedor", rota: "guia-vendedor.html" },
];

export const ADMIN = [
  { id: "atividade", label: "Atividade", rota: "atividade.html" },
  { id: "control-center", label: "Control Center", rota: "control-center.html" },
  { id: "callbacks", label: "Callbacks", rota: "callbacks.html" },
  { id: "debug", label: "Debug Financeiro", rota: "financeiro-debug.html" },
  { id: "lab", label: "Laboratório UI", rota: "design-system-lab.html" },
];

export const MARKETPLACE_LABEL = { meli: "Mercado Livre", shopee: "Shopee", tiktok: "TikTok Shop" };

/* ── Estados (MASTER_SPEC §7.2) — tabela única; nenhuma lógica duplicada. */
const ESTADOS = {
  BOOT: { tom: "info", titulo: "Carregando…", texto: "Resolvendo a sua carteira." },
  PORTFOLIO_ERROR: {
    tom: "danger",
    titulo: "Não foi possível carregar a sua carteira",
    texto: "Isto é uma falha técnica, não uma carteira vazia.",
    acao: { label: "Tentar novamente", cmd: "retry" },
    alerta: true,
  },
  NO_PORTFOLIO: {
    tom: "info",
    titulo: "Nenhum cliente atribuído aos seus squads",
    texto: "Fale com o coordenador do seu squad para receber acesso a uma carteira.",
  },
  NO_CLIENT: {
    tom: "info",
    titulo: "Selecione um cliente",
    texto: "Este módulo trabalha dentro de uma operação. Escolha o cliente e a operação na Carteira.",
    acao: { label: "Ir para a Carteira", cmd: "carteira" },
  },
  RESOLVING_CLIENT: { tom: "info", titulo: "Validando o cliente…", texto: "Conferindo se ele está na sua carteira." },
  INVALID_CLIENT: {
    tom: "warning",
    titulo: "Cliente indisponível",
    texto: "O cliente pedido não está disponível na sua carteira.",
    acao: { label: "Ver Carteira", cmd: "carteira" },
  },
  FORBIDDEN: {
    tom: "danger",
    titulo: "Você não tem acesso a este cliente",
    texto: "O contexto foi descartado. Isto é uma falha de autorização — diferente de uma integração caída.",
    acao: { label: "Voltar à Carteira", cmd: "carteira" },
    alerta: true,
  },
  RESOLVING_ACCOUNTS: { tom: "info", titulo: "Carregando operações…", texto: "Buscando as contas deste cliente." },
  NO_ACTIVE_ACCOUNT: {
    tom: "warning",
    titulo: "Este cliente ainda não tem operação configurada",
    texto: "Sem uma conta de marketplace ativa, os módulos operacionais não têm de onde ler.",
    acao: { label: "Configurar operação →", cmd: "clientes-contas" },
  },
  ACCOUNT_CHOICE_REQUIRED: {
    tom: "warning",
    titulo: "Escolha a operação",
    texto: "Este cliente tem mais de uma operação ativa. Nenhuma é escolhida automaticamente — é o que impede ler a loja errada.",
    acao: { label: "Escolher operação", cmd: "abrir-operacao" },
  },
  INVALID_ACCOUNT: {
    tom: "warning",
    titulo: "Operação inválida",
    texto: "A operação pedida não pertence a este cliente.",
    acao: { label: "Escolher operação", cmd: "abrir-operacao" },
  },
  ACCOUNT_INACTIVE: {
    tom: "warning",
    titulo: "Operação desativada",
    texto: "A operação que estava no contexto foi desativada. O cliente e a rota foram preservados.",
    acao: { label: "Escolher outra operação", cmd: "abrir-operacao" },
  },
  READY: null,
};

function el(tag, cls, html) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html !== undefined) n.innerHTML = html;
  return n;
}

function safeLocalStorage() {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

/* ── Adaptador padrão de API (real) para vf-context.init({ api }) ────────
   MASTER_SPEC §18.1/§18.2 — "PRECISA AJUSTE"/"CONTRATO NECESSÁRIO" ainda
   não existem; o fallback F1 já documentado é usado aqui: EXISTE HOJE. */
function createProductionContextApi(api) {
  return {
    carteira: () => api.get("/operacao/cliente-360/clientes").catch((err) => ({ ok: false, code: err && err.code, erro: err && err.message })),
    contasDoCliente: (ref, opts) =>
      api
        .get(`/clientes/${encodeURIComponent(ref)}/contas`, opts)
        .catch((err) => {
          if (err && err.name === "VfApiError" && err.status === 0 && err.code === "REDE") throw err; // deixa a rede real propagar (AbortError já é null)
          return { ok: false, code: err && err.code, erro: err && err.message };
        }),
  };
}

function readUser() {
  const storage = safeLocalStorage();
  try {
    const raw = storage ? storage.getItem(USER_KEY) : null;
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function hasToken() {
  const storage = safeLocalStorage();
  try {
    return !!(storage && storage.getItem(TOKEN_KEY));
  } catch {
    return false;
  }
}

/* ── Fabricação do DOM em volta do conteúdo existente (migração mínima) ──
   A página migrada NÃO ganha mount points novos no HTML — o shell constrói
   `.vf-shell` (MASTER_SPEC §16.3) e move o conteúdo atual para
   `.vf-shell__main`, sem alterar as classes internas dele. */
function buildShellDom() {
  if (document.querySelector(".vf-sidebar")) return null; // layout.js já montado — nunca junto (§5.3)
  const existing = document.querySelector(".vf-shell");
  if (existing) {
    return {
      root: existing,
      sidebar: existing.querySelector(".vf-shell__sidebar"),
      contextbar: existing.querySelector(".vf-shell__contextbar"),
      stateHost: existing.querySelector(".vf-shell__state"),
      main: existing.querySelector(".vf-shell__main"),
    };
  }

  const children = Array.from(document.body.childNodes);

  const root = el("div", "vf-shell");
  const sidebar = el("aside", "vf-shell__sidebar");
  sidebar.id = "vf-shell-sidebar";

  const bodyCol = el("div", "vf-shell__body");
  const contextbar = el("div", "vf-shell__contextbar");
  contextbar.id = "vf-shell-contextbar";
  contextbar.hidden = true;

  const stateHost = el("div", "vf-shell__state");
  stateHost.id = "vf-shell-state";
  stateHost.hidden = true;

  const main = el("main", "vf-shell__main");
  main.id = "vf-shell-main";
  children.forEach((node) => main.appendChild(node));

  bodyCol.appendChild(contextbar);
  bodyCol.appendChild(stateHost);
  bodyCol.appendChild(main);
  root.appendChild(sidebar);
  root.appendChild(bodyCol);
  document.body.appendChild(root);

  return { root, sidebar, contextbar, stateHost, main };
}

/* ── Fábrica testável (mesmo padrão de createVfApi/createVfContext) ──────
   Tudo que toca o mundo externo (DOM, matchMedia, localStorage) é
   injetável para o teste headless (S01–S13) poder controlar o ambiente. */
export function createVfShell(options = {}) {
  const win = options.window || (typeof window !== "undefined" ? window : null);
  const doc = options.document || (typeof document !== "undefined" ? document : null);
  if (!doc) throw new Error("vf-shell.js requer um DOM (document).");

  const ctxStore = options.context || vfContext;
  const onNavigate = options.onNavigate || ((href) => { if (win) win.location.href = href; });
  const onCommand = options.onCommand || defaultCommand;
  const getUser = options.getUser || readUser;
  const storage = options.storage || safeLocalStorage();

  const dom = options.dom || buildShellDom();
  if (!dom) return null; // abortou: .vf-sidebar (layout.js) já presente

  const host = dom.sidebar;
  const main = dom.main;
  const stateHost = dom.stateHost;
  const contextbar = dom.contextbar;

  // aria-live="polite" que anuncia a troca de contexto (§9.3) — não existe
  // no resto da página, então o shell é quem precisa garantir um só.
  let announcer = dom.root.querySelector("#vf-shell-announcer");
  if (!announcer) {
    announcer = el("div", "vf-visually-hidden");
    announcer.id = "vf-shell-announcer";
    announcer.setAttribute("aria-live", "polite");
    announcer.setAttribute("role", "status");
    dom.root.appendChild(announcer);
  }
  let ultimoAnuncio = null;

  let dropdownAberto = null; // "cliente" | "operacao" | null
  let colapsada = false;
  try {
    colapsada = storage ? storage.getItem(COLLAPSE_KEY) === "1" : false;
  } catch {
    /* preferência de UI — falha aqui não impede o shell de renderizar */
  }

  function defaultCommand(cmd) {
    if (cmd === "logout") doLogout();
    if (cmd === "retry" && win) win.location.reload();
  }

  function doLogout() {
    ctxStore.clearOperationalContext(); // D12 — logout limpa o contexto operacional
    try {
      storage && storage.removeItem(TOKEN_KEY);
      storage && storage.removeItem(USER_KEY);
    } catch {
      /* ignora — o redirect ainda acontece */
    }
    onNavigate("index.html");
  }

  function mq(query) {
    return !!(win && typeof win.matchMedia === "function" && win.matchMedia(query).matches);
  }

  /* DOIS predicados, não um (§19.1) — ver MASTER_SPEC para a distinção. */
  function contextoNaBarra() {
    return mq("(max-width: 1200px)");
  }
  function railEstreito() {
    return mq("(min-width: 861px) and (max-width: 1200px)");
  }

  function abreviar(label) {
    const p = String(label).split(/\s+/);
    if (p.length > 1) return (p[0][0] + p[p.length - 1][0]).toUpperCase();
    return label.slice(0, 2);
  }

  function moduloDisponivel(mod, meta) {
    if (!mod.marketplaces) return true;
    if (!meta) return true; // sem contexto: não pré-julga (§14.2)
    return mod.marketplaces.indexOf(meta.marketplace) >= 0;
  }

  function motivoIndisponivel(mod, meta) {
    const mkt = MARKETPLACE_LABEL[meta.marketplace] || meta.marketplace;
    return `${mod.label} — indisponível para operações ${mkt}`;
  }

  /* ── Render ──────────────────────────────────────────────────────────── */

  function render(snap) {
    if (!host) return;
    const estado = snap.state;
    const ctx = snap.context;
    const meta = snap.meta;
    const user = getUser();
    const carregando = estado === "BOOT" || estado === "RESOLVING_CLIENT" || estado === "RESOLVING_ACCOUNTS";

    host.innerHTML = "";
    host.className = "vf-shell__sidebar" + (colapsada ? " is-collapsed" : "");

    const logo = el("div", "vf-shell__logo");
    logo.innerHTML =
      '<span class="vf-shell__brand"><span class="vf-shell__brand-mark">VF</span>' +
      '<span class="vf-shell__brand-text">Venforce</span></span>';
    const toggle = el("button", "vf-shell__collapse", colapsada ? "›" : "‹");
    toggle.type = "button";
    toggle.setAttribute("aria-label", colapsada ? "Expandir menu" : "Recolher menu");
    toggle.setAttribute("aria-expanded", colapsada ? "false" : "true");
    toggle.addEventListener("click", () => {
      colapsada = !colapsada;
      try {
        storage && storage.setItem(COLLAPSE_KEY, colapsada ? "1" : "0");
      } catch {
        /* preferência de UI — segue sem persistir */
      }
      render(ctxStore.getSnapshot());
    });
    logo.appendChild(toggle);
    host.appendChild(logo);

    const bloco = blocoContexto(estado, ctx, meta, carregando, snap);
    if (contextoNaBarra() && contextbar) {
      contextbar.hidden = false;
      contextbar.innerHTML = "";
      contextbar.appendChild(bloco);
    } else {
      if (contextbar) {
        contextbar.hidden = true;
        contextbar.innerHTML = "";
      }
      host.appendChild(bloco);
    }

    const nav = el("nav", "vf-shell__nav");
    nav.setAttribute("aria-label", "Módulos da operação");
    const indisponiveis = [];
    MODULOS.forEach((mod) => {
      if (meta && !moduloDisponivel(mod, meta)) {
        indisponiveis.push(mod);
        return;
      }
      nav.appendChild(itemNav(mod, estado === "READY" ? null : "Escolha um cliente e uma operação para abrir este módulo"));
    });

    if (indisponiveis.length >= 3) {
      const mkt = MARKETPLACE_LABEL[meta.marketplace] || meta.marketplace;
      const det = el("details", "vf-shell__unavailable");
      det.innerHTML = `<summary>Indisponíveis para ${fmt.escapeHTML(mkt)} (${indisponiveis.length})</summary>`;
      indisponiveis.forEach((mod) => det.appendChild(itemNav(mod, motivoIndisponivel(mod, meta))));
      nav.appendChild(det);
    } else {
      indisponiveis.forEach((mod) => nav.appendChild(itemNav(mod, motivoIndisponivel(mod, meta))));
    }
    host.appendChild(nav);

    host.appendChild(el("div", "vf-shell__section-label", "Gestão global"));
    const navG = el("nav", "vf-shell__nav");
    navG.setAttribute("aria-label", "Gestão global");
    GLOBAIS.forEach((mod) => navG.appendChild(itemNav(mod, null)));
    host.appendChild(navG);

    if (String(user.role || "").toLowerCase() === "admin") {
      const admin = el("details", "vf-shell__admin");
      admin.innerHTML = "<summary>Administração</summary>";
      const navA = el("nav", "vf-shell__nav");
      ADMIN.forEach((mod) => navA.appendChild(itemNav(mod, null)));
      admin.appendChild(navA);
      host.appendChild(admin);
    }

    const footer = el("div", "vf-shell__footer");
    footer.innerHTML =
      `<span class="vf-shell__avatar">${fmt.escapeHTML(fmt.iniciais(user.nome))}</span>` +
      `<span class="vf-shell__user"><b>${fmt.escapeHTML(user.nome || "Usuário")}</b>` +
      `<small>${fmt.escapeHTML(String(user.role || "").toLowerCase() === "admin" ? "Administrador" : "Usuário")}</small></span>`;
    const sair = el("button", "vf-shell__logout", "⏻");
    sair.type = "button";
    sair.title = "Sair";
    sair.setAttribute("aria-label", "Sair");
    sair.addEventListener("click", () => onCommand("logout"));
    footer.appendChild(sair);
    host.appendChild(footer);

    aplicarGating(snap);

    // Anuncia só quando cliente+conta MUDA de verdade — um resize ou um
    // re-render por outro motivo não pode repetir o mesmo anúncio (§9.3).
    if (estado === "READY" && ctx) {
      const chave = `${ctx.clienteId}:${ctx.clienteContaId}`;
      if (chave !== ultimoAnuncio) {
        ultimoAnuncio = chave;
        const clienteAtual = ctxStore.getClienteAtual();
        const nomeCliente = clienteAtual ? clienteAtual.nome : "";
        const nomeConta = meta ? meta.nome : "";
        announcer.textContent = `Contexto: ${nomeCliente}, ${nomeConta}`;
      }
    } else if (!ctx) {
      ultimoAnuncio = null;
    }
  }

  function itemNav(mod, motivoDesabilitado) {
    const futuro = !!mod.futuro || !mod.rota;
    const desabilitado = motivoDesabilitado || futuro;
    const isActive = doc.body.dataset.vfModule === mod.id;
    const a = el("a", "vf-shell__item" + (isActive ? " is-active" : "") + (desabilitado ? " is-disabled" : ""));
    a.href = desabilitado ? "#" : buildHref(mod);
    const rail = railEstreito() || colapsada;
    a.textContent = rail ? abreviar(mod.label) : mod.label;
    if (rail) {
      a.setAttribute("aria-label", mod.label);
      a.title = motivoDesabilitado || (futuro ? "Ainda não disponível nesta versão" : mod.label);
    }
    a.dataset.module = mod.id;
    if (isActive) a.setAttribute("aria-current", "page");
    if (desabilitado) {
      // aria-disabled + title, NUNCA `disabled` puro (§9.3) — alcançável por
      // teclado, motivo legível.
      a.setAttribute("aria-disabled", "true");
      a.title = motivoDesabilitado || "Ainda não disponível nesta versão";
      a.addEventListener("click", (e) => e.preventDefault());
    }
    return a;
  }

  // Links normais entre os dois mundos (§20.1): a página migrada passa
  // ?cliente=&conta= para a que ainda não migrou; ela ignora o que não
  // entende e usa o próprio seletor. Nenhuma quebra.
  function buildHref(mod) {
    const ctx = ctxStore.getContext();
    if (!ctx || !ctx.clienteSlug) return mod.rota;
    const qs = new URLSearchParams();
    qs.set("cliente", ctx.clienteSlug);
    if (ctx.clienteContaId) qs.set("conta", String(ctx.clienteContaId));
    return `${mod.rota}?${qs.toString()}`;
  }

  function blocoContexto(estado, ctx, meta, carregando, snap) {
    const escopoPagina = doc.body.dataset.vfScope || "global";
    const bloco = el("div", "vf-shell__context" + (escopoPagina === "global" ? " is-muted" : ""));
    const cliente = ctxStore.getClienteAtual();

    const rotuloEscopo = escopoPagina === "global" ? '<span class="vf-shell__context-flag">contexto ativo</span>' : "";
    bloco.innerHTML = `<div class="vf-shell__context-label">Cliente${rotuloEscopo}</div>`;

    const btnC = el("button", "vf-ctx-selector" + (dropdownAberto === "cliente" ? " is-open" : ""));
    btnC.type = "button";
    btnC.id = "vf-cliente-trigger";
    btnC.setAttribute("aria-haspopup", "listbox");
    btnC.setAttribute("aria-expanded", dropdownAberto === "cliente" ? "true" : "false");
    if (carregando && !cliente) {
      btnC.innerHTML = '<span class="vf-skeleton vf-skeleton--row" style="width:100%;height:14px"></span>';
      btnC.disabled = true;
    } else {
      btnC.innerHTML =
        `<span class="vf-ctx-selector__value${cliente ? "" : " is-empty"}">` +
        fmt.escapeHTML(cliente ? cliente.nome : "Selecione um cliente") +
        '</span><span aria-hidden="true">▾</span>';
    }
    btnC.addEventListener("click", () => abrirDropdown(dropdownAberto === "cliente" ? null : "cliente"));
    bloco.appendChild(btnC);
    if (dropdownAberto === "cliente") bloco.appendChild(dropdownClientes());

    bloco.appendChild(el("div", "vf-shell__context-label", "Operação"));
    const contas = ctxStore.getAccounts().filter((c) => c.ativo !== false);
    const btnO = el("button", "vf-ctx-selector" + (dropdownAberto === "operacao" ? " is-open" : ""));
    btnO.type = "button";
    btnO.id = "vf-op-trigger";
    btnO.setAttribute("aria-haspopup", "listbox");
    btnO.setAttribute("aria-expanded", dropdownAberto === "operacao" ? "true" : "false");

    if (estado === "RESOLVING_ACCOUNTS") {
      btnO.innerHTML = '<span class="vf-skeleton vf-skeleton--row" style="width:100%;height:14px"></span>';
      btnO.disabled = true;
    } else if (!cliente) {
      btnO.innerHTML = '<span class="vf-ctx-selector__value is-empty">—</span>';
      btnO.disabled = true;
    } else if (!contas.length) {
      btnO.innerHTML = '<span class="vf-ctx-selector__value is-empty">Sem operação</span>';
      btnO.disabled = true; // visível e desabilitado, nunca escondido (§9.2)
    } else if (meta) {
      btnO.innerHTML =
        `<span class="vf-ctx-selector__value"><span class="vf-status is-${meta.status.tone}">` +
        '<span aria-hidden="true"></span></span>' +
        fmt.escapeHTML(meta.nome) +
        '</span><span aria-hidden="true">▾</span>' +
        `<small class="vf-ctx-selector__sub">${fmt.escapeHTML(meta.externalAccountLabel)}</small>`;
      btnO.disabled = contas.length === 1; // 1 ativa: nada a escolher (precedente fechamentos-api.js:820)
    } else {
      btnO.innerHTML = '<span class="vf-ctx-selector__value is-empty">Selecione a operação…</span><span aria-hidden="true">▾</span>';
    }
    btnO.addEventListener("click", () => abrirDropdown(dropdownAberto === "operacao" ? null : "operacao"));
    bloco.appendChild(btnO);
    if (dropdownAberto === "operacao") bloco.appendChild(dropdownOperacoes());

    if (meta) {
      const integ = snap.integration || {};
      const linhas = [];
      if (meta.marketplace === "meli" && integ.grant && integ.grant !== "conectado") {
        linhas.push('<span class="vf-shell__integ is-warning">⚠ Mercado Livre desconectado</span>');
      }
      linhas.push(
        meta.base
          ? `<span class="vf-shell__integ">Base: ${fmt.escapeHTML(meta.base.nome)}</span>`
          : '<span class="vf-shell__integ is-warning">⚠ sem base vinculada</span>'
      );
      bloco.appendChild(el("div", "vf-shell__integrations", linhas.join("")));
    }

    return bloco;
  }

  function dropdownClientes() {
    const lista = ctxStore.getPortfolio();
    const box = el("div", "vf-menu vf-shell__dropdown");
    box.setAttribute("role", "listbox");
    box.setAttribute("aria-label", "Clientes da carteira");

    if (lista.length >= 8) {
      const wrap = el("div", "vf-shell__dropdown-search");
      const input = el("input", "vf-input vf-input--sm");
      input.type = "search";
      input.placeholder = "Buscar cliente…";
      input.setAttribute("aria-label", "Buscar cliente");
      input.addEventListener("input", () => {
        const q = fmt.normalizarBusca(input.value);
        Array.prototype.forEach.call(box.querySelectorAll(".vf-menu__item"), (it) => {
          it.hidden = q ? fmt.normalizarBusca(it.dataset.busca).indexOf(q) < 0 : false;
        });
      });
      wrap.appendChild(input);
      box.appendChild(wrap);
      setTimeout(() => input.focus(), 0);
    }

    const atual = ctxStore.getContext();
    lista.forEach((c) => {
      const it = el("button", "vf-menu__item");
      it.type = "button";
      it.setAttribute("role", "option");
      it.dataset.busca = `${c.nome} ${c.slug}`;
      const selecionado = atual && atual.clienteId === c.id;
      it.setAttribute("aria-selected", selecionado ? "true" : "false");
      const subOperacoes = typeof c.contasAtivas === "number" ? ` · ${c.contasAtivas} operaç${c.contasAtivas === 1 ? "ão" : "ões"}` : "";
      it.innerHTML =
        fmt.escapeHTML(c.nome) +
        (selecionado ? ' <span class="vf-menu__check" aria-hidden="true">✓</span>' : "") +
        `<small>${fmt.escapeHTML(c.slug)}${subOperacoes}</small>`;
      it.addEventListener("click", () => {
        abrirDropdown(null);
        ctxStore.setCliente(c.slug); // I1 — zera conta, revalida cardinalidade
      });
      box.appendChild(it);
    });
    wireTeclado(box);
    return box;
  }

  function dropdownOperacoes() {
    const contas = ctxStore.getAccounts();
    const cliente = ctxStore.getClienteAtual();
    const atual = ctxStore.getContext();
    const box = el("div", "vf-menu vf-shell__dropdown");
    box.setAttribute("role", "listbox");
    box.setAttribute("aria-label", `Operações de ${cliente ? cliente.nome : ""}`);
    box.appendChild(el("div", "vf-menu__label", `Operações de ${fmt.escapeHTML(cliente ? cliente.nome : "")}`));

    contas.forEach((c) => {
      const st = statusOperacao(c);
      const inativa = c.ativo === false;
      const it = el("button", "vf-menu__item" + (inativa ? " is-disabled" : ""));
      it.type = "button";
      it.setAttribute("role", "option");
      const sel = atual && atual.clienteContaId === c.id;
      it.setAttribute("aria-selected", sel ? "true" : "false");
      if (inativa) it.setAttribute("aria-disabled", "true");
      it.innerHTML =
        `<span class="vf-status is-${st.tone}"><span aria-hidden="true"></span>` +
        `<span class="vf-visually-hidden">${fmt.escapeHTML(st.label)}</span></span>` +
        fmt.escapeHTML(c.nome) +
        (inativa ? " (inativa)" : "") +
        (sel ? ' <span class="vf-menu__check" aria-hidden="true">✓</span>' : "") +
        `<small>${fmt.escapeHTML(rotuloExterno(c))} · ${fmt.escapeHTML(st.label)}</small>`;
      if (!inativa) {
        it.addEventListener("click", () => {
          abrirDropdown(null);
          ctxStore.setConta(c.id); // troca de operação MANTÉM a rota (§9, fluxo 6)
        });
      }
      box.appendChild(it);
    });

    const ger = el("button", "vf-menu__item vf-menu__item--footer");
    ger.type = "button";
    ger.textContent = "Gerenciar operações →";
    ger.addEventListener("click", () => {
      abrirDropdown(null);
      onNavigate("clientes.html");
    });
    box.appendChild(ger);
    wireTeclado(box);
    return box;
  }

  function wireTeclado(box) {
    box.addEventListener("keydown", (e) => {
      const itens = Array.prototype.filter.call(box.querySelectorAll(".vf-menu__item"), (i) => !i.hidden);
      const i = itens.indexOf(doc.activeElement);
      if (e.key === "ArrowDown") {
        e.preventDefault();
        (itens[i + 1] || itens[0])?.focus();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        (itens[i - 1] || itens[itens.length - 1])?.focus();
      } else if (e.key === "Home") {
        e.preventDefault();
        itens[0]?.focus();
      } else if (e.key === "End") {
        e.preventDefault();
        itens[itens.length - 1]?.focus();
      } else if (e.key === "Escape") {
        e.preventDefault();
        const gatilhoId = dropdownAberto === "operacao" ? "vf-op-trigger" : dropdownAberto === "cliente" ? "vf-cliente-trigger" : null;
        abrirDropdown(null);
        if (gatilhoId) doc.getElementById(gatilhoId)?.focus(); // Esc devolve o foco ao gatilho (§9.3)
      }
    });
  }

  function abrirDropdown(qual) {
    dropdownAberto = qual;
    render(ctxStore.getSnapshot());
    if (qual) {
      const primeiro = host.querySelector(".vf-shell__dropdown .vf-menu__item:not(.is-disabled)");
      if (primeiro) setTimeout(() => primeiro.focus(), 0);
    }
  }

  /* ── Gating por escopo (MASTER_SPEC §5.4) ────────────────────────────── */

  function aplicarGating(snap) {
    const escopo = doc.body.dataset.vfScope || "global";
    const estado = snap.state;

    const satisfeito =
      escopo === "global"
        ? estado !== "BOOT" && estado !== "PORTFOLIO_ERROR"
        : escopo === "client"
        ? !!(snap.context && snap.context.clienteId)
        : estado === "READY"; // "account"

    doc.body.classList.toggle("vf-shell-blocked", !satisfeito);
    if (main) main.hidden = !satisfeito;
    if (!stateHost) return;

    if (satisfeito) {
      stateHost.innerHTML = "";
      stateHost.hidden = true;
      return;
    }

    const def = ESTADOS[estado];
    if (!def) {
      stateHost.innerHTML = "";
      stateHost.hidden = true;
      return;
    }

    stateHost.hidden = false;
    const acao = def.acao
      ? `<div class="vf-banner__actions"><button type="button" class="vf-btn vf-btn--primary vf-btn--sm" data-cmd="${def.acao.cmd}">${fmt.escapeHTML(def.acao.label)}</button></div>`
      : "";
    const detalhe = snap.error && snap.error.mensagem ? `<p class="vf-banner__description"><small>${fmt.escapeHTML(snap.error.mensagem)}</small></p>` : "";

    stateHost.innerHTML =
      `<div class="vf-banner is-${def.tom}" role="${def.alerta ? "alert" : "status"}">` +
      '<div class="vf-banner__content">' +
      `<p class="vf-banner__title">${fmt.escapeHTML(def.titulo)}</p>` +
      `<p class="vf-banner__description">${fmt.escapeHTML(def.texto)}</p>${detalhe}` +
      `</div>${acao}</div>` +
      `<p class="vf-state-machine">estado do contexto: <code>${fmt.escapeHTML(estado)}</code></p>`;

    const btn = stateHost.querySelector("[data-cmd]");
    if (btn) {
      btn.addEventListener("click", () => {
        const cmd = btn.dataset.cmd;
        if (cmd === "carteira") onNavigate("carteira.html");
        else if (cmd === "clientes-contas") onNavigate("clientes.html");
        else if (cmd === "abrir-operacao") abrirDropdown("operacao");
        else onCommand(cmd);
      });
    }
  }

  /* Cruzar qualquer uma das duas faixas muda a montagem — precisa de
     re-render. Redimensionar DENTRO da mesma faixa não redesenha nada. */
  let timerResize = null;
  let faixaAnterior = `${contextoNaBarra()}${railEstreito()}`;
  if (win && typeof win.addEventListener === "function") {
    win.addEventListener("resize", () => {
      clearTimeout(timerResize);
      timerResize = setTimeout(() => {
        const faixa = `${contextoNaBarra()}${railEstreito()}`;
        if (faixa === faixaAnterior) return;
        faixaAnterior = faixa;
        render(ctxStore.getSnapshot());
      }, 120);
    });
  }

  const unsubscribe = ctxStore.subscribe((snap) => render(snap));

  return {
    render,
    dom,
    abrirOperacao: () => abrirDropdown("operacao"),
    fecharDropdowns: () => {
      if (dropdownAberto) abrirDropdown(null);
    },
    destroy: unsubscribe,
    MODULOS,
    GLOBAIS,
    ADMIN,
  };
}

/* ── Boot de produção — só roda em página real, autenticada, sem admin
   próprio de teste (o teste headless usa createVfShell() diretamente com
   um `api`/`context` injetados). */
function bootProduction() {
  if (typeof window === "undefined" || typeof document === "undefined") return null;
  if (!hasToken()) return null; // sem sessão: a própria página trata o redirect (vf-api 401)
  const user = readUser();
  const scope = document.body ? document.body.dataset.vfScope || "global" : "global";

  const shell = createVfShell({ getUser: readUser });
  if (!shell) return null; // abortou: .vf-sidebar já presente (layout.js)

  vfContext.init({ api: createProductionContextApi(vfApi), user, scope });
  return shell;
}

export const vfShell = typeof document !== "undefined" ? bootProduction() : null;

if (typeof window !== "undefined") {
  window.VF = window.VF || {};
  window.VF.shell = vfShell;
}
