// Portal/carteira.js
//
// Carteira — a lista "qual Cliente/Operação vou trabalhar agora?"
// (MASTER_SPEC §10). Fábrica testável desde o primeiro commit (F1.1) —
// `createCarteira(options)` aceita `context`/`api`/`getSquads` injetados,
// o mesmo padrão de createVfShell/createVfContext/createVfApi. Isso é o
// que torna F1.2 ("troca o mock por dado real") uma troca de QUAL `api` é
// injetado no boot de produção, não uma reescrita: o caminho de produção
// (`bootProduction()`, fim do arquivo) já nasce falando com o backend
// real, e os testes/cenários (Portal/carteira-ui.test.js) exercitam essa
// mesma função de fábrica com fixtures via rede interceptada — nunca um
// segundo modo de operação dentro do bundle de produção.
//
// Regra de conteúdo (§10.1), dura: cada elemento visível precisa ajudar a
// ESCOLHER. Faturamento não ajuda a escolher; "sem base vinculada" ajuda.
//
// A lista de clientes NÃO é buscada aqui. `vf-context.js` já fez essa
// chamada (GET /operacao/cliente-360/clientes, a única EXISTE HOJE que
// serve admin/user/membro — nunca GET /clientes, admin-only, M1) para
// alimentar o dropdown "Cliente" da sidebar. A Carteira lê o mesmo
// resultado via `context.getPortfolio()` — zero requisição duplicada, e um
// só ponto na aplicação decide "quais clientes eu vejo".
//
// O que a Carteira busca por conta própria é só o "sob demanda" do §10.5
// nível A: as OPERAÇÕES de cada cliente (GET /clientes/:slug/contas), só
// para as linhas visíveis, com cache de sessão (nunca refaz a mesma
// chamada) — porque `getClientesOperacional` calcula prontidão por
// CLIENTE, não por conta (MASTER_SPEC §3.8 #4); não existe `contasAtivas`
// no payload da carteira. Por isso cada linha nasce em estado "operações
// carregando" e só decide sua própria cardinalidade (§10.4: 1 conta entra
// direto, 2+ só pelo chip, 0 mostra "Configurar →") quando a resposta
// chega — nunca antes, e nunca por um campo que o payload não tem.
//
// Squad (D5/D7) é agrupamento e filtro, nunca um passo antes do cliente.
// O payload real de hoje não traz `squadId`/`responsavelDireto`
// (CONTRATO NECESSÁRIO, §10.8) — nesse caso `getSquads()` devolve `[]` e o
// agrupamento simplesmente não aparece. Nada é inventado; ver
// Portal/carteira-ui.test.js para os cenários (via `getSquads` injetado)
// que SIMULAM um payload com squad para provar que a UI funciona quando
// o contrato existir.
//
// Destino ao entrar no contexto: Visão (MASTER_SPEC §11), a home operacional
// por Cliente+Operação (F3.3). Antes de F3 existir, este destino era
// fechamentos-api.html (a única tela operacional migrada até então).
//
// ES Module. Fábrica testável (mesmo padrão de createVfShell/createVfContext/
// createVfApi): tudo que toca o mundo externo é injetável.

import { vfContext, statusOperacao, rotuloExterno } from "./vf-context.js";
import { vfApi } from "./vf-api.js";
import { format as fmt } from "./vf-format.js";

const DESTINO_PADRAO = "visao.html";
const PREFETCH = 12; // §10.5 nível A — ~12 requisições no primeiro paint, não 120

function createProductionApi(api) {
  return {
    contasDoCliente(slug, opts) {
      return api
        .get(`/clientes/${encodeURIComponent(slug)}/contas`, opts)
        .catch((err) => ({ ok: false, code: err && err.code, erro: err && err.message }));
    },
  };
}

export function createCarteira(options = {}) {
  const doc = options.document || (typeof document !== "undefined" ? document : null);
  if (!doc) throw new Error("carteira.js requer um DOM (document).");

  const ctxStore = options.context || vfContext;
  const api = options.api || createProductionApi(vfApi);
  const onNavigate = options.onNavigate || ((href) => { window.location.href = href; });
  const getSquads = options.getSquads || (() => []);

  let host = null;
  let unsubscribe = null;
  let observer = null;
  const contasPorCliente = {}; // cache de sessão — nunca refaz a mesma chamada
  const carregandoContas = {};

  let busca = "";
  let filtro = "todos"; // todos · pendencia · sem-operacao
  let ordem = "atencao"; // atencao · nome · sync · meus
  let squad = "todos";

  /* ── URL: busca/filtro/ordem são compartilháveis (§10.7) — nunca sessão. */
  function lerFiltrosDaUrl() {
    if (typeof window === "undefined" || !window.location) return;
    const q = new URLSearchParams(window.location.search);
    if (q.get("q")) busca = q.get("q");
    if (q.get("filtro")) filtro = q.get("filtro");
    if (q.get("ordem")) ordem = q.get("ordem");
    if (q.get("squad")) squad = q.get("squad");
  }

  function escreverFiltrosNaUrl() {
    if (typeof window === "undefined" || !window.history) return;
    const q = new URLSearchParams(window.location.search);
    busca ? q.set("q", busca) : q.delete("q");
    filtro !== "todos" ? q.set("filtro", filtro) : q.delete("filtro");
    ordem !== "atencao" ? q.set("ordem", ordem) : q.delete("ordem");
    squad !== "todos" ? q.set("squad", squad) : q.delete("squad");
    const qs = q.toString();
    const url = window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash;
    window.history.replaceState(null, "", url);
  }

  function montar(container) {
    host = container;
    lerFiltrosDaUrl();
    unsubscribe = ctxStore.subscribe(render);
  }

  function desmontar() {
    if (observer) observer.disconnect();
    if (unsubscribe) unsubscribe();
    host = null;
  }

  /* ── filtro/ordenação/agrupamento ────────────────────────────────────── */

  function agrupandoPorSquad() {
    return getSquads().length > 1 && squad === "todos";
  }

  function visiveis(clientes) {
    const q = fmt.normalizarBusca(busca);
    let lista = clientes.filter((c) => {
      if (q && fmt.normalizarBusca(`${c.nome} ${c.slug}`).indexOf(q) < 0) return false;
      if (squad !== "todos" && String(c.squadId) !== String(squad)) return false;
      if (filtro === "pendencia" && !(c.pendencias || []).length) return false;
      if (filtro === "sem-operacao" && c.ativo !== false && contasResumoCliente(c).contasAtivas !== 0) return false;
      return true;
    });

    const ordemStatus = { critico: 0, atencao: 1, pronto: 2 };
    const squads = getSquads();
    const ordemSquad = {};
    squads.forEach((s, i) => { ordemSquad[s.id] = i; });
    const porSquad = agrupandoPorSquad();

    function dentroDoGrupo(a, b) {
      if (ordem === "nome") return a.nome.localeCompare(b.nome, "pt-BR");
      if (ordem === "sync") return String(b.ultimaSincronizacao || "").localeCompare(String(a.ultimaSincronizacao || ""));
      if (ordem === "meus") return (b.responsavelDireto ? 1 : 0) - (a.responsavelDireto ? 1 : 0) || a.nome.localeCompare(b.nome, "pt-BR");
      return (ordemStatus[a.statusOperacional] ?? 9) - (ordemStatus[b.statusOperacional] ?? 9) || a.nome.localeCompare(b.nome, "pt-BR");
    }

    lista = lista.slice().sort((a, b) => {
      if (porSquad) {
        const da = ordemSquad[a.squadId] ?? 99;
        const db = ordemSquad[b.squadId] ?? 99;
        if (da !== db) return da - db; // squad primeiro; a ordenação escolhida vale DENTRO dele (M36)
      }
      return dentroDoGrupo(a, b);
    });
    return lista;
  }

  // "0 contas" só é conhecido depois que as contas daquela linha chegaram.
  // Antes disso, o filtro "Sem operação" trata a linha como indeterminada
  // (não some da lista à toa) — ver contasResumoCliente().
  function contasResumoCliente(c) {
    const cache = contasPorCliente[c.slug];
    if (!cache || cache.erro) return { contasAtivas: null };
    return { contasAtivas: cache.lista.filter((x) => x.ativo !== false).length };
  }

  /* ── render ──────────────────────────────────────────────────────────── */

  function render(snap) {
    if (!host) return;
    const estado = snap.state;
    const S = ctxStore.STATES;

    if (estado === S.BOOT) { renderCarregando(); return; }
    if (estado === S.PORTFOLIO_ERROR) { renderErro(snap.error); return; }

    const clientes = ctxStore.getPortfolio();
    if (estado === S.NO_PORTFOLIO || !clientes.length) { renderVazio(false); return; }

    renderLista(clientes);
  }

  function cabecalho(descricaoHtml) {
    return (
      '<header class="vf-page-header vf-portfolio-header">' +
      '<div class="vf-page-header__main">' +
      '<p class="vf-page-header__eyebrow">Gestão global</p>' +
      '<h1 class="vf-page-header__title">Carteira</h1>' +
      `<p class="vf-page-header__description" aria-live="polite" id="cart-contagem">${descricaoHtml}</p>` +
      "</div>" +
      "</header>"
    );
  }

  function renderCarregando() {
    host.innerHTML =
      cabecalho("Carregando…") +
      '<div class="vf-portfolio-list">' +
      new Array(8)
        .fill('<div class="vf-portfolio-row is-skeleton"><span class="vf-skeleton vf-skeleton--title"></span><span class="vf-skeleton vf-skeleton--row"></span></div>')
        .join("") +
      "</div>";
  }

  function renderErro(erro) {
    host.innerHTML =
      cabecalho("—") +
      '<div class="vf-banner is-danger" role="alert"><div class="vf-banner__content">' +
      '<p class="vf-banner__title">Não foi possível carregar a carteira</p>' +
      `<p class="vf-banner__description">${fmt.escapeHTML((erro && erro.mensagem) || "Falha de rede ou do servidor.")}</p></div>` +
      '<div class="vf-banner__actions"><button type="button" class="vf-btn vf-btn--sm" id="cart-retry">Tentar novamente</button></div></div>';
    const btn = host.querySelector("#cart-retry");
    if (btn) btn.addEventListener("click", () => window.location.reload());
  }

  function renderVazio(comFiltro) {
    host.innerHTML =
      cabecalho("0 clientes") +
      '<div class="vf-empty"><p class="vf-empty__title">' +
      (comFiltro ? "Nenhum cliente para os filtros atuais" : "Nenhum cliente atribuído aos seus squads") +
      "</p><p class=\"vf-empty__description\">" +
      (comFiltro ? "Ajuste a busca ou os filtros." : "Fale com o coordenador do seu squad.") +
      "</p></div>";
  }

  function renderLista(clientes) {
    const squads = getSquads();
    const comAtencao = clientes.filter((c) => (c.pendencias || []).length).length;
    const descricao =
      `${clientes.length} cliente${clientes.length === 1 ? "" : "s"}` +
      (comAtencao ? ` · ${comAtencao} precisa${comAtencao === 1 ? "" : "m"} de atenção` : "");

    host.innerHTML =
      cabecalho(descricao) +
      barraFiltros(squads) +
      '<div id="cart-lista" class="vf-portfolio-list"></div>';

    const buscaEl = host.querySelector("#cart-busca");
    buscaEl.addEventListener("input", () => {
      busca = buscaEl.value;
      escreverFiltrosNaUrl();
      renderCorpo(clientes);
      atualizarContagem(clientes);
    });
    if (clientes.length > 12 && !busca) setTimeout(() => buscaEl.focus(), 0);

    host.querySelectorAll("[data-filtro]").forEach((b) => {
      b.addEventListener("click", () => { filtro = b.dataset.filtro; escreverFiltrosNaUrl(); renderLista(clientes); });
    });
    const selOrdem = host.querySelector("#cart-ordem");
    if (selOrdem) selOrdem.addEventListener("change", () => { ordem = selOrdem.value; escreverFiltrosNaUrl(); renderCorpo(clientes); });
    const selSquad = host.querySelector("#cart-squad");
    if (selSquad) selSquad.addEventListener("change", () => { squad = selSquad.value; escreverFiltrosNaUrl(); renderLista(clientes); });

    renderCorpo(clientes);
  }

  function barraFiltros(squads) {
    const filtros = [["todos", "Todos"], ["pendencia", "Com pendência"], ["sem-operacao", "Sem operação"]];
    const seletorSquad =
      squads.length > 1
        ? '<label class="vf-toolbar__field">Squad <select id="cart-squad" class="vf-select vf-select--sm">' +
          '<option value="todos">Todos</option>' +
          squads.map((s) => `<option value="${fmt.escapeHTML(String(s.id))}"${String(squad) === String(s.id) ? " selected" : ""}>${fmt.escapeHTML(s.nome)}</option>`).join("") +
          "</select></label>"
        : "";
    return (
      '<div class="vf-toolbar vf-portfolio-toolbar">' +
      `<input id="cart-busca" class="vf-input vf-input--sm" type="search" placeholder="Buscar cliente…  (/)" aria-label="Buscar cliente" value="${fmt.escapeHTML(busca)}">` +
      '<div class="vf-filter-group" role="group" aria-label="Filtros">' +
      filtros
        .map(([id, label]) => `<button type="button" class="vf-filter-chip${filtro === id ? " is-active" : ""}" data-filtro="${id}" aria-pressed="${filtro === id}">${label}</button>`)
        .join("") +
      "</div>" +
      '<div class="vf-cluster">' +
      seletorSquad +
      '<label class="vf-toolbar__field">Ordenar <select id="cart-ordem" class="vf-select vf-select--sm">' +
      `<option value="atencao"${ordem === "atencao" ? " selected" : ""}>Atenção primeiro</option>` +
      `<option value="nome"${ordem === "nome" ? " selected" : ""}>Nome A→Z</option>` +
      `<option value="sync"${ordem === "sync" ? " selected" : ""}>Última sync</option>` +
      `<option value="meus"${ordem === "meus" ? " selected" : ""}>Meus clientes primeiro</option>` +
      "</select></label></div></div>"
    );
  }

  function atualizarContagem(clientes) {
    const el = host.querySelector("#cart-contagem");
    if (!el) return;
    const n = visiveis(clientes).length;
    el.textContent = `${n} cliente${n === 1 ? "" : "s"}` + (busca ? ` para «${busca}»` : "");
  }

  function renderCorpo(clientes) {
    const box = host.querySelector("#cart-lista");
    if (!box) return;
    if (observer) { observer.disconnect(); observer = null; }

    const lista = visiveis(clientes);
    if (!lista.length) {
      box.innerHTML =
        '<div class="vf-empty"><p class="vf-empty__title">' +
        (clientes.length ? "Nenhum cliente para os filtros atuais" : "Nenhum cliente atribuído aos seus squads") +
        '</p><p class="vf-empty__description">' +
        (clientes.length ? "Ajuste a busca ou os filtros." : "Fale com o coordenador do seu squad.") +
        "</p></div>";
      return;
    }

    const squads = getSquads();
    const agrupar = agrupandoPorSquad();
    let html = "";
    let squadAtual = null;

    lista.forEach((c) => {
      if (agrupar && c.squadId !== squadAtual) {
        squadAtual = c.squadId;
        const s = squads.find((x) => x.id === squadAtual);
        const n = lista.filter((x) => x.squadId === squadAtual).length;
        html += `<h2 class="vf-portfolio-group">${fmt.escapeHTML(s ? s.nome.toUpperCase() : "SEM SQUAD")} <small>${n} cliente${n === 1 ? "" : "s"}</small></h2>`;
      }
      html += linhaCliente(c);
    });
    box.innerHTML = `<ul class="vf-portfolio-ul" role="list">${html}</ul>`;

    wireLinhas(box);
    observarVisiveis(box);
  }

  function rotuloPendencia(p) {
    // Só o que o payload REALMENTE tem hoje (§10.8). "Fechamento pendente"
    // é CONTRATO NECESSÁRIO e por isso não é renderizado.
    const mapa = { sem_grant: "Mercado Livre não conectado", sem_base: "Base não vinculada" };
    return fmt.escapeHTML(mapa[p] || p);
  }

  function linhaCliente(c) {
    const pend = c.pendencias || [];
    const cache = contasPorCliente[c.slug];
    const ativas = cache && !cache.erro ? cache.lista.filter((x) => x.ativo !== false) : null;
    const umaConta = ativas && ativas.length === 1;
    const semConta = ativas && ativas.length === 0;

    const alerta = pend.length
      ? `<span class="vf-status is-warning"><span aria-hidden="true"></span>${pend.length} alerta${pend.length === 1 ? "" : "s"}</span>`
      : semConta
      ? '<span class="vf-status"><span aria-hidden="true"></span>sem operação</span>'
      : "";

    // 1 conta ativa: a linha inteira é o alvo. 2+: o nome vira <h3> e só os
    // chips são acionáveis (§10.4/§10.10) — decidido só quando `ativas` é
    // conhecido; antes disso o nome não é clicável (evita "clicou, não
    // aconteceu nada" enquanto a operação ainda carrega).
    const titulo = umaConta
      ? `<button type="button" class="vf-portfolio-row__name is-clickable" data-entrar="${fmt.escapeHTML(c.slug)}">${fmt.escapeHTML(c.nome)}</button>`
      : `<h3 class="vf-portfolio-row__name">${fmt.escapeHTML(c.nome)}</h3>`;

    const rodape = semConta
      ? '<p class="vf-portfolio-row__foot">Nenhuma conta configurada · <a href="clientes.html">Configurar →</a></p>'
      : pend.length
      ? `<p class="vf-portfolio-row__foot">${pend.map(rotuloPendencia).join(" · ")}</p>`
      : "";

    return (
      `<li class="vf-portfolio-row" data-slug="${fmt.escapeHTML(c.slug)}">` +
      '<div class="vf-portfolio-row__head">' +
      titulo +
      (c.responsavelDireto ? '<span class="vf-tag">responsável: você</span>' : "") +
      '<span class="vf-portfolio-row__spacer"></span>' +
      alerta +
      "</div>" +
      `<div class="vf-portfolio-row__ops" data-ops="${fmt.escapeHTML(c.slug)}">${chips(c)}</div>` +
      rodape +
      "</li>"
    );
  }

  function chips(c) {
    const cache = contasPorCliente[c.slug];
    if (!cache) {
      // Skeleton neutro — sem saber ainda quantas contas existem, não dá
      // para prometer uma largura fixa por conta (diferente do resto do
      // shell, que já conhece a cardinalidade pelo contexto ativo).
      return '<span class="vf-op-chip is-skeleton"><span class="vf-skeleton vf-skeleton--row"></span></span>';
    }
    if (cache.erro) {
      return (
        '<span class="vf-op-chip is-error">não foi possível carregar as operações · ' +
        `<button type="button" class="vf-linklike" data-recarregar="${fmt.escapeHTML(c.slug)}">tentar de novo</button></span>`
      );
    }
    const ativas = cache.lista.filter((x) => x.ativo !== false);
    if (!ativas.length) return "";
    return ativas
      .map((conta) => {
        const st = statusOperacao(conta);
        const sub = [conta.base ? "base ok" : "sem base"];
        sub.push(conta.ultimaSync ? fmt.desde(conta.ultimaSync) : "nunca sincronizou");
        return (
          `<button type="button" class="vf-op-chip" data-conta="${conta.id}" data-cliente="${fmt.escapeHTML(c.slug)}">` +
          `<span class="vf-op-chip__top"><span class="vf-status is-${st.tone}"><span aria-hidden="true"></span>` +
          `<span class="vf-visually-hidden">${fmt.escapeHTML(st.label)}</span></span>${fmt.escapeHTML(conta.nome)}</span>` +
          `<span class="vf-op-chip__label">${fmt.escapeHTML(rotuloExterno(conta))}</span>` +
          `<span class="vf-op-chip__meta">${fmt.escapeHTML(sub.join(" · "))}</span>` +
          "</button>"
        );
      })
      .join("");
  }

  function wireLinhas(box) {
    box.querySelectorAll("[data-entrar]").forEach((b) => {
      b.addEventListener("click", () => entrar(b.dataset.entrar, null));
    });
    box.querySelectorAll("[data-conta]").forEach((b) => {
      b.addEventListener("click", () => entrar(b.dataset.cliente, Number(b.dataset.conta)));
    });
    box.querySelectorAll("[data-recarregar]").forEach((b) => {
      b.addEventListener("click", () => {
        delete contasPorCliente[b.dataset.recarregar];
        buscarContas(b.dataset.recarregar);
      });
    });
    // Navegação vertical entre clientes (roving) — §10.10
    box.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const linhas = Array.prototype.slice.call(box.querySelectorAll(".vf-portfolio-row"));
      const atual = doc.activeElement && doc.activeElement.closest(".vf-portfolio-row");
      const i = linhas.indexOf(atual);
      const alvo = linhas[e.key === "ArrowDown" ? i + 1 : i - 1];
      if (!alvo) return;
      e.preventDefault();
      const foco = alvo.querySelector("[data-entrar], [data-conta]");
      if (foco) foco.focus();
    });
  }

  /* Carga sob demanda (§10.5 nível A): (a) prefetch imediato das primeiras
     PREFETCH linhas — não depende de paint nem do observer disparar, uma
     linha já na dobra não pode ficar em skeleton à toa; (b)
     IntersectionObserver para o resto, conforme o operador rola. */
  function observarVisiveis(box) {
    const nos = Array.prototype.slice.call(box.querySelectorAll("[data-ops]"));
    nos.slice(0, PREFETCH).forEach((n) => buscarContas(n.dataset.ops));

    if (typeof IntersectionObserver === "undefined") {
      nos.slice(PREFETCH).forEach((n) => buscarContas(n.dataset.ops));
      return;
    }
    observer = new IntersectionObserver((entradas) => {
      entradas.forEach((e) => {
        if (!e.isIntersecting) return;
        buscarContas(e.target.dataset.ops);
        observer.unobserve(e.target);
      });
    }, { rootMargin: "160px" });
    nos.slice(PREFETCH).forEach((n) => observer.observe(n));
  }

  function dedupe(lista) {
    const vistos = new Set();
    const out = [];
    (lista || []).forEach((c) => { if (c && !vistos.has(c.id)) { vistos.add(c.id); out.push(c); } });
    return out;
  }

  function buscarContas(slug) {
    if (!slug || contasPorCliente[slug] || carregandoContas[slug]) return;
    carregandoContas[slug] = true;
    api
      .contasDoCliente(slug)
      .then((resp) => {
        carregandoContas[slug] = false;
        // Dedupe aqui também: o fan-out de listarContasDoCliente
        // transformaria uma conta em duas (I6) — a Carteira também conta
        // operações, não só o seletor do shell.
        contasPorCliente[slug] = resp && resp.ok !== false ? { lista: dedupe(resp.contas || []) } : { erro: true };
        pintarLinha(slug);
      })
      .catch(() => {
        carregandoContas[slug] = false;
        contasPorCliente[slug] = { erro: true };
        pintarLinha(slug);
      });
  }

  function pintarLinha(slug) {
    if (!host) return;
    const antigo = host.querySelector(`.vf-portfolio-row[data-slug="${cssEscape(slug)}"]`);
    if (!antigo) return;
    const clientes = ctxStore.getPortfolio();
    const c = clientes.find((x) => x.slug === slug);
    if (!c) return;
    const tpl = doc.createElement("template");
    tpl.innerHTML = linhaCliente(c).trim();
    const novo = tpl.content.firstElementChild;
    antigo.replaceWith(novo);
    wireLinhas(novo.parentElement || host.querySelector("#cart-lista"));
  }

  function cssEscape(s) {
    return String(s).replace(/["\\]/g, "\\$&");
  }

  /* Entrar no contexto a partir da Carteira. A conta só pode ser fixada
     DEPOIS de as contas carregarem no store — ele aplica a cardinalidade
     primeiro e só então aceita setConta (I2/I3). Por isso a espera é por
     estado, não por timeout — mesmo padrão do protótipo. */
  function entrar(slug, contaId) {
    let primeiro = true;
    const S = ctxStore.STATES;
    const un = ctxStore.subscribe((snap) => {
      if (primeiro) { primeiro = false; return; } // subscribe entrega o snapshot atual na hora — não conta
      if (snap.state === S.READY) {
        un();
        if (contaId && snap.context.clienteContaId !== contaId) ctxStore.setConta(contaId);
        onNavigate(destino(snap.context));
        return;
      }
      if (snap.state === S.ACCOUNT_CHOICE_REQUIRED) {
        un();
        // Clicou num chip: a escolha já foi explícita, é só fixá-la —
        // setConta() é síncrono aqui (as contas já estão carregadas), então
        // navegar logo em seguida já leva o contexto certo.
        if (contaId) ctxStore.setConta(contaId);
        onNavigate(destino(ctxStore.getContext()));
        return;
      }
      if (snap.state === S.NO_ACTIVE_ACCOUNT) { un(); onNavigate(destino(snap.context)); return; }
      if (snap.state === S.FORBIDDEN || snap.state === S.INVALID_CLIENT) un();
    });
    ctxStore.setCliente(slug);
  }

  function destino(ctx) {
    const qs = new URLSearchParams();
    qs.set("shell", "v3");
    if (ctx && ctx.clienteSlug) qs.set("cliente", ctx.clienteSlug);
    if (ctx && ctx.clienteContaId) qs.set("conta", String(ctx.clienteContaId));
    return `${DESTINO_PADRAO}?${qs.toString()}`;
  }

  function atalhoBusca(e) {
    if (e.key !== "/" || !host) return;
    const alvo = e.target;
    if (alvo && (alvo.tagName === "INPUT" || alvo.tagName === "TEXTAREA" || alvo.tagName === "SELECT")) return;
    const buscaEl = host.querySelector("#cart-busca");
    if (buscaEl) { e.preventDefault(); buscaEl.focus(); }
  }
  doc.addEventListener("keydown", atalhoBusca);

  return { montar, desmontar };
}

function bootProduction() {
  if (typeof document === "undefined") return null;
  const root = document.getElementById("carteira-root");
  if (!root) return null;
  const carteira = createCarteira({});
  carteira.montar(root);
  return carteira;
}

export const carteira = typeof document !== "undefined" ? bootProduction() : null;

if (typeof window !== "undefined") {
  window.VF = window.VF || {};
  window.VF.carteira = carteira;
}
