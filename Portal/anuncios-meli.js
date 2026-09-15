/* =============================================================================
   Anúncios Meli — lógica do módulo (JavaScript puro, sem dependências)
   Central operacional + Agente Otimizador Textual IA.

   Endpoints consumidos:
     GET   /anuncios-meli/clientes
     POST  /anuncios-meli/sync
     GET   /anuncios-meli/resumo?clienteSlug=
     GET   /anuncios-meli?clienteSlug=...
     GET   /anuncios-meli/:itemId?clienteSlug=
     PATCH /anuncios-meli/:itemId/conteudo         (escreve no Mercado Livre)
     PATCH /anuncios-meli/:itemId/revisao
     POST  /anuncios-meli/:itemId/otimizar         (admin)
     GET   /anuncios-meli/:itemId/otimizacoes      (admin)
     PATCH /anuncios-meli/otimizacoes/:id/aprovar  (admin)
   ========================================================================== */
(function () {
  "use strict";

  var API_BASE = "https://venforce-server.onrender.com";

  // Estado global do módulo
  var AM = {
    token: null,
    // Fonte de PRONTIDÃO (mlConectado), não seletor — ver
    // carregarProntidaoClientes(). `prontidaoCarregada` separa "ainda não sei"
    // de "sei que este cliente não está na lista".
    clientes: [],
    prontidaoCarregada: false,
    clienteAtual: null,
    resumo: null,
    anuncios: [],
    paginacao: { page: 1, limit: 24, total: 0, totalPaginas: 1 },
    filtros: { q: "", status: "", filtro: "" },
    // Card de KPI atualmente selecionado como filtro rápido (V3 — os cards
    // do resumo substituem os antigos <select> de Status/Qualidade). Guarda
    // só a CHAVE do KPI; o valor real que vai para AM.filtros.status/filtro
    // continua vindo do mesmo mapa usado para montar os cards (KPI_DEFS).
    kpiAtivo: null,
    buscaTimer: null,
    carregandoCatalogo: false,
    // Guarda de corrida (mesma classe de bug corrigida em automacoes.js/
    // ads.js): sem isso, a resposta LENTA da conta anterior podia chegar
    // depois da resposta rápida da conta nova e sobrescrever resumo/catálogo
    // em tela como se fossem da conta selecionada agora.
    resumoToken: 0,
    catalogoToken: 0,
    // A operação escolhida no Shell (data-vf-scope="account"). Esta tela não
    // decide mais cardinalidade — vf-context.js decide (R8).
    contaMlId: "",
    // Estado do detalhe aberto:
    detalheAtual: null,    // { anuncio, descricao }
    otimizacoes: {         // últimas otimizações por tipo (rascunho ou aprovada)
      seo: null,
      descricao: null,
      ficha_tecnica: null,
    },
  };

  // ===========================================================================
  // Helpers
  // ===========================================================================
  function el(id) { return document.getElementById(id); }

  function escapeHtml(v) {
    if (v === null || v === undefined) return "";
    return String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  // Valor seguro para dentro de um atributo HTML (o " já é escapado por
  // escapeHtml; a quebra de linha vira espaço porque atributo não tem linha).
  function escapeAttr(v) {
    return escapeHtml(String(v === null || v === undefined ? "" : v).replace(/\n/g, " "));
  }

  function formatMoeda(v, moeda) {
    if (v === null || v === undefined || v === "") return "—";
    var n = Number(v); if (isNaN(n)) return "—";
    var s = moeda === "USD" ? "US$" : "R$";
    return s + " " + n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatData(iso) {
    if (!iso) return "nunca";
    var d = new Date(iso); if (isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("pt-BR") + " " +
      d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }

  function statusInfo(s) {
    switch (s) {
      case "active":       return { label: "Ativo", classe: "is-success" };
      case "paused":       return { label: "Pausado", classe: "is-warning" };
      case "closed":       return { label: "Encerrado", classe: "is-danger" };
      case "under_review": return { label: "Em revisão", classe: "is-info" };
      default:             return { label: s || "—", classe: "is-neutral" };
    }
  }

  function scoreClasse(s) {
    if (s >= 80) return "is-success";
    if (s >= 60) return "is-warning";
    return "is-danger";
  }

  function scoreLegenda(s) {
    if (s >= 80) return "Score muito bom";
    if (s >= 60) return "Score razoável";
    return "Score baixo";
  }

  // Medidor semicircular do Score VenForce (estilo Mercado Livre): arco de
  // fundo cinza + arco colorido proporcional ao score, número central e
  // legenda curta abaixo. Path fixo (raio 28, viewBox 64x34) — só o
  // stroke-dasharray do arco de progresso muda por item.
  var AM_GAUGE_ARC_LEN = 87.96; // comprimento do semicírculo (pi * raio 28)
  function scoreGaugeHtml(score) {
    var s = score === null || score === undefined ? 0 : Number(score);
    if (isNaN(s)) s = 0;
    var pct = Math.max(0, Math.min(100, s));
    var classe = scoreClasse(s);
    var dash = (pct / 100 * AM_GAUGE_ARC_LEN).toFixed(1);
    var scoreTxt = score === null || score === undefined ? "—" : s;
    return '<div class="am-gauge">' +
      '<div class="am-gauge__wrap">' +
        '<svg viewBox="0 0 64 34" width="64" height="34" aria-hidden="true">' +
          '<path d="M4 32 A28 28 0 0 1 60 32" fill="none" stroke-width="6" stroke-linecap="round" class="am-gauge__track"/>' +
          '<path d="M4 32 A28 28 0 0 1 60 32" fill="none" stroke-width="6" stroke-linecap="round" ' +
            'class="am-gauge__arc ' + classe + '" stroke-dasharray="' + dash + ' 200"/>' +
        "</svg>" +
        '<span class="am-gauge__value ' + classe + '">' + scoreTxt + "</span>" +
      "</div>" +
      '<span class="am-gauge__legenda">' + scoreLegenda(s) + "</span>" +
    "</div>";
  }

  // ===========================================================================
  // KPIs do resumo — também funcionam como filtros rápidos da listagem (V3).
  // `campo` lê o valor pronto de AM.resumo; `tipo`+`valor` dizem o que setar
  // em AM.filtros ao clicar (mesmo mecanismo de query string que os antigos
  // <select> de Status/Qualidade já usavam — só a forma de disparar mudou).
  // ===========================================================================
  // `estado` colore o texto de apoio (meta); `accent` é o filete lateral
  // (box-shadow inset) — só os KPIs de qualidade/risco têm filete, igual
  // ao canva "modelo 1-principal" (Main.dc.html): Total/Ativos/Pausados
  // não têm, e Mercado Full tem filete info mas texto neutro.
  // `meta` pode ser string fixa ou function(r) para texto calculado a
  // partir do próprio resumo (ex.: % de ativos sobre o total).
  var KPI_DEFS = [
    { key: "total", label: "Total de anúncios", campo: "total", meta: "Catálogo sincronizado", estado: "neutral", accent: "" },
    {
      key: "ativos", label: "Ativos", campo: "ativos", estado: "success", accent: "", tipo: "status", valor: "active",
      meta: function (r) {
        var total = r.total || 0;
        var pct = total > 0 ? Math.round(((r.ativos || 0) / total) * 100) : 0;
        return pct + "% do catálogo";
      },
    },
    { key: "pausados", label: "Pausados", campo: "pausados", meta: "Pedem acompanhamento", estado: "warning", accent: "", tipo: "status", valor: "paused" },
    { key: "score_muito_bom", label: "Score muito bom", campo: "scoreMuitoBom", meta: "80 pontos ou mais", estado: "success", accent: "success", tipo: "filtro", valor: "score_muito_bom" },
    { key: "score_medio", label: "Score médio", campo: "scoreMedio", meta: "Média de 100 pontos", estado: "warning", accent: "warning", tipo: "filtro", valor: "score_medio" },
    { key: "score_baixo", label: "Score baixo", campo: "scoreBaixo", meta: "Abaixo de 60 pontos", estado: "danger", accent: "danger", tipo: "filtro", valor: "score_baixo" },
    { key: "mercado_full", label: "Mercado Full", campo: "full", meta: "Com logística Full", estado: "neutral", accent: "info", tipo: "filtro", valor: "mercado_full" },
    { key: "sem_sku", label: "Sem SKU", campo: "semSku", meta: "Sem identificação interna", estado: "danger", accent: "neutral", tipo: "filtro", valor: "sem_sku" },
  ];

  function alternarFiltroKpi(key) {
    var def = null;
    for (var i = 0; i < KPI_DEFS.length; i++) if (KPI_DEFS[i].key === key) def = KPI_DEFS[i];

    if (AM.kpiAtivo === key || key === "total" || !def || !def.tipo) {
      // clicar de novo no mesmo card (ou em "Total") limpa o filtro
      AM.kpiAtivo = null;
      AM.filtros.status = "";
      AM.filtros.filtro = "";
    } else {
      AM.kpiAtivo = key;
      AM.filtros.status = def.tipo === "status" ? def.valor : "";
      AM.filtros.filtro = def.tipo === "filtro" ? def.valor : "";
    }
    AM.paginacao.page = 1;
    atualizarIndicadorFiltros();
    renderResumo();
    carregarAnuncios();
  }

  function tryParseJSON(v, fallback) {
    if (Array.isArray(v) || (v && typeof v === "object")) return v;
    if (!v) return fallback;
    try { return JSON.parse(v); } catch (e) { return fallback; }
  }

  function copiarTexto(texto, mensagem) {
    var txt = String(texto || "");
    if (!txt) { toast("Nada para copiar."); return; }
    try {
      navigator.clipboard.writeText(txt).then(
        function () { toast(mensagem || "Copiado!"); },
        function () { copiarFallback(txt, mensagem); }
      );
    } catch (e) {
      copiarFallback(txt, mensagem);
    }
  }

  function copiarFallback(txt, mensagem) {
    var ta = document.createElement("textarea");
    ta.value = txt;
    ta.className = "am-copy-fallback";
    ta.setAttribute("aria-hidden", "true");
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); toast(mensagem || "Copiado!"); }
    catch (e) { toast("Não consegui copiar."); }
    document.body.removeChild(ta);
  }

  function toast(msg, tipo) {
    var stack = el("am-toast-stack");
    if (!stack) return;
    var t = document.createElement("div");
    t.className = "vf-toast " + (tipo || "is-info");
    t.setAttribute("role", "status");
    t.innerHTML = '<div class="vf-toast__content"><p class="vf-toast__description">' +
      escapeHtml(msg) + "</p></div>";
    stack.appendChild(t);
    setTimeout(function () {
      if (t.parentNode) t.parentNode.removeChild(t);
    }, 3200);
  }

  function estadoHtml(tipo, titulo, descricao) {
    if (tipo === "loading") {
      return '<div class="vf-loading-state" aria-live="polite">' +
        '<span class="vf-spinner" aria-hidden="true"></span><span>' +
        escapeHtml(titulo) + "</span></div>";
    }
    var erro = tipo === "error";
    return '<div class="vf-empty"' + (erro ? ' role="alert"' : "") + ">" +
      (erro ? '<div class="vf-empty__icon is-danger" aria-hidden="true">!</div>' : "") +
      '<p class="vf-empty__title">' + escapeHtml(titulo) + "</p>" +
      (descricao ? '<p class="vf-empty__description">' + escapeHtml(descricao) + "</p>" : "") +
      "</div>";
  }

  function atualizarIndicadorFiltros() {
    var indicador = el("am-filtros-ativos");
    if (!indicador) return;
    var total = [AM.filtros.q, AM.filtros.status, AM.filtros.filtro].filter(Boolean).length;
    indicador.textContent = total === 1 ? "1 filtro ativo" : total + " filtros ativos";
    indicador.classList.toggle("am-hidden", total === 0);
  }

  // ===========================================================================
  // Camada HTTP
  // ===========================================================================
  function api(path, opts) {
    opts = opts || {};
    var headers = {
      "Content-Type": "application/json",
      Authorization: "Bearer " + (AM.token || ""),
    };
    if (opts.headers) for (var k in opts.headers) headers[k] = opts.headers[k];
    return fetch(API_BASE + path, {
      method: opts.method || "GET",
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    })
      .then(function (r) {
        return r.json().catch(function () { return {}; })
          .then(function (data) { return { status: r.status, data: data }; });
      })
      .catch(function () {
        return { status: 0, data: { ok: false, motivo: "Falha de conexão." } };
      });
  }

  // ===========================================================================
  // Inicialização e bind de eventos fixos
  // ===========================================================================
  function init() {
    AM.token = localStorage.getItem("vf-token");
    if (!AM.token) {
      el("am-clientes-container").innerHTML =
        estadoHtml("error", "Sessão não encontrada", "Faça login no portal para usar os Anúncios ML.");
      return;
    }
    // F5 — initLayout() saiu com o layout.js; vf-shell.js monta a navegação.
    bindEventosFixos();
    carregarProntidaoClientes();
    aplicarContextoDoShell();
  }

  /* ── CONTEXTO (F5 — vem do Shell V3, não mais desta tela) ──────────────
     A tela tinha uma VIEW inteira só para escolher o cliente e um seletor
     de conta Mercado Livre por cima. Os dois viraram o mesmo par de
     dropdowns do Shell, e a regra de cardinalidade voltou a existir num
     lugar só (vf-context.js, R8).

     O listener é registrado no init(), que roda enquanto este script
     clássico é avaliado — antes de vf-shell.js (module, deferido) publicar
     o store —, então nenhum emit se perde. */
  function contextoDoShell() {
    var store = window.VF && window.VF.context ? window.VF.context : null;
    var ctx = store ? store.getContext() : null;
    // Escopo CONTA: cliente sem operação ainda não é contexto para esta tela.
    // `vf:context` emite durante a resolução das contas (cliente já
    // conhecido, conta ainda não) — buscar aí gastaria uma requisição para
    // um recorte que o operador não escolheu.
    if (!ctx || !ctx.clienteSlug || !ctx.clienteContaId) return null;
    var cliente = store.getClienteAtual ? store.getClienteAtual() : null;
    return {
      slug: ctx.clienteSlug,
      nome: cliente ? cliente.nome : ctx.clienteSlug,
      contaId: ctx.clienteContaId ? String(ctx.clienteContaId) : "",
    };
  }

  var ultimoContextoAplicado = null;
  function aplicarContextoDoShell() {
    var ctx = contextoDoShell();
    var chave = ctx ? ctx.slug + ":" + ctx.contaId : "";
    if (chave === ultimoContextoAplicado) return;
    ultimoContextoAplicado = chave;

    // O detalhe é de UM anúncio de UMA conta. Trocar de operação não pode
    // deixar o modal da conta anterior em tela — nem descartar em silêncio o
    // que o operador estava digitando: com alteração pendente, o modal fica e
    // pede a decisão; sem nada pendente, ele simplesmente fecha.
    if (DET && DET.aberto) {
      if (camposSujos().length) pedirConfirmacaoSaida();
      else fecharDetalhe(true);
    }

    if (!ctx) { AM.clienteAtual = null; AM.contaMlId = ""; return; }

    AM.clienteAtual = { slug: ctx.slug, nome: ctx.nome };
    AM.contaMlId = ctx.contaId;
    AM.resumo = null;
    AM.paginacao.page = 1;
    AM.filtros = { q: "", status: "", filtro: "" };
    AM.kpiAtivo = null;
    if (el("am-busca")) el("am-busca").value = "";
    atualizarIndicadorFiltros();
    renderHudHeader();
    carregarResumo();
    carregarAnuncios();
  }

  function bindEventosFixos() {
    document.addEventListener("vf:context", aplicarContextoDoShell);
    el("am-busca").addEventListener("input", function (e) {
      AM.filtros.q = e.target.value;
      atualizarIndicadorFiltros();
      if (AM.buscaTimer) clearTimeout(AM.buscaTimer);
      AM.buscaTimer = setTimeout(function () { AM.paginacao.page = 1; carregarAnuncios(); }, 350);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") fecharDetalhe();
    });
  }

  // ===========================================================================
  // Prontidão dos clientes — fonte, não seletor (F5)
  // ===========================================================================
  // GET /anuncios-meli/clientes continua sendo chamado: ele é quem sabe se a
  // conta ML do cliente está conectada. Deixou de virar um grid clicável — a
  // escolha é do Shell. `prontidaoCarregada` distingue "ainda não sei" de
  // "sei que este cliente não está aqui": sem isso, o intervalo entre o boot
  // e a resposta pareceria "Sem conexão ML", que é uma afirmação.
  function carregarProntidaoClientes() {
    api("/anuncios-meli/clientes").then(function (r) {
      AM.clientes = r.data && r.data.ok && Array.isArray(r.data.clientes) ? r.data.clientes : [];
      AM.prontidaoCarregada = !!(r.data && r.data.ok);
      if (AM.clienteAtual) renderHudHeader();
    });
  }

  // ===========================================================================
  // VIEW 2 — HUD do cliente
  // ===========================================================================
  function renderHudHeader() {
    var c = AM.clienteAtual;
    var resumo = AM.resumo;
    var clienteCompleto = AM.clientes.find(function (item) { return item.slug === c.slug; }) || null;
    // Três estados, não dois: conectado · não conectado · não sabemos ainda
    // (ou este cliente não está na lista de Anúncios ML). Renderizar
    // "Sem conexão ML" para o terceiro caso seria afirmar um diagnóstico
    // que não foi feito.
    var conexao = clienteCompleto
      ? (clienteCompleto.mlConectado ? { cls: "is-success", txt: "ML conectado" } : { cls: "is-danger", txt: "Sem conexão ML" })
      : (AM.prontidaoCarregada ? { cls: "is-warning", txt: "Fora da lista de Anúncios ML" } : { cls: "is-info", txt: "Verificando conexão ML…" });
    var subInfo = resumo
      ? '<span>Última sincronização: <strong>' + formatData(resumo.ultimaSync) + "</strong></span>" +
        '<span>Total sincronizado: <strong>' + (resumo.total || 0) + " anúncios</strong></span>"
      : '<span class="vf-status is-info">Carregando resumo…</span>';

    el("am-hud-top").innerHTML =
      '<div class="am-cliente-contexto vf-card">' +
        '<div class="am-cliente-contexto__info">' +
          '<div class="am-cliente-contexto__title-row"><div>' +
            '<p class="am-cliente-contexto__eyebrow">Cliente selecionado</p>' +
            '<h2 id="am-cliente-contexto-titulo">' + escapeHtml(c.nome) + "</h2></div>" +
            '<span class="vf-status ' + conexao.cls + '">' + conexao.txt + "</span></div>" +
          '<div class="am-hud-sub">' + subInfo + "</div>" +
        "</div>" +
        '<div class="am-sync-area">' +
          '<p class="am-sync-area__description"><strong>Atualizar novos</strong> busca inclusões recentes. <strong>Sincronização completa</strong> revisa todo o catálogo.</p>' +
          '<div class="am-hud-actions">' +
            '<button type="button" class="vf-btn vf-btn--secondary" id="am-sync-novos">Atualizar novos</button>' +
            '<button type="button" class="vf-btn vf-btn--primary" id="am-sync-completo">Sincronização completa</button>' +
          "</div>" +
        "</div>" +
      "</div>";

    el("am-sync-novos").addEventListener("click", function () { sincronizar("novos"); });
    el("am-sync-completo").addEventListener("click", function () { sincronizar("completo"); });
  }

  function carregarResumo() {
    if (!AM.clienteAtual) return;
    var meuToken = ++AM.resumoToken;
    var qs = "clienteSlug=" + encodeURIComponent(AM.clienteAtual.slug);
    if (AM.contaMlId) qs += "&clienteContaId=" + encodeURIComponent(AM.contaMlId);
    api("/anuncios-meli/resumo?" + qs)
      .then(function (r) {
        if (meuToken !== AM.resumoToken) return; // troca de conta/cliente já disparou outra busca
        if (r.data && r.data.ok) {
          AM.resumo = r.data.resumo;
          renderHudHeader();
          renderResumo();
        }
      });
  }

  function renderResumo() {
    var r = AM.resumo || {};
    var html = "";
    KPI_DEFS.forEach(function (k) {
      var ativo = AM.kpiAtivo === k.key;
      var meta = typeof k.meta === "function" ? k.meta(r) : k.meta;
      html += '<button type="button" class="vf-metric am-kpi' +
        (k.accent ? " is-" + k.accent : "") +
        (ativo ? " is-active" : "") + '" data-kpi="' + k.key + '"' +
        (ativo ? ' aria-pressed="true"' : ' aria-pressed="false"') + '>' +
        '<span class="vf-metric__label">' + k.label + "</span>" +
        '<strong class="vf-metric__value">' + (r[k.campo] || 0) + "</strong>" +
        '<span class="vf-metric__foot is-' + k.estado + '">' + meta + "</span></button>";
    });
    var box = el("am-resumo");
    box.innerHTML = html;
    box.querySelectorAll("[data-kpi]").forEach(function (btn) {
      btn.addEventListener("click", function () { alternarFiltroKpi(this.getAttribute("data-kpi")); });
    });
  }

  function carregarAnuncios() {
    if (!AM.clienteAtual) return;
    var meuToken = ++AM.catalogoToken;
    var box = el("am-catalogo-container");

    AM.carregandoCatalogo = true;
    box.innerHTML = estadoHtml("loading", "Carregando anúncios…");

    var qs = "clienteSlug=" + encodeURIComponent(AM.clienteAtual.slug) +
             "&page=" + AM.paginacao.page + "&limit=" + AM.paginacao.limit;
    if (AM.filtros.q) qs += "&q=" + encodeURIComponent(AM.filtros.q);
    if (AM.filtros.status) qs += "&status=" + encodeURIComponent(AM.filtros.status);
    if (AM.filtros.filtro) qs += "&filtro=" + encodeURIComponent(AM.filtros.filtro);
    if (AM.contaMlId) qs += "&clienteContaId=" + encodeURIComponent(AM.contaMlId);

    api("/anuncios-meli?" + qs).then(function (r) {
      if (meuToken !== AM.catalogoToken) return; // troca de conta/cliente (ou novo filtro) já disparou outra busca
      AM.carregandoCatalogo = false;
      if (!r.data || !r.data.ok) {
        box.innerHTML = estadoHtml("error", "Erro ao carregar",
          (r.data && r.data.motivo) || "Tente novamente.");
        return;
      }
      AM.anuncios = r.data.anuncios || [];
      AM.paginacao = r.data.paginacao || AM.paginacao;
      renderCatalogo();
    });
  }

  function renderCatalogo() {
    var box = el("am-catalogo-container");
    if (!AM.anuncios.length) {
      var temFiltro = AM.filtros.q || AM.filtros.status || AM.filtros.filtro;
      box.innerHTML = estadoHtml("empty",
        temFiltro ? "Nenhum anúncio para esse filtro" : "Nenhum anúncio sincronizado",
        temFiltro ? "Ajuste a busca ou os filtros acima."
          : 'Use o botão "Sincronização completa" para trazer os anúncios deste cliente.');
      return;
    }

    var html = '<div class="am-listagem" aria-label="Lista de anúncios">' +
      '<div class="am-listagem__head" aria-hidden="true">' +
        "<span></span><span>Anúncio</span><span>Status</span><span>Preço</span>" +
        "<span>Estoque</span><span>Vendidos</span><span>Score VenForce</span><span></span>" +
      "</div>";
    AM.anuncios.forEach(function (a) { html += rowAnuncioHtml(a); });
    html += "</div>" + paginacaoHtml();
    box.innerHTML = html;

    var rows = box.querySelectorAll(".am-row[data-item]");
    for (var i = 0; i < rows.length; i++) {
      (function (row) {
        function abrir() { abrirDetalhe(row.getAttribute("data-item"), row); }
        row.addEventListener("click", function (e) {
          if (e.target.closest(".am-row__link")) return; // ação externa não abre o drawer
          abrir();
        });
        row.addEventListener("keydown", function (e) {
          if (e.target.closest(".am-row__link")) return; // deixa o link nativo agir (Enter = navegar)
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); abrir(); }
        });
      })(rows[i]);
    }

    var btnPrev = el("am-pag-prev"), btnNext = el("am-pag-next");
    if (btnPrev) btnPrev.addEventListener("click", function () {
      if (AM.paginacao.page > 1) { AM.paginacao.page--; carregarAnuncios(); window.scrollTo({ top: 0, behavior: "smooth" }); }
    });
    if (btnNext) btnNext.addEventListener("click", function () {
      if (AM.paginacao.page < AM.paginacao.totalPaginas) { AM.paginacao.page++; carregarAnuncios(); window.scrollTo({ top: 0, behavior: "smooth" }); }
    });
  }

  function iconeImagemSvg() {
    return '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5">' +
      '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/>' +
      '<path d="M21 15l-5-5-4 4-3-3-6 6"/></svg>';
  }

  function iconeExternoSvg() {
    return '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8">' +
      '<path d="M7 17 17 7M9 7h8v8"/></svg>';
  }

  // Uma linha do catálogo (V3 — grid, não mais card): imagem, título/MLB/SKU,
  // badges, status, preço, estoque, vendidos, score em medidor semicircular
  // e ação externa para o Mercado Livre. A linha inteira abre o drawer
  // existente (abrirDetalhe) — mesmo endpoint/handler de sempre.
  function rowAnuncioHtml(a) {
    var st = statusInfo(a.status);
    var badges = "";
    if (a.catalog_listing) badges += '<span class="vf-tag is-primary">Catálogo</span>';
    if (a.is_full) badges += '<span class="vf-tag is-info">Full</span>';
    if ((a.pictures_count || 0) < 3) badges += '<span class="vf-tag is-warning">' + (a.pictures_count || 0) + "/3 fotos</span>";
    if (!a.sku) badges += '<span class="vf-tag is-danger">Sem SKU</span>';
    if (a.revisado) badges += '<span class="vf-tag is-success">Revisado</span>';

    var img = a.thumbnail
      ? '<img src="' + escapeHtml(a.thumbnail) + '" alt="" loading="lazy" />'
      : iconeImagemSvg();

    var skuHtml = a.sku
      ? '<span>SKU <span class="vf-mono">' + escapeHtml(a.sku) + "</span></span>"
      : '<span>SKU <span class="vf-mono am-row__sem-sku">—</span></span>';

    var linkMl = a.permalink
      ? '<a class="am-row__link" href="' + escapeHtml(a.permalink) + '" target="_blank" rel="noopener" ' +
        'aria-label="Abrir ' + escapeHtml(a.titulo || a.item_id) + ' no Mercado Livre" title="Abrir no Mercado Livre">' +
        iconeExternoSvg() + "</a>"
      : "";

    return '<div class="am-row" data-item="' + escapeHtml(a.item_id) + '" tabindex="0" role="button" ' +
      'aria-label="Ver detalhes de ' + escapeHtml(a.titulo || a.item_id) + '">' +
      '<div class="am-row__thumb" aria-hidden="true">' + img + "</div>" +
      '<div class="am-row__main">' +
        '<h3 class="am-row__titulo">' + escapeHtml(a.titulo || "(sem título)") + "</h3>" +
        '<div class="am-row__ids"><span class="vf-mono">' + escapeHtml(a.item_id) + "</span>" + skuHtml + "</div>" +
        '<div class="am-row__badges">' + badges + "</div>" +
      "</div>" +
      '<span class="vf-status ' + st.classe + '">' + st.label + "</span>" +
      '<span class="am-row__preco">' + formatMoeda(a.preco, a.moeda) + "</span>" +
      '<span class="am-row__num">' + (a.estoque != null ? a.estoque : "—") + "</span>" +
      '<span class="am-row__num">' + (a.vendidos != null ? a.vendidos : "—") + "</span>" +
      scoreGaugeHtml(a.score_venforce) +
      '<div class="am-row__acao">' + linkMl + "</div>" +
    "</div>";
  }

  function paginacaoHtml() {
    var p = AM.paginacao;
    if (p.totalPaginas <= 1) return '<nav class="vf-pagination am-paginacao" aria-label="Paginação do catálogo"><span class="vf-pagination__info">' + p.total + " anúncio(s)</span></nav>";
    return '<nav class="vf-pagination am-paginacao" aria-label="Paginação do catálogo">' +
      '<span class="vf-pagination__info">Página ' + p.page + " de " + p.totalPaginas + " · " + p.total + " anúncios</span>" +
      '<div class="vf-pagination__actions">' +
      '<button type="button" class="vf-btn vf-btn--secondary vf-btn--sm" id="am-pag-prev"' + (p.page <= 1 ? " disabled" : "") + ">← Anterior</button>" +
      '<button type="button" class="vf-btn vf-btn--secondary vf-btn--sm" id="am-pag-next"' + (p.page >= p.totalPaginas ? " disabled" : "") + ">Próxima →</button></div>" +
      "</nav>";
  }

  // ===========================================================================
  // DETALHE DO ANÚNCIO — modal central de superfície única (canva aprovado)
  //
  // Substitui o drawer lateral + 5 abas. A arquitetura agora é: um modal
  // central grande, uma única superfície, rolagem vertical. Nada de tabs, nada
  // de drawer por baixo.
  //
  // O que mudou de verdade (além do visual):
  //  - Título, Modelo e Descrição são EDITÁVEIS e PERSISTEM no anúncio real
  //    (PATCH /:itemId/conteudo → API do Mercado Livre). O achado F-03 da
  //    auditoria ("campos que parecem edição e são rascunho") morre aqui;
  //  - cada conteúdo tem UMA representação principal. O título mora no
  //    cabeçalho; o modelo, no bloco Comercial & catálogo; a descrição, no
  //    campo editável da seção Descrição. As colunas "Atual" das comparações
  //    com a IA apontam para elas em vez de duplicá-las como campo;
  //  - "Aprovar" continua sendo decisão INTERNA (grava em
  //    meli_anuncio_otimizacoes). Quem altera o anúncio é "Salvar alterações".
  // ===========================================================================
  var detalheFocusAnterior = null;

  // Estado do modal aberto. `token` é a guarda de corrida: toda resposta traz
  // o token da abertura que a pediu e é descartada se não for mais a atual —
  // sem isso a resposta lenta da Conta A / do anúncio A pinta a tela do B.
  var DET = null;
  var detalheToken = 0;

  var TIPO_ANUNCIO = {
    gold_special: "Clássico",
    gold_pro: "Premium",
    gold_premium: "Ouro Premium",
    gold: "Ouro",
    silver: "Prata",
    bronze: "Bronze",
    free: "Grátis",
  };

  var CAMPOS_EDITAVEIS = [
    { chave: "titulo", rotulo: "Título" },
    { chave: "modelo", rotulo: "Modelo" },
    { chave: "descricao", rotulo: "Descrição" },
  ];

  // ---------------------------------------------------------------------------
  // Ícones (mesmos traços do canva aprovado)
  // ---------------------------------------------------------------------------
  function svgIcone(paths, tamanho, largura) {
    return '<svg width="' + tamanho + '" height="' + tamanho + '" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="' + (largura || 2) + '" stroke-linecap="round" ' +
      'stroke-linejoin="round" aria-hidden="true">' + paths + "</svg>";
  }
  function icFechar() { return svgIcone('<path d="M18 6 6 18M6 6l12 12"/>', 16); }
  function icImagem(t) { return svgIcone('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>', t || 24, 1.6); }
  function icCheck(t) { return svgIcone('<path d="M20 6 9 17l-5-5"/>', t || 13); }
  function icAlerta(t) { return svgIcone('<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/><path d="M12 9v4M12 17h.01"/>', t || 13); }
  function icDesfazer(t) { return svgIcone('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>', t || 13); }
  function icLapis(t) { return svgIcone('<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>', t || 12, 1.8); }
  function icExterno(t) { return svgIcone('<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14 21 3"/>', t || 12); }
  function icIa(t) { return svgIcone('<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/>', t || 12, 1.75); }

  // ---------------------------------------------------------------------------
  // Formatações locais do detalhe
  // ---------------------------------------------------------------------------
  function formatRelativo(iso) {
    if (!iso) return "nunca sincronizado";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "sincronização desconhecida";
    var min = Math.round((Date.now() - d.getTime()) / 60000);
    if (min < 1) return "sincronizado agora";
    if (min < 60) return "sincronizado há " + min + "min";
    var h = Math.round(min / 60);
    if (h < 24) return "sincronizado há " + h + "h";
    return "sincronizado em " + formatData(iso);
  }

  function valorAtributo(a) {
    if (!a) return "";
    if (a.value) return String(a.value);
    if (a.value_name) return String(a.value_name);
    if (Array.isArray(a.values) && a.values[0] && a.values[0].name) return String(a.values[0].name);
    return "";
  }

  function nomeAtributo(a) { return (a && (a.name || a.id)) || "—"; }

  // ---------------------------------------------------------------------------
  // Abrir / fechar
  // ---------------------------------------------------------------------------
  function abrirDetalhe(itemId, trigger) {
    if (DET && DET.aberto) fecharDetalhe(true);

    AM.detalheAtual = null;
    AM.otimizacoes = { seo: null, descricao: null, ficha_tecnica: null };
    detalheFocusAnterior = trigger || document.activeElement;

    var meuToken = ++detalheToken;
    DET = {
      token: meuToken,
      aberto: true,
      itemId: String(itemId),
      contextoChave: (AM.clienteAtual ? AM.clienteAtual.slug : "") + ":" + (AM.contaMlId || ""),
      anuncio: null,
      descricao: null,
      descricaoEstado: null,
      descricaoErro: null,
      descricaoOrigem: null,
      descricaoOrigemHora: null,
      // Nome legível da categoria (ex. "Celulares e Smartphones"), resolvido
      // pelo backend. null até a resposta chegar OU quando a resolução falha
      // — nos dois casos o render cai para o category_id cru (fallback seguro).
      categoriaNome: null,
      original: { titulo: "", modelo: "", descricao: "" },
      rascunho: { titulo: "", modelo: "", descricao: "" },
      erros: {},
      salvando: false,
      confirmandoSaida: false,
      iaBloqueada: false,
      alternativasAbertas: false,
      carregado: false,
    };
    chipUsadaAtual = null;

    var overlay = document.createElement("div");
    overlay.className = "am-det-overlay";
    overlay.id = "am-det-overlay";

    var modal = document.createElement("section");
    modal.className = "am-det-modal";
    modal.id = "am-det-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-label", "Detalhe do anúncio");
    modal.innerHTML =
      '<div class="am-det-modal__top">' +
        '<span class="am-det-eyebrow">Anúncios ML · Detalhe do anúncio</span>' +
        '<button type="button" class="am-det-close" data-acao="fechar" aria-label="Fechar">' + icFechar() + "</button>" +
      "</div>" +
      '<div id="am-det-savebar-slot"></div>' +
      '<div class="am-det-scroll" id="am-det-scroll">' + estadoHtml("loading", "Carregando detalhes…") + "</div>";

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    document.body.classList.add("vf-no-scroll");

    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) fecharDetalhe();
    });
    modal.addEventListener("click", onCliqueDetalhe);
    var btnFechar = modal.querySelector('[data-acao="fechar"]');
    if (btnFechar) btnFechar.focus();

    var url = "/anuncios-meli/" + encodeURIComponent(itemId) +
              "?clienteSlug=" + encodeURIComponent(AM.clienteAtual.slug) +
              (AM.contaMlId ? "&clienteContaId=" + encodeURIComponent(AM.contaMlId) : "");

    api(url).then(function (r) {
      if (!DET || DET.token !== meuToken) return; // outra abertura já assumiu a tela
      var alvo = el("am-det-scroll");
      if (!alvo) return;
      if (!r.data || !r.data.ok) {
        alvo.innerHTML = estadoHtml("error", "Erro ao carregar detalhes",
          (r.data && r.data.motivo) || "Não foi possível carregar.");
        return;
      }
      var a = r.data.anuncio;
      DET.anuncio = a;
      DET.descricao = r.data.descricao || null;
      // `descricaoEstado` é o contrato novo; sem ele (backend antigo) o
      // comportamento cai no que havia antes, só que sem afirmar nada.
      DET.descricaoEstado = r.data.descricaoEstado ||
        (r.data.descricao ? "ok" : "sem_descricao");
      DET.descricaoErro = r.data.descricaoErro || null;
      DET.categoriaNome = r.data.categoriaNome || null;
      DET.original = {
        titulo: a.titulo || "",
        modelo: a.modelo || "",
        descricao: r.data.descricao || "",
      };
      DET.rascunho = {
        titulo: DET.original.titulo,
        modelo: DET.original.modelo,
        descricao: DET.original.descricao,
      };
      DET.carregado = true;
      AM.detalheAtual = { anuncio: a, descricao: DET.descricao };
      renderDetalhe();
      carregarHistoricoOtimizacoes(a.item_id, meuToken);
    });
  }

  function fecharDetalhe(forcar) {
    if (!DET || !DET.aberto) return;
    if (!forcar && camposSujos().length) { pedirConfirmacaoSaida(); return; }

    detalheToken++; // invalida qualquer resposta em voo da abertura que morreu
    var overlay = el("am-det-overlay");
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    document.body.classList.remove("vf-no-scroll");
    DET = null;
    AM.detalheAtual = null;
    AM.otimizacoes = { seo: null, descricao: null, ficha_tecnica: null };
    if (detalheFocusAnterior && typeof detalheFocusAnterior.focus === "function") {
      detalheFocusAnterior.focus();
    }
    detalheFocusAnterior = null;
  }

  function pedirConfirmacaoSaida() {
    if (!DET) return;
    DET.confirmandoSaida = true;
    renderSavebar();
  }

  // ---------------------------------------------------------------------------
  // Alterações pendentes
  // ---------------------------------------------------------------------------
  function camposSujos() {
    if (!DET || !DET.carregado) return [];
    return CAMPOS_EDITAVEIS.filter(function (c) {
      return DET.rascunho[c.chave] !== DET.original[c.chave];
    });
  }

  function campoSujo(chave) {
    return !!(DET && DET.carregado && DET.rascunho[chave] !== DET.original[chave]);
  }

  // ---------------------------------------------------------------------------
  // Render — superfície única
  // ---------------------------------------------------------------------------
  function renderDetalhe() {
    if (!DET || !DET.anuncio) return;
    var a = DET.anuncio;
    var pics = tryParseJSON(a.pictures_json, []) || [];
    var attrs = tryParseJSON(a.attributes_json, []) || [];

    var html =
      headHtml(a) +
      top2Html(a, pics, attrs) +
      fotosHtml(pics) +
      tituloEModeloHtml(a) +
      descricaoHtml() +
      fichaHtml(attrs);

    var scroll = el("am-det-scroll");
    scroll.innerHTML = html;
    bindCamposEditaveis();
    aplicarEstadosEdicao(); // já redesenha a barra de alterações

  }

  // ----- Cabeçalho: identidade + título editável (representação única) -------
  function headHtml(a) {
    var st = statusInfo(a.status);
    var rev = a.revisado
      ? '<span class="vf-status is-success">Revisado</span>'
      : '<span class="vf-status is-empty">Não revisado</span>';
    var conta = a.cliente_conta_id
      ? "Conta ML #" + escapeHtml(String(a.cliente_conta_id))
      : (a.ml_user_id ? "Conta ML " + escapeHtml(String(a.ml_user_id)) : "Conta ML não identificada");
    var subStatus = a.sub_status
      ? ' <span class="am-det-head__dot">·</span> ' + escapeHtml(String(a.sub_status))
      : "";
    // Catálogo do Mercado Livre: título é gerenciado pelo ML, não pode ser
    // editado por aqui (PUT recusado com "family_name" — ver meliConteudoService).
    var catalogo = !!(a.catalog_listing || a.family_name);

    var thumb = a.thumbnail
      ? '<img src="' + escapeHtml(a.thumbnail) + '" alt="" loading="lazy" />'
      : icImagem(24);

    return '<div class="am-det-head">' +
      '<div class="am-det-head__thumb" aria-hidden="true">' + thumb + "</div>" +
      '<div class="am-det-head__main">' +
        '<div class="am-det-title" id="am-det-title-wrap">' +
          '<div class="am-det-title__row">' +
            '<input class="am-det-title__input" id="am-det-titulo" maxlength="60" size="56" ' +
              (catalogo ? 'readonly aria-readonly="true" ' : '') +
              'aria-label="Título do anúncio" value="' + escapeAttr(DET.rascunho.titulo) + '" />' +
            '<button type="button" class="am-det-revert" data-acao="reverter" data-campo="titulo" ' +
              'id="am-det-revert-titulo" title="Descartar alteração no título" ' +
              'aria-label="Descartar alteração no título">' + icDesfazer() + "</button>" +
          "</div>" +
          '<div class="am-det-title__meta">' +
            '<span class="am-det-dirty" id="am-det-dirty-titulo"><span class="am-det-dot"></span>Alteração não salva</span>' +
            '<span class="am-det-title__count" id="am-det-count-titulo"></span>' +
            (catalogo
              ? '<span class="am-det-title__locknote">Gerenciado pelo Mercado Livre (catálogo)</span>'
              : "") +
          "</div>" +
        "</div>" +
        '<div class="am-det-head__meta">' +
          '<span class="vf-mono">' + escapeHtml(a.item_id) + "</span>" +
          '<span class="am-det-head__dot">·</span>' +
          '<span class="vf-mono">SKU ' + escapeHtml(a.sku || "—") + "</span>" +
          '<span class="am-det-head__dot">·</span>' +
          '<span class="vf-status ' + st.classe + '">' + escapeHtml(st.label) + "</span>" + subStatus +
          (catalogo
            ? '<span class="am-det-head__dot">·</span><span class="vf-tag is-primary" title="Título definido pelo catálogo do Mercado Livre">Catálogo</span>'
            : "") +
          '<span class="am-det-head__dot">·</span>' +
          '<span id="am-det-revisado-chip">' + rev + "</span>" +
          '<button type="button" class="vf-btn vf-btn--ghost vf-btn--sm" id="am-det-revisar" data-acao="revisar">' +
            icCheck(12) + (a.revisado ? "Desmarcar revisão" : "Marcar como revisado") +
          "</button>" +
        "</div>" +
        '<div class="am-det-head__sub">' + escapeHtml(AM.clienteAtual ? AM.clienteAtual.nome : "") +
          " — " + conta + ' <span class="am-det-head__dot">·</span> ' +
          escapeHtml(formatRelativo(a.last_synced_at)) + "</div>" +
      "</div>" +
      '<div class="am-det-head__actions">' +
        (a.permalink
          ? '<a class="vf-btn vf-btn--secondary vf-btn--sm" href="' + escapeHtml(a.permalink) +
            '" target="_blank" rel="noopener" id="am-det-abrir-ml">Abrir no Mercado Livre' + icExterno() + "</a>"
          : "") +
      "</div>" +
    "</div>";
  }

  // ----- Topo em 2 colunas: comercial/catálogo | qualidade ------------------
  function top2Html(a, pics, attrs) {
    var preco = '<strong class="am-det-price">' + formatMoeda(a.preco, a.moeda) +
      (a.preco_original ? "<small>" + formatMoeda(a.preco_original, a.moeda) + "</small>" : "") + "</strong>";

    var tipo = TIPO_ANUNCIO[a.listing_type_id] || a.listing_type_id || "—";
    var logistica = a.is_full ? "Full" : (a.logistic_type || "—");

    var comercial = '<h4>Comercial &amp; catálogo</h4>' +
      kvDet("Preço", preco) +
      kvDet("Estoque", "<strong>" + (a.estoque != null ? a.estoque : "—") + "</strong>") +
      kvDet("Vendidos", "<strong>" + (a.vendidos != null ? a.vendidos : "—") + "</strong>") +
      kvDet("Marca", "<strong>" + escapeHtml(a.marca || "—") + "</strong>") +
      kvDet("Modelo",
        '<strong><span class="am-det-inline" id="am-det-modelo-wrap">' +
          '<input class="am-det-inline__input" id="am-det-modelo" size="10" aria-label="Modelo do anúncio" ' +
            'placeholder="—" value="' + escapeAttr(DET.rascunho.modelo) + '" />' +
          '<button type="button" class="am-det-inline__pencil" data-acao="focar" data-campo="modelo" ' +
            'title="Editar modelo" aria-label="Editar modelo">' + icLapis() + "</button>" +
          '<button type="button" class="am-det-revert" data-acao="reverter" data-campo="modelo" ' +
            'id="am-det-revert-modelo" title="Descartar alteração no modelo" ' +
            'aria-label="Descartar alteração no modelo">' + icDesfazer(12) + "</button>" +
        "</span></strong>") +
      kvDet("Categoria", "<strong>" + escapeHtml(DET.categoriaNome || a.category_id || "—") + "</strong>") +
      kvDet("Tipo / logística", "<strong>" + escapeHtml(tipo) + " · " + escapeHtml(logistica) + "</strong>");

    var score = a.score_venforce == null ? 0 : Number(a.score_venforce) || 0;
    var classe = scoreClasse(score);
    var circ = 219.9;
    var offset = (circ * (1 - Math.max(0, Math.min(100, score)) / 100)).toFixed(1);

    var criterios = criteriosQualidade(a, pics, attrs).map(function (c) {
      return '<li class="' + c.estado + '">' +
        (c.estado === "ok" ? icCheck(13) : icAlerta(13)) + escapeHtml(c.texto) + "</li>";
    }).join("");

    var rodapeQualidade = escapeHtml("Principal ponto: " + (a.score_motivo || "—")) +
      (a.health != null ? " · health ML: " + escapeHtml(String(a.health)) : "");

    var qualidade = "<h4>Qualidade do anúncio</h4>" +
      '<div class="am-det-q__topo">' +
        '<div class="am-det-q__ring">' +
          '<svg width="84" height="84" viewBox="0 0 84 84" aria-hidden="true">' +
            '<circle cx="42" cy="42" r="35" fill="none" stroke="var(--vf-bg-2)" stroke-width="9"/>' +
            '<circle cx="42" cy="42" r="35" fill="none" class="am-det-q__arc ' + classe + '" stroke-width="9" ' +
              'stroke-linecap="round" stroke-dasharray="' + circ + '" stroke-dashoffset="' + offset + '" ' +
              'transform="rotate(-90 42 42)"/>' +
          "</svg>" +
          '<div class="am-det-q__ringval ' + classe + '">' + (a.score_venforce == null ? "—" : score) + "</div>" +
        "</div>" +
        "<div>" +
          '<p class="am-det-q__titulo">Score VenForce</p>' +
          '<p class="am-det-q__sub">de 100 pontos possíveis</p>' +
        "</div>" +
      "</div>" +
      '<ul class="am-det-q__crit">' + criterios + "</ul>" +
      '<p class="am-det-q__foot"><span class="am-det-newdata">' + rodapeQualidade + "</span></p>";

    return '<div class="am-det-top2">' +
      '<div class="am-det-top2__col">' + comercial + "</div>" +
      '<div class="am-det-top2__col">' + qualidade + "</div>" +
    "</div>";
  }

  function kvDet(rotulo, valorHtml) {
    return '<div class="am-det-kv"><span>' + escapeHtml(rotulo) + "</span>" + valorHtml + "</div>";
  }

  // Decomposição dos 5 critérios do Score VenForce — os mesmos pesos que o
  // backend usa (meliSyncService.calcularScore: título 32 · fotos 26 ·
  // marca 14 · modelo 14 · ficha 14). Até aqui a tela mostrava a nota e um
  // sintoma (`score_motivo`); agora mostra a decomposição inteira.
  function criteriosQualidade(a, pics, attrs) {
    var itens = [];
    var titulo = String(DET.rascunho.titulo || "").trim();
    if (!titulo) itens.push({ estado: "bad", texto: "Sem título" });
    else if (titulo.length < 20) itens.push({ estado: "bad", texto: "Título muito curto (" + titulo.length + " caracteres; o ideal é de 20 a 60)" });
    else if (titulo.length > 60) itens.push({ estado: "warn", texto: "Título acima de 60 caracteres (" + titulo.length + ")" });
    else itens.push({ estado: "ok", texto: "Título com " + titulo.length + " de 60 caracteres" });

    var n = pics.length;
    if (!n) itens.push({ estado: "bad", texto: "Sem fotos" });
    else if (n < 3) itens.push({ estado: "bad", texto: "Só " + n + (n === 1 ? " foto" : " fotos") + " (mínimo recomendado: 3)" });
    else if (n < 6) itens.push({ estado: "warn", texto: n + " fotos (6 ou mais é o ideal)" });
    else itens.push({ estado: "ok", texto: n + " fotos" });

    var total = attrs.length;
    var cheios = attrs.filter(function (x) { return valorAtributo(x); }).length;
    if (!total) itens.push({ estado: "warn", texto: "Ficha técnica não retornada pelo Mercado Livre" });
    else if (cheios / total < 0.6) itens.push({ estado: "warn", texto: "Ficha técnica incompleta (" + cheios + " de " + total + " atributos)" });
    else itens.push({ estado: "ok", texto: "Ficha técnica com " + cheios + " de " + total + " atributos" });

    itens.push(a.marca
      ? { estado: "ok", texto: "Marca preenchida" }
      : { estado: "bad", texto: "Marca não preenchida" });
    itens.push(String(DET.rascunho.modelo || "").trim()
      ? { estado: "ok", texto: "Modelo preenchido" }
      : { estado: "bad", texto: "Modelo não preenchido" });

    return itens;
  }

  // ----- Fotos ---------------------------------------------------------------
  function fotosHtml(pics) {
    var alerta = pics.length < 3
      ? '<span class="am-det-alert">' + icAlerta(12) + "Recomendado ter pelo menos 3 fotos</span>"
      : "";
    var grade = pics.length
      ? '<div class="am-det-photos">' + pics.map(function (u, i) {
          return '<div class="am-det-photo"><img src="' + escapeHtml(u) + '" alt="Foto ' + (i + 1) +
            ' do anúncio" loading="lazy" /></div>';
        }).join("") + "</div>"
      : '<div class="am-det-photos"><div class="am-det-photo am-det-photo--vazia">' + icImagem(20) +
        "</div></div><p class=\"am-det-vazio\">Nenhuma imagem foi retornada para este anúncio.</p>";

    return '<div class="am-det-section">' +
      '<div class="am-det-section__head">' +
        '<h3 class="am-det-section__title">Fotos <span class="am-det-section__meta">(' + pics.length + ")</span></h3>" +
        alerta +
      "</div>" + grade +
    "</div>";
  }

  // ----- Título e Modelo: comparação com a IA (o campo editável é único) -----
  function tituloEModeloHtml(a) {
    return '<div class="am-det-section">' +
      '<div class="am-det-subhead">' +
        "<h4>Título</h4>" +
        '<span id="am-det-status-seo">' + chipOtimizacao("seo", "titulo") + "</span>" +
      "</div>" +
      '<div class="am-det-compare" id="am-det-compare-titulo">' +
        '<div class="am-det-compare__col">' +
          '<div class="am-det-compare__label"><span>Atual · editável no cabeçalho, acima ↑</span></div>' +
          '<p class="am-det-readtext" id="am-det-espelho-titulo">' + escapeHtml(DET.rascunho.titulo || "(sem título)") + "</p>" +
        "</div>" +
        '<div class="am-det-compare__col" id="am-det-sug-titulo">' + sugestaoTituloHtml(AM.otimizacoes.seo) + "</div>" +
        '<div class="am-det-compare__foot" id="am-det-foot-seo">' + footSeoHtml(AM.otimizacoes.seo) + "</div>" +
      "</div>" +

      '<div class="am-det-subhead">' +
        "<h4>Modelo</h4>" +
        '<span id="am-det-status-modelo">' + chipOtimizacao("seo", "modelo") + "</span>" +
      "</div>" +
      '<div class="am-det-compare" id="am-det-compare-modelo">' +
        '<div class="am-det-compare__col">' +
          '<div class="am-det-compare__label"><span>Atual · editável no Catálogo, acima ↑</span></div>' +
          '<p class="am-det-readtext" id="am-det-espelho-modelo">' + escapeHtml(DET.rascunho.modelo || "—") + "</p>" +
        "</div>" +
        '<div class="am-det-compare__col" id="am-det-sug-modelo">' + sugestaoModeloHtml(AM.otimizacoes.seo) + "</div>" +
      "</div>" +
    "</div>";
  }

  function rotuloIa() {
    return '<span>' + icIa() + "Sugestão da IA</span>";
  }

  // Estado do lado direito quando não há (ou não pode haver) sugestão.
  // Não-admin vê uma frase, não um 403 mudo — achado F-02.
  function vazioIaHtml(botao, tipo) {
    if (DET.iaBloqueada) {
      return '<p class="am-det-vazio">Otimização por IA disponível para administradores.</p>';
    }
    return '<p class="am-det-vazio">Nenhuma sugestão gerada ainda.</p>' +
      '<div class="am-det-compare__actions">' +
        '<button type="button" class="vf-btn vf-btn--ghost vf-btn--sm" data-acao="gerar" data-tipo="' + tipo + '">' +
          escapeHtml(botao) + "</button>" +
      "</div>";
  }

  function acoesIaHtml(botoes) {
    return '<div class="am-det-compare__actions">' + botoes.join("") + "</div>";
  }

  function btnGhost(acao, rotulo, extras) {
    return '<button type="button" class="vf-btn vf-btn--ghost vf-btn--sm" data-acao="' + acao + '"' +
      (extras || "") + ">" + escapeHtml(rotulo) + "</button>";
  }

  function sugestaoTituloHtml(otim) {
    var cabeca = '<div class="am-det-compare__label">' + rotuloIa() + "</div>";
    if (!otim || !otim.titulo_sugerido) {
      return cabeca + vazioIaHtml("Gerar SEO", "seo");
    }
    var alts = ((tryParseJSON(otim.melhorias_json, {}) || {}).titulos_alternativos) || [];
    var alertas = tryParseJSON(otim.alertas_json, []) || [];
    var chars = otim.titulo_sugerido_chars || String(otim.titulo_sugerido).length;

    var alternativas = "";
    if (alts.length) {
      alternativas = '<p class="am-det-compare__hint">+' + alts.length +
        (alts.length === 1 ? " alternativa " : " alternativas ") +
        '<a href="#" data-acao="ver-alternativas">' +
        (DET.alternativasAbertas ? "ocultar" : "ver todas") + "</a></p>";
      if (DET.alternativasAbertas) {
        alternativas += '<ul class="am-det-alts">' + alts.map(function (t, i) {
          return "<li><span>" + escapeHtml(t) + " <b>(" + String(t || "").length + "/60)</b></span>" +
            '<span class="am-det-alts__btns">' +
              btnGhost("copiar", "Copiar", ' data-fonte="titulo-alt" data-idx="' + i + '"') +
              btnGhost("usar-sugestao", "Usar", ' data-campo="titulo" data-fonte="titulo-alt" data-idx="' + i + '"') +
              btnGhost("aprovar-titulo", "Aprovar", ' data-fonte="titulo-alt" data-idx="' + i + '"') +
            "</span></li>";
        }).join("") + "</ul>";
      }
    }

    return cabeca +
      '<p class="am-det-readtext am-det-readtext--sug"><strong>' + escapeHtml(otim.titulo_sugerido) +
        "</strong> (" + chars + "/60)</p>" +
      alternativas +
      listaIaHtml([], alertas) +
      acoesIaHtml([
        btnGhost("usar-sugestao", "Usar sugestão", ' data-campo="titulo" data-fonte="titulo-sugerido"'),
        btnGhost("copiar", "Copiar", ' data-fonte="titulo-sugerido"'),
        btnGhost("aprovar-titulo", "Aprovar", ' data-fonte="titulo-sugerido"'),
        btnGhost("gerar", "Gerar novamente", ' data-tipo="seo"'),
      ]);
  }

  function sugestaoModeloHtml(otim) {
    var cabeca = '<div class="am-det-compare__label">' + rotuloIa() + "</div>";
    if (!otim || !otim.modelo_sugerido) {
      return cabeca + vazioIaHtml("Gerar SEO", "seo");
    }
    return cabeca +
      '<p class="am-det-readtext am-det-readtext--sug"><strong>' + escapeHtml(otim.modelo_sugerido) + "</strong></p>" +
      acoesIaHtml([
        btnGhost("usar-sugestao", "Usar sugestão", ' data-campo="modelo" data-fonte="modelo-sugerido"'),
        btnGhost("copiar", "Copiar", ' data-fonte="modelo-sugerido"'),
        btnGhost("aprovar-modelo", "Aprovar", ""),
        btnGhost("gerar", "Gerar novamente", ' data-tipo="seo"'),
      ]);
  }

  function footSeoHtml(otim) {
    if (!otim) return '<span class="am-det-compare__scoreline">Score SEO ainda não calculado.</span>';
    var score = otim.score_seo != null ? otim.score_seo : 0;
    return '<span class="am-det-compare__scoreline">Score SEO ' + score + "/100" +
      (otim.motivo ? " — " + escapeHtml(otim.motivo) : "") + "</span>";
  }

  // Lista de melhorias (✓) e alertas (⚠) — mesmo desenho do canva.
  function listaIaHtml(melhorias, alertas) {
    var itens = (melhorias || []).map(function (m) {
      return '<li class="ok">' + icCheck(12) + escapeHtml(m) + "</li>";
    }).concat((alertas || []).map(function (al) {
      return '<li class="warn">' + icAlerta(12) + escapeHtml(al) + "</li>";
    }));
    if (!itens.length) return "";
    return '<ul class="am-det-compare__list">' + itens.join("") + "</ul>";
  }

  // Chip de estado por SEÇÃO. Título e Modelo saem da MESMA otimização (tipo
  // "seo"), mas a aprovação é por campo — `titulo_aprovado` e `modelo_aprovado`
  // são colunas distintas. Ler o campo, e não o `status` do registro, é o que
  // permite "Título aprovado, Modelo ainda não" como o canva mostra.
  var APROVACAO_POR_CAMPO = {
    titulo: "titulo_aprovado",
    modelo: "modelo_aprovado",
    descricao: "descricao_aprovada",
    ficha: "ficha_aprovada_json",
  };

  function chipOtimizacao(tipo, campo) {
    if (DET.iaBloqueada) return '<span class="vf-status is-empty">IA restrita a administradores</span>';
    var o = AM.otimizacoes[tipo];
    if (!o) return '<span class="vf-status is-empty">Aguardando geração</span>';

    // A coluna presente e NULA é informação: "esta otimização foi aprovada,
    // mas não neste campo". Só quando ela nem vem no payload é que o `status`
    // do registro serve de proxy.
    var coluna = APROVACAO_POR_CAMPO[campo];
    var aprovado = coluna && coluna in o
      ? !!o[coluna]
      : o.status === "aprovado";
    if (aprovado) {
      return '<span class="vf-status is-success">Aprovado em ' + escapeHtml(formatData(o.aprovado_at)) + "</span>";
    }
    // A ficha usa o rótulo curto do canva; título e modelo, o longo.
    return campo === "ficha"
      ? '<span class="vf-status is-info">Sugestão gerada</span>'
      : '<span class="vf-status is-empty">Sugestão gerada, aguardando decisão</span>';
  }

  // ----- Descrição: campo editável (única representação) × sugestão ----------
  function descricaoHtml() {
    var erro = DET.descricaoEstado === "erro";
    var texto = DET.rascunho.descricao || "";

    var rotuloEsq = erro
      ? "<span>Não foi possível carregar a descrição</span>"
      : "<span>Editável · <b id=\"am-det-count-descricao\">" + texto.length + "</b> caracteres</span>";

    var esquerda;
    if (erro) {
      esquerda = '<div class="am-det-compare__label">' + rotuloEsq + "</div>" +
        '<p class="am-det-erro-desc">' + escapeHtml(DET.descricaoErro ||
          "O Mercado Livre não devolveu a descrição deste anúncio.") +
        " Editar aqui sobrescreveria a descrição real por um texto que não conhecemos, " +
        "então o campo fica bloqueado até a leitura funcionar.</p>";
    } else {
      esquerda = '<div class="am-det-compare__label">' + rotuloEsq + "</div>" +
        '<div class="am-det-editable" id="am-det-editable-descricao">' +
          '<textarea class="vf-textarea am-det-textarea" id="am-det-descricao" aria-label="Descrição do anúncio" ' +
            'placeholder="Este anúncio não tem descrição preenchida. Escreva uma aqui.">' +
            escapeHtml(texto) + "</textarea>" +
          '<div class="am-det-editable__meta">' +
            '<span id="am-det-desc-origem">' + escapeHtml(origemDescricao()) + "</span>" +
            '<span class="am-det-editable__btns">' +
              '<button type="button" class="am-det-revert" data-acao="reverter" data-campo="descricao" ' +
                'id="am-det-revert-descricao" title="Descartar e voltar ao texto original" ' +
                'aria-label="Descartar alteração na descrição">' + icDesfazer() + "</button>" +
              btnGhost("copiar", "Copiar", ' data-fonte="descricao-atual"') +
            "</span>" +
          "</div>" +
        "</div>";
    }

    return '<div class="am-det-section">' +
      '<div class="am-det-section__head">' +
        '<h3 class="am-det-section__title">Descrição</h3>' +
        '<span class="am-det-dirty am-det-dirty--neutro" id="am-det-dirty-descricao">' +
          '<span class="am-det-dot"></span>Alteração não salva</span>' +
      "</div>" +
      '<div class="am-det-compare">' +
        '<div class="am-det-compare__col">' + esquerda + "</div>" +
        '<div class="am-det-compare__col" id="am-det-sug-descricao">' +
          sugestaoDescricaoHtml(AM.otimizacoes.descricao) + "</div>" +
      "</div>" +
    "</div>";
  }

  function origemDescricao() {
    if (DET.descricaoOrigem === "ia") {
      return "preenchida a partir da sugestão da IA" +
        (DET.descricaoOrigemHora ? " às " + DET.descricaoOrigemHora : "");
    }
    if (DET.descricaoEstado === "sem_descricao") return "este anúncio não tem descrição no Mercado Livre";
    return "descrição atual do anúncio no Mercado Livre";
  }

  function sugestaoDescricaoHtml(otim) {
    var usada = !!(otim && otim.descricao_sugerida &&
      DET.rascunho.descricao === otim.descricao_sugerida);
    chipUsadaAtual = usada;
    var cabeca = '<div class="am-det-compare__label">' + rotuloIa() +
      (usada ? '<span class="vf-status is-success">Usada nesta edição</span>' : "") + "</div>";

    if (!otim || !otim.descricao_sugerida) {
      return cabeca + vazioIaHtml("Gerar descrição", "descricao");
    }
    var melh = ((tryParseJSON(otim.melhorias_json, {}) || {}).itens) || [];
    var alertas = tryParseJSON(otim.alertas_json, []) || [];

    return cabeca +
      listaIaHtml(melh, alertas) +
      '<p class="am-det-readtext am-det-readtext--sug am-det-readtext--bloco">' +
        escapeHtml(otim.descricao_sugerida) + "</p>" +
      acoesIaHtml([
        btnGhost("usar-sugestao", "Usar sugestão", ' data-campo="descricao" data-fonte="descricao-sugerida"'),
        btnGhost("copiar", "Copiar", ' data-fonte="descricao-sugerida"'),
        btnGhost("aprovar-descricao", "Aprovar", ""),
        btnGhost("gerar", "Gerar novamente", ' data-tipo="descricao"'),
      ]);
  }

  // ----- Ficha técnica: atual × sugerida ------------------------------------
  function fichaHtml(attrs) {
    var cheios = attrs.filter(function (x) { return valorAtributo(x); }).length;

    var linhas = attrs.length
      ? attrs.map(function (x) {
          var v = valorAtributo(x);
          return "<tr" + (v ? "" : ' class="is-empty"') + "><td>" + escapeHtml(nomeAtributo(x)) +
            "</td><td>" + (v ? "<strong>" + escapeHtml(v) + "</strong>" : "Vazio") + "</td></tr>";
        }).join("")
      : '<tr><td colspan="2">Nenhum atributo retornado para este anúncio.</td></tr>';

    return '<div class="am-det-section">' +
      '<div class="am-det-section__head">' +
        '<h3 class="am-det-section__title">Ficha técnica <span class="am-det-section__meta">' +
          cheios + "/" + attrs.length + " preenchidos</span></h3>" +
        '<span id="am-det-status-ficha">' + chipOtimizacao("ficha_tecnica", "ficha") + "</span>" +
      "</div>" +
      '<div class="am-det-compare">' +
        '<div class="am-det-compare__col">' +
          '<div class="am-det-compare__label"><span>Atual — ' + attrs.length + " atributos possíveis</span></div>" +
          '<table class="am-det-ficha"><thead><tr><th>Campo</th><th>Atual</th></tr></thead><tbody>' +
            linhas + "</tbody></table>" +
        "</div>" +
        '<div class="am-det-compare__col" id="am-det-sug-ficha">' +
          sugestaoFichaHtml(AM.otimizacoes.ficha_tecnica, attrs) + "</div>" +
        '<div class="am-det-compare__foot" id="am-det-foot-ficha">' +
          footFichaHtml(AM.otimizacoes.ficha_tecnica, attrs) + "</div>" +
      "</div>" +
    "</div>";
  }

  function chaveCampo(s) {
    return String(s || "").trim().toLowerCase();
  }

  var CONFIANCA = { alta: "Alta", media: "Média", "média": "Média", baixa: "Baixa" };
  function rotuloConfianca(v) {
    var c = String(v || "media").toLowerCase();
    return CONFIANCA[c] || (c.charAt(0).toUpperCase() + c.slice(1));
  }

  // "A", "A e B", "A, B e C" — a enumeração que o canva usa no rodapé da ficha.
  function listaPt(itens) {
    if (itens.length <= 1) return itens[0] || "";
    return itens.slice(0, -1).join(", ") + " e " + itens[itens.length - 1];
  }

  function mapaSugestoesFicha(otim) {
    var mapa = {};
    var sug = otim ? (tryParseJSON(otim.ficha_tecnica_sugerida_json, []) || []) : [];
    sug.forEach(function (s) { if (s && s.campo) mapa[chaveCampo(s.campo)] = s; });
    return mapa;
  }

  function sugestaoFichaHtml(otim, attrs) {
    var cabeca = '<div class="am-det-compare__label">' + rotuloIa() + "</div>";
    if (!otim) return cabeca + vazioIaHtml("Sugerir ficha técnica", "ficha_tecnica");

    var mapa = mapaSugestoesFicha(otim);
    var alertas = tryParseJSON(otim.alertas_json, []) || [];
    var temSug = Object.keys(mapa).length > 0;

    if (!temSug) {
      return cabeca +
        '<p class="am-det-vazio">A IA não encontrou ajustes relevantes — a ficha técnica já está aceitável.</p>' +
        listaIaHtml([], alertas) +
        acoesIaHtml([btnGhost("gerar", "Gerar novamente", ' data-tipo="ficha_tecnica"')]);
    }

    var linhas = attrs.map(function (x) {
      var s = mapa[chaveCampo(nomeAtributo(x))] || mapa[chaveCampo(x && x.id)];
      if (!s || !s.valor_sugerido) {
        return "<tr><td>" + escapeHtml(nomeAtributo(x)) + "</td><td>—</td><td>—</td></tr>";
      }
      return "<tr><td>" + escapeHtml(nomeAtributo(x)) + "</td><td><strong>" +
        escapeHtml(s.valor_sugerido) + "</strong></td><td>" + escapeHtml(rotuloConfianca(s.confianca)) +
        (s.precisa_revisao ? " · revisar" : "") + "</td></tr>";
    });

    // Sugestões para campos que não estão na ficha atual entram no fim.
    var nomesAtuais = {};
    attrs.forEach(function (x) {
      nomesAtuais[chaveCampo(nomeAtributo(x))] = true;
      if (x && x.id) nomesAtuais[chaveCampo(x.id)] = true;
    });
    Object.keys(mapa).forEach(function (k) {
      if (nomesAtuais[k]) return;
      var s = mapa[k];
      linhas.push("<tr><td>" + escapeHtml(s.campo) + "</td><td><strong>" +
        escapeHtml(s.valor_sugerido || "—") + "</strong></td><td>" +
        escapeHtml(rotuloConfianca(s.confianca)) +
        (s.precisa_revisao ? " · revisar" : "") + "</td></tr>");
    });

    return cabeca +
      '<table class="am-det-ficha"><thead><tr><th>Campo</th><th>Sugerido</th><th>Conf.</th></tr></thead>' +
      "<tbody>" + linhas.join("") + "</tbody></table>" +
      listaIaHtml([], alertas) +
      acoesIaHtml([
        btnGhost("copiar-ficha", "Copiar como lista", ""),
        btnGhost("aprovar-ficha", "Aprovar", ""),
        btnGhost("gerar", "Gerar novamente", ' data-tipo="ficha_tecnica"'),
      ]);
  }

  function footFichaHtml(otim, attrs) {
    var vazios = attrs.filter(function (x) { return !valorAtributo(x); });
    var plural = vazios.length === 1 ? " atributo vazio" : " atributos vazios";
    if (!otim) {
      return '<span class="am-det-compare__scoreline">' + vazios.length + plural +
        " — nenhuma sugestão gerada ainda.</span>";
    }
    var mapa = mapaSugestoesFicha(otim);
    var cobertos = vazios.filter(function (x) {
      var s = mapa[chaveCampo(nomeAtributo(x))] || mapa[chaveCampo(x && x.id)];
      return s && s.valor_sugerido;
    });
    var descobertos = vazios.filter(function (x) {
      var s = mapa[chaveCampo(nomeAtributo(x))] || mapa[chaveCampo(x && x.id)];
      return !s || !s.valor_sugerido;
    }).map(nomeAtributo);

    var txt = cobertos.length + " sugest" + (cobertos.length === 1 ? "ão gerada" : "ões geradas") +
      " de " + vazios.length + plural;
    if (descobertos.length) {
      var visiveis = descobertos.slice(0, 4);
      if (descobertos.length > 4) visiveis.push("mais " + (descobertos.length - 4));
      txt += " — " + listaPt(visiveis) +
        (descobertos.length === 1 ? " segue" : " seguem") + " sem sugestão";
    }
    return '<span class="am-det-compare__scoreline">' + escapeHtml(txt) + "</span>";
  }

  // ---------------------------------------------------------------------------
  // Barra de alterações pendentes — o único caminho de escrita no anúncio
  // ---------------------------------------------------------------------------
  function renderSavebar() {
    var slot = el("am-det-savebar-slot");
    if (!slot || !DET) return;
    var sujos = camposSujos();

    if (DET.confirmandoSaida) {
      slot.innerHTML =
        '<div class="am-det-savebar is-perigo" id="am-det-savebar" role="alert">' +
          '<span class="am-det-savebar__msg"><span class="am-det-dot"></span>' +
            "Fechar e descartar " + sujos.length + " alteraç" + (sujos.length === 1 ? "ão" : "ões") +
            " — " + sujos.map(function (c) { return c.rotulo; }).join(", ") + "?</span>" +
          '<span class="am-det-savebar__actions">' +
            '<button type="button" class="vf-btn vf-btn--ghost vf-btn--sm" data-acao="cancelar-saida">Continuar editando</button>' +
            '<button type="button" class="vf-btn vf-btn--danger vf-btn--sm" data-acao="descartar-e-fechar">Descartar e fechar</button>' +
          "</span>" +
        "</div>";
      return;
    }

    if (!sujos.length) { slot.innerHTML = ""; return; }

    if (DET.salvando) {
      slot.innerHTML =
        '<div class="am-det-savebar" id="am-det-savebar" aria-live="polite">' +
          '<span class="am-det-savebar__msg"><span class="vf-spinner" aria-hidden="true"></span>' +
            "Salvando no Mercado Livre…</span>" +
          '<span class="am-det-savebar__actions">' +
            '<button type="button" class="vf-btn vf-btn--ghost vf-btn--sm" disabled>Descartar tudo</button>' +
            '<button type="button" class="vf-btn vf-btn--primary vf-btn--sm is-loading" disabled>Salvando…</button>' +
          "</span>" +
        "</div>";
      return;
    }

    var erros = Object.keys(DET.erros);
    if (erros.length) {
      slot.innerHTML =
        '<div class="am-det-savebar is-perigo" id="am-det-savebar" role="alert">' +
          '<span class="am-det-savebar__msg"><span class="am-det-dot"></span>' +
            escapeHtml(DET.erros[erros[0]]) + "</span>" +
          '<span class="am-det-savebar__actions">' +
            '<button type="button" class="vf-btn vf-btn--ghost vf-btn--sm" data-acao="descartar">Descartar tudo</button>' +
            '<button type="button" class="vf-btn vf-btn--primary vf-btn--sm" data-acao="salvar">Tentar de novo</button>' +
          "</span>" +
        "</div>";
      return;
    }

    slot.innerHTML =
      '<div class="am-det-savebar" id="am-det-savebar" aria-live="polite">' +
        '<span class="am-det-savebar__msg"><span class="am-det-dot"></span>' +
          sujos.length + " alteraç" + (sujos.length === 1 ? "ão não salva" : "ões não salvas") +
          " — " + sujos.map(function (c) { return c.rotulo; }).join(", ") + "</span>" +
        '<span class="am-det-savebar__actions">' +
          '<button type="button" class="vf-btn vf-btn--ghost vf-btn--sm" data-acao="descartar">Descartar tudo</button>' +
          '<button type="button" class="vf-btn vf-btn--primary vf-btn--sm" data-acao="salvar">Salvar alterações</button>' +
        "</span>" +
      "</div>";
  }

  // Atualizações leves (sem re-render): contadores, chips, espelhos e reverts.
  function aplicarEstadosEdicao() {
    if (!DET || !DET.carregado) return;

    var cTitulo = el("am-det-count-titulo");
    if (cTitulo) cTitulo.textContent = DET.rascunho.titulo.length + "/60 caracteres";
    var cDesc = el("am-det-count-descricao");
    if (cDesc) cDesc.textContent = String(DET.rascunho.descricao.length);

    var espTitulo = el("am-det-espelho-titulo");
    if (espTitulo) espTitulo.textContent = DET.rascunho.titulo || "(sem título)";
    var espModelo = el("am-det-espelho-modelo");
    if (espModelo) espModelo.textContent = DET.rascunho.modelo || "—";

    ["titulo", "modelo", "descricao"].forEach(function (chave) {
      var sujo = campoSujo(chave);
      var chip = el("am-det-dirty-" + chave);
      if (chip) chip.hidden = !sujo;
      var revert = el("am-det-revert-" + chave);
      if (revert) revert.hidden = !sujo;
    });

    var wrapT = el("am-det-title-wrap");
    if (wrapT) wrapT.classList.toggle("is-dirty", campoSujo("titulo"));
    var wrapM = el("am-det-modelo-wrap");
    if (wrapM) wrapM.classList.toggle("is-dirty", campoSujo("modelo"));
    var wrapD = el("am-det-editable-descricao");
    if (wrapD) wrapD.classList.toggle("is-dirty", campoSujo("descricao"));

    renderSavebar();
  }

  function bindCamposEditaveis() {
    var titulo = el("am-det-titulo");
    if (titulo) titulo.addEventListener("input", function () {
      DET.rascunho.titulo = this.value;
      DET.erros = {};
      aplicarEstadosEdicao();
    });
    var modelo = el("am-det-modelo");
    if (modelo) modelo.addEventListener("input", function () {
      DET.rascunho.modelo = this.value;
      DET.erros = {};
      aplicarEstadosEdicao();
    });
    var desc = el("am-det-descricao");
    if (desc) desc.addEventListener("input", function () {
      DET.rascunho.descricao = this.value;
      DET.descricaoOrigem = null;
      DET.descricaoOrigemHora = null;
      DET.erros = {};
      aplicarEstadosEdicao();
      atualizarChipUsada();
    });
  }

  // Estado do chip "Usada nesta edição" desenhado agora na tela. Sem esta
  // guarda, cada tecla digitada na descrição reconstruía a coluna da IA
  // inteira; com ela, a coluna só é redesenhada quando o chip realmente vira.
  var chipUsadaAtual = null;
  function atualizarChipUsada() {
    var otim = AM.otimizacoes.descricao;
    var usada = !!(otim && otim.descricao_sugerida &&
      DET.rascunho.descricao === otim.descricao_sugerida);
    if (usada === chipUsadaAtual) return;
    var alvo = el("am-det-sug-descricao");
    if (alvo) alvo.innerHTML = sugestaoDescricaoHtml(otim);
  }

  function descartarTudo() {
    if (!DET) return;
    DET.rascunho = {
      titulo: DET.original.titulo,
      modelo: DET.original.modelo,
      descricao: DET.original.descricao,
    };
    DET.erros = {};
    DET.descricaoOrigem = null;
    DET.descricaoOrigemHora = null;
    DET.confirmandoSaida = false;
    renderDetalhe();
    toast("Alterações descartadas.");
  }

  function reverterCampo(chave) {
    if (!DET) return;
    DET.rascunho[chave] = DET.original[chave];
    delete DET.erros[chave];
    if (chave === "descricao") { DET.descricaoOrigem = null; DET.descricaoOrigemHora = null; }
    var input = el("am-det-" + chave);
    if (input) input.value = DET.rascunho[chave];
    aplicarEstadosEdicao();
    if (chave === "descricao") atualizarChipUsada();
  }

  function usarSugestao(chave, texto) {
    if (!DET || texto == null) return;
    DET.rascunho[chave] = String(texto);
    DET.erros = {};
    if (chave === "descricao") {
      DET.descricaoOrigem = "ia";
      DET.descricaoOrigemHora = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    }
    var input = el("am-det-" + chave);
    if (input) { input.value = DET.rascunho[chave]; input.focus(); }
    aplicarEstadosEdicao();
    if (chave === "descricao") atualizarChipUsada();
    toast("Sugestão aplicada ao campo. Use “Salvar alterações” para publicar no Mercado Livre.");
  }

  // ---------------------------------------------------------------------------
  // Salvar — Portal → backend → ClienteConta → grant → API do ML → confirmação
  // ---------------------------------------------------------------------------
  function salvarAlteracoes() {
    if (!DET || DET.salvando) return;
    var sujos = camposSujos();
    if (!sujos.length) return;

    var corpo = { clienteSlug: AM.clienteAtual.slug };
    if (AM.contaMlId) corpo.clienteContaId = AM.contaMlId;
    sujos.forEach(function (c) { corpo[c.chave] = DET.rascunho[c.chave]; });

    DET.salvando = true;
    DET.erros = {};
    renderSavebar();

    var meuToken = DET.token;
    var itemId = DET.anuncio.item_id;

    api("/anuncios-meli/" + encodeURIComponent(itemId) + "/conteudo", {
      method: "PATCH",
      body: corpo,
    }).then(function (r) {
      if (!DET || DET.token !== meuToken) return; // o modal já é de outro anúncio/conta
      DET.salvando = false;
      var d = r.data || {};

      if (!d.resultados) {
        DET.erros = { geral: (d.motivo || "Não foi possível salvar as alterações.") };
        renderSavebar();
        toast(DET.erros.geral, "is-danger");
        return;
      }

      // Só o que o Mercado Livre CONFIRMOU vira "salvo".
      var falhas = [];
      CAMPOS_EDITAVEIS.forEach(function (c) {
        var res = d.resultados[c.chave];
        if (!res) return;
        if (res.ok) {
          DET.original[c.chave] = DET.rascunho[c.chave];
        } else {
          falhas.push(c.rotulo + ": " + (res.motivo || "recusado pelo Mercado Livre."));
          DET.erros[c.chave] = c.rotulo + " não foi salvo — " + (res.motivo || "o Mercado Livre recusou a alteração.");
        }
      });

      if (d.descricaoEstado) {
        DET.descricao = d.descricao || null;
        DET.descricaoEstado = d.descricaoEstado;
        DET.descricaoErro = d.descricaoErro || null;
      }
      if (d.anuncio) {
        DET.anuncio = d.anuncio;
        AM.detalheAtual = { anuncio: d.anuncio, descricao: DET.descricao };
      }

      renderDetalhe();

      if (!falhas.length) {
        toast("Alterações salvas no anúncio do Mercado Livre.", "is-success");
        carregarAnuncios(); // o título/modelo mudou: a listagem atrás precisa refletir
      } else {
        toast(falhas[0], "is-danger");
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Delegação de eventos do modal
  // ---------------------------------------------------------------------------
  function onCliqueDetalhe(e) {
    var alvo = e.target.closest("[data-acao]");
    if (!alvo || !DET) return;
    var acao = alvo.getAttribute("data-acao");

    if (acao === "fechar") { e.preventDefault(); fecharDetalhe(); return; }
    if (acao === "cancelar-saida") { DET.confirmandoSaida = false; renderSavebar(); return; }
    if (acao === "descartar-e-fechar") { fecharDetalhe(true); return; }
    if (acao === "descartar") { descartarTudo(); return; }
    if (acao === "salvar") { salvarAlteracoes(); return; }
    if (acao === "reverter") { reverterCampo(alvo.getAttribute("data-campo")); return; }
    if (acao === "focar") {
      var campo = el("am-det-" + alvo.getAttribute("data-campo"));
      if (campo) { campo.focus(); campo.select(); }
      return;
    }
    if (acao === "revisar") { alternarRevisao(alvo); return; }
    if (acao === "ver-alternativas") {
      e.preventDefault();
      DET.alternativasAbertas = !DET.alternativasAbertas;
      var col = el("am-det-sug-titulo");
      if (col) col.innerHTML = sugestaoTituloHtml(AM.otimizacoes.seo);
      return;
    }
    if (acao === "gerar") { gerar(alvo.getAttribute("data-tipo")); return; }
    if (acao === "copiar") { copiarTexto(textoDaFonte(alvo)); return; }
    if (acao === "copiar-ficha") { copiarFichaSugerida(); return; }
    if (acao === "usar-sugestao") {
      usarSugestao(alvo.getAttribute("data-campo"), textoDaFonte(alvo));
      return;
    }
    if (acao === "aprovar-titulo") { aprovarTitulo(textoDaFonte(alvo)); return; }
    if (acao === "aprovar-modelo") { aprovarModelo(); return; }
    if (acao === "aprovar-descricao") { aprovarDescricao(); return; }
    if (acao === "aprovar-ficha") { aprovarFicha(); return; }
  }

  // Textos vivem no estado, não em atributos — assim quebra de linha e aspas
  // da descrição não precisam sobreviver a uma viagem pelo HTML.
  function textoDaFonte(botao) {
    var fonte = botao.getAttribute("data-fonte");
    var seo = AM.otimizacoes.seo;
    var desc = AM.otimizacoes.descricao;
    if (fonte === "titulo-sugerido") return seo ? seo.titulo_sugerido : "";
    if (fonte === "modelo-sugerido") return seo ? seo.modelo_sugerido : "";
    if (fonte === "descricao-sugerida") return desc ? desc.descricao_sugerida : "";
    if (fonte === "descricao-atual") return DET.rascunho.descricao;
    if (fonte === "titulo-atual") return DET.rascunho.titulo;
    if (fonte === "modelo-atual") return DET.rascunho.modelo;
    if (fonte === "titulo-alt") {
      var alts = (seo && (tryParseJSON(seo.melhorias_json, {}) || {}).titulos_alternativos) || [];
      return alts[Number(botao.getAttribute("data-idx"))] || "";
    }
    return "";
  }

  function alternarRevisao(btn) {
    var a = DET.anuncio;
    var novo = !a.revisado;
    btn.disabled = true;
    api("/anuncios-meli/" + encodeURIComponent(a.item_id) + "/revisao", {
      method: "PATCH",
      body: { clienteSlug: AM.clienteAtual.slug, revisado: novo },
    }).then(function (r) {
      if (!DET) return;
      btn.disabled = false;
      if (r.data && r.data.ok) {
        a.revisado = novo;
        var chip = el("am-det-revisado-chip");
        if (chip) {
          chip.innerHTML = novo
            ? '<span class="vf-status is-success">Revisado</span>'
            : '<span class="vf-status is-empty">Não revisado</span>';
        }
        btn.innerHTML = icCheck(12) + (novo ? "Desmarcar revisão" : "Marcar como revisado");
        carregarAnuncios();
        toast(novo ? "Anúncio marcado como revisado." : "Revisão desmarcada.");
      } else {
        toast((r.data && r.data.motivo) || "Não foi possível atualizar a revisão.", "is-danger");
      }
    });
  }

  // ===========================================================================
  // Histórico de otimizações — alimenta as colunas "Sugestão da IA"
  // ===========================================================================
  function carregarHistoricoOtimizacoes(itemId, meuToken) {
    var url = "/anuncios-meli/" + encodeURIComponent(itemId) +
              "/otimizacoes?clienteSlug=" + encodeURIComponent(AM.clienteAtual.slug);
    api(url).then(function (r) {
      if (!DET || DET.token !== meuToken) return;
      // 403 = otimizador ainda é admin-only. Não é o modal quebrado: o resto
      // do detalhe funciona e a região de IA diz por que está vazia (F-02).
      if (r.status === 403) {
        DET.iaBloqueada = true;
        renderDetalhe();
        return;
      }
      if (!r.data || !r.data.ok) return;
      var porTipo = { seo: null, descricao: null, ficha_tecnica: null };
      (r.data.otimizacoes || []).forEach(function (o) {
        if (porTipo[o.tipo] === null) porTipo[o.tipo] = o;
      });
      AM.otimizacoes = porTipo;
      renderSecoesIa();
    });
  }

  // Redesenha só as colunas da IA e seus chips — o que o usuário está
  // editando à esquerda não é tocado.
  function renderSecoesIa() {
    if (!DET || !DET.carregado) return;
    var attrs = tryParseJSON(DET.anuncio.attributes_json, []) || [];
    var alvos = [
      ["am-det-sug-titulo", function () { return sugestaoTituloHtml(AM.otimizacoes.seo); }],
      ["am-det-sug-modelo", function () { return sugestaoModeloHtml(AM.otimizacoes.seo); }],
      ["am-det-sug-descricao", function () { return sugestaoDescricaoHtml(AM.otimizacoes.descricao); }],
      ["am-det-sug-ficha", function () { return sugestaoFichaHtml(AM.otimizacoes.ficha_tecnica, attrs); }],
      ["am-det-foot-seo", function () { return footSeoHtml(AM.otimizacoes.seo); }],
      ["am-det-foot-ficha", function () { return footFichaHtml(AM.otimizacoes.ficha_tecnica, attrs); }],
      ["am-det-status-seo", function () { return chipOtimizacao("seo", "titulo"); }],
      ["am-det-status-modelo", function () { return chipOtimizacao("seo", "modelo"); }],
      ["am-det-status-ficha", function () { return chipOtimizacao("ficha_tecnica", "ficha"); }],
    ];
    alvos.forEach(function (par) {
      var no = el(par[0]);
      if (no) no.innerHTML = par[1]();
    });
  }

  // ===========================================================================
  // Gerar (chama IA) — não altera o anúncio, só produz sugestão
  // ===========================================================================
  function gerar(tipo) {
    if (!DET || !DET.anuncio) return;
    var meuToken = DET.token;
    var a = DET.anuncio;
    var botoes = document.querySelectorAll('[data-acao="gerar"][data-tipo="' + tipo + '"]');
    for (var i = 0; i < botoes.length; i++) {
      botoes[i].disabled = true;
      botoes[i].textContent = "Gerando…";
    }
    marcarChipsIa(tipo, '<span class="vf-status is-info">Consultando IA…</span>');

    api("/anuncios-meli/" + encodeURIComponent(a.item_id) + "/otimizar", {
      method: "POST",
      body: { clienteSlug: AM.clienteAtual.slug, tipo: tipo },
    }).then(function (r) {
      if (!DET || DET.token !== meuToken) return;
      if (!r.data || !r.data.ok) {
        var motivo = (r.data && r.data.motivo) || "Erro ao consultar a IA.";
        if (r.status === 403) {
          DET.iaBloqueada = true;
          renderDetalhe();
          return;
        }
        marcarChipsIa(tipo, '<span class="vf-status is-danger">' + escapeHtml(motivo) + "</span>");
        renderSecoesIa();
        toast(motivo, "is-danger");
        return;
      }
      AM.otimizacoes[tipo] = r.data.otimizacao;
      renderSecoesIa();
    });
  }

  function marcarChipsIa(tipo, html) {
    var ids = tipo === "ficha_tecnica"
      ? ["am-det-status-ficha"]
      : tipo === "descricao" ? [] : ["am-det-status-seo", "am-det-status-modelo"];
    ids.forEach(function (id) {
      var no = el(id);
      if (no) no.innerHTML = html;
    });
  }

  // ===========================================================================
  // Aprovação — decisão INTERNA. Não publica nada no Mercado Livre.
  // ===========================================================================
  function aprovarTitulo(titulo) {
    var otim = AM.otimizacoes.seo;
    if (!otim) { toast("Gere a sugestão primeiro."); return; }
    if (!titulo || titulo.length > 60) { toast("Título inválido."); return; }
    aprovar(otim.id, { tituloAprovado: titulo }, "Título aprovado (decisão interna).");
  }

  function aprovarModelo() {
    var otim = AM.otimizacoes.seo;
    if (!otim) { toast("Gere a sugestão primeiro."); return; }
    var modelo = String((otim.modelo_sugerido || "")).trim();
    if (!modelo) { toast("Modelo vazio."); return; }
    aprovar(otim.id, { modeloAprovado: modelo }, "Modelo aprovado (decisão interna).");
  }

  function aprovarDescricao() {
    var otim = AM.otimizacoes.descricao;
    if (!otim) { toast("Gere a sugestão primeiro."); return; }
    var desc = otim.descricao_sugerida || "";
    if (!desc.trim()) { toast("Descrição vazia."); return; }
    aprovar(otim.id, { descricaoAprovada: desc }, "Descrição aprovada (decisão interna).");
  }

  function aprovarFicha() {
    var otim = AM.otimizacoes.ficha_tecnica;
    if (!otim) { toast("Gere a sugestão primeiro."); return; }
    var sug = tryParseJSON(otim.ficha_tecnica_sugerida_json, []) || [];
    aprovar(otim.id, { fichaAprovadaJson: sug }, "Sugestões aprovadas (decisão interna).");
  }

  function aprovar(otimId, dados, msgOk) {
    var meuToken = DET ? DET.token : 0;
    api("/anuncios-meli/otimizacoes/" + otimId + "/aprovar", {
      method: "PATCH",
      body: dados,
    }).then(function (r) {
      if (!DET || DET.token !== meuToken) return;
      if (r.data && r.data.ok) {
        toast(msgOk || "Aprovado.");
        var o = r.data.otimizacao;
        if (o && AM.otimizacoes[o.tipo] !== undefined) {
          AM.otimizacoes[o.tipo] = o;
          renderSecoesIa();
        }
      } else {
        toast((r.data && r.data.motivo) || "Erro ao aprovar.", "is-danger");
      }
    });
  }

  function copiarFichaSugerida() {
    var otim = AM.otimizacoes.ficha_tecnica;
    if (!otim) return;
    var sug = tryParseJSON(otim.ficha_tecnica_sugerida_json, []) || [];
    if (!sug.length) { toast("Nada para copiar."); return; }
    var linhas = sug.map(function (s) {
      return (s.campo || "") + ": " + (s.valor_sugerido || "(deixar manual)") +
        " [" + (s.confianca || "media") + (s.precisa_revisao ? ", revisar" : "") + "]";
    });
    copiarTexto(linhas.join("\n"), "Ficha sugerida copiada.");
  }

  // ===========================================================================
  // Sincronização
  // ===========================================================================
  function sincronizar(modo) {
    // Sem operação escolhida o Shell nem exibe esta tela (scope="account"):
    // nenhuma guarda de cardinalidade própria aqui (R8).
    if (!AM.clienteAtual) return;
    var overlay = document.createElement("div");
    overlay.className = "am-sync-overlay vf-overlay is-open";
    overlay.id = "am-sync-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "am-sync-titulo");
    overlay.innerHTML = '<div class="am-sync-box vf-modal vf-modal--sm">' +
      '<div class="vf-modal__body"><div class="vf-loading-state" aria-live="polite"><span class="vf-spinner" aria-hidden="true"></span><strong id="am-sync-titulo">' +
      (modo === "completo" ? "Sincronização completa em andamento" : "Buscando anúncios novos") +
      "</strong><span>Consultando a API do Mercado Livre. Pode levar alguns minutos.</span></div></div></div>";
    document.body.appendChild(overlay);
    document.body.classList.add("vf-no-scroll");

    api("/anuncios-meli/sync", {
      method: "POST",
      body: { clienteSlug: AM.clienteAtual.slug, modo: modo, clienteContaId: AM.contaMlId || undefined },
    }).then(function (r) {
      var box = overlay.querySelector(".am-sync-box");
      var d = r.data || {};
      if (d.ok) {
        var msg;
        if (d.totalSalvos > 0) {
          msg = '<div class="vf-banner is-success"><div class="vf-banner__content"><p class="vf-banner__title">Sincronização concluída</p><p class="vf-banner__description">' + (d.totalEncontrados || 0) +
            " anúncios na conta · " + d.totalSalvos + " gravados/atualizados.</p>" +
            (d.limitado ? '<p class="vf-banner__description">O limite de itens por sincronização foi atingido. Rode novamente para continuar.</p>' : "") + "</div></div>";
        } else {
          msg = '<div class="vf-banner is-success"><div class="vf-banner__content"><p class="vf-banner__title">Tudo em dia</p><p class="vf-banner__description">' + escapeHtml(d.mensagem || "Nenhum anúncio novo para gravar.") + "</p></div></div>";
        }
        box.innerHTML = '<div class="vf-modal__body">' + msg + '</div><div class="vf-modal__footer"><button type="button" class="vf-btn vf-btn--primary" id="am-sync-ok">OK</button></div>';
        carregarResumo(); carregarAnuncios();
      } else {
        box.innerHTML = '<div class="vf-modal__body"><div class="vf-banner is-danger" role="alert"><div class="vf-banner__content"><p class="vf-banner__title">Não foi possível sincronizar</p><p class="vf-banner__description">' +
          escapeHtml(d.motivo || "Erro ao consultar o Mercado Livre.") + "</p>" +
          (d.codigo === "NO_TOKEN" ? '<p class="vf-banner__description">Conecte a conta do Mercado Livre deste cliente na tela de Clientes.</p>' : "") +
          '</div></div></div><div class="vf-modal__footer"><button type="button" class="vf-btn vf-btn--secondary" id="am-sync-ok">Fechar</button></div>';
      }
      var btn = el("am-sync-ok");
      if (btn) btn.addEventListener("click", function () {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        document.body.classList.remove("vf-no-scroll");
      });
    });
  }

  // ===========================================================================
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
