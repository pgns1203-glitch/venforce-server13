/* =============================================================================
   Anúncios Meli — lógica do módulo (JavaScript puro, sem dependências)
   Central operacional + Agente Otimizador Textual IA.

   Endpoints consumidos:
     GET   /anuncios-meli/clientes
     POST  /anuncios-meli/sync
     GET   /anuncios-meli/resumo?clienteSlug=
     GET   /anuncios-meli?clienteSlug=...
     GET   /anuncios-meli/:itemId?clienteSlug=
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
    clientes: [],
    clienteAtual: null,
    resumo: null,
    anuncios: [],
    paginacao: { page: 1, limit: 24, total: 0, totalPaginas: 1 },
    filtros: { q: "", status: "", filtro: "" },
    buscaTimer: null,
    carregandoCatalogo: false,
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
      case "active":       return { label: "Ativo", classe: "am-badge--ok" };
      case "paused":       return { label: "Pausado", classe: "am-badge--alerta" };
      case "closed":       return { label: "Encerrado", classe: "am-badge--ruim" };
      case "under_review": return { label: "Em revisão", classe: "am-badge--neutro" };
      default:             return { label: s || "—", classe: "am-badge--neutro" };
    }
  }

  function scoreClasse(s) {
    if (s === null || s === undefined) return "am-score--ruim";
    if (s >= 80) return "am-score--ok";
    if (s >= 60) return "am-score--alerta";
    return "am-score--ruim";
  }

  function scoreCorBarra(s) {
    if (s >= 80) return "#1f9d57";
    if (s >= 60) return "#c9821a";
    return "#d64545";
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
    ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); toast(mensagem || "Copiado!"); }
    catch (e) { toast("Não consegui copiar."); }
    document.body.removeChild(ta);
  }

  var toastTimer = null;
  function toast(msg) {
    var prev = document.getElementById("am-toast");
    if (prev) prev.parentNode.removeChild(prev);
    var t = document.createElement("div");
    t.id = "am-toast";
    t.className = "am-toast";
    t.textContent = msg;
    document.body.appendChild(t);
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      if (t.parentNode) t.parentNode.removeChild(t);
    }, 2200);
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
        '<div class="am-state"><strong>Sessão não encontrada</strong>' +
        "Faça login no portal para usar os Anúncios Meli.</div>";
      return;
    }
    bindEventosFixos();
    carregarClientes();
  }

  function bindEventosFixos() {
    el("am-busca-cliente").addEventListener("input", function (e) { renderClientes(e.target.value); });
    el("am-voltar").addEventListener("click", function () {
      AM.clienteAtual = null;
      el("am-view-hud").classList.add("am-hidden");
      el("am-view-clientes").classList.remove("am-hidden");
      carregarClientes();
    });
    el("am-busca").addEventListener("input", function (e) {
      AM.filtros.q = e.target.value;
      if (AM.buscaTimer) clearTimeout(AM.buscaTimer);
      AM.buscaTimer = setTimeout(function () { AM.paginacao.page = 1; carregarAnuncios(); }, 350);
    });
    el("am-filtro-status").addEventListener("change", function (e) {
      AM.filtros.status = e.target.value; AM.paginacao.page = 1; carregarAnuncios();
    });
    el("am-filtro-problema").addEventListener("change", function (e) {
      AM.filtros.filtro = e.target.value; AM.paginacao.page = 1; carregarAnuncios();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") fecharDetalhe();
    });
  }

  // ===========================================================================
  // VIEW 1 — Seleção de cliente
  // ===========================================================================
  function carregarClientes() {
    var box = el("am-clientes-container");
    box.innerHTML = '<div class="am-state"><div class="am-spinner"></div>Carregando clientes...</div>';

    api("/anuncios-meli/clientes").then(function (r) {
      if (!r.data || !r.data.ok) {
        box.innerHTML = '<div class="am-state"><strong>Não foi possível carregar</strong>' +
          escapeHtml((r.data && r.data.motivo) || "Erro ao buscar clientes.") + "</div>";
        return;
      }
      AM.clientes = r.data.clientes || [];
      renderClientes("");
    });
  }

  function renderClientes(filtroTexto) {
    var box = el("am-clientes-container");
    var termo = (filtroTexto || "").trim().toLowerCase();
    var lista = AM.clientes.filter(function (c) {
      if (!termo) return true;
      return (c.nome || "").toLowerCase().indexOf(termo) !== -1 ||
             (c.slug || "").toLowerCase().indexOf(termo) !== -1;
    });

    if (!lista.length) {
      box.innerHTML = '<div class="am-state"><strong>Nenhum cliente encontrado</strong>' +
        (AM.clientes.length ? "Tente outro termo de busca." : "Cadastre clientes na tela de Clientes do portal.") +
        "</div>";
      return;
    }

    var html = '<div class="am-clientes-grid">';
    lista.forEach(function (c) {
      var conectado = c.mlConectado;
      html += '<div class="am-cliente-card" data-slug="' + escapeHtml(c.slug) +
        '" data-nome="' + escapeHtml(c.nome) + '">' +
        '<div class="am-cliente-card__nome">' + escapeHtml(c.nome) + "</div>" +
        '<div class="am-cliente-card__meta">' +
        '<span class="am-badge ' + (conectado ? "am-badge--ok" : "am-badge--ruim") + '">' +
        (conectado ? "ML conectado" : "Sem ML") + "</span>" +
        "<span>" + (c.totalAnuncios || 0) + " anúncios</span>" +
        "</div></div>";
    });
    html += "</div>";
    box.innerHTML = html;

    var cards = box.querySelectorAll(".am-cliente-card");
    for (var i = 0; i < cards.length; i++) {
      cards[i].addEventListener("click", function () {
        selecionarCliente(this.getAttribute("data-slug"), this.getAttribute("data-nome"));
      });
    }
  }

  function selecionarCliente(slug, nome) {
    AM.clienteAtual = { slug: slug, nome: nome };
    AM.paginacao.page = 1;
    AM.filtros = { q: "", status: "", filtro: "" };
    el("am-busca").value = "";
    el("am-filtro-status").value = "";
    el("am-filtro-problema").value = "";
    el("am-view-clientes").classList.add("am-hidden");
    el("am-view-hud").classList.remove("am-hidden");
    renderHudHeader();
    carregarResumo();
    carregarAnuncios();
  }

  // ===========================================================================
  // VIEW 2 — HUD do cliente
  // ===========================================================================
  function renderHudHeader() {
    var c = AM.clienteAtual;
    var resumo = AM.resumo;
    var subInfo = resumo
      ? "<span>Última sincronização: <b>" + formatData(resumo.ultimaSync) + "</b></span>" +
        "<span>Total sincronizado: <b>" + (resumo.total || 0) + " anúncios</b></span>"
      : "<span>Carregando resumo...</span>";

    el("am-hud-top").innerHTML =
      '<div class="am-hud-info">' +
      "<h2>" + escapeHtml(c.nome) + " — Anúncios Mercado Livre</h2>" +
      '<div class="am-hud-sub">' + subInfo + "</div></div>" +
      '<div class="am-hud-actions">' +
      '<button class="am-btn" id="am-sync-novos">Atualizar novos</button>' +
      '<button class="am-btn am-btn--primary" id="am-sync-completo">Sincronização completa</button>' +
      "</div>";

    el("am-sync-novos").addEventListener("click", function () { sincronizar("novos"); });
    el("am-sync-completo").addEventListener("click", function () { sincronizar("completo"); });
  }

  function carregarResumo() {
    if (!AM.clienteAtual) return;
    api("/anuncios-meli/resumo?clienteSlug=" + encodeURIComponent(AM.clienteAtual.slug))
      .then(function (r) {
        if (r.data && r.data.ok) {
          AM.resumo = r.data.resumo;
          renderHudHeader();
          renderResumo();
        }
      });
  }

  function renderResumo() {
    var r = AM.resumo || {};
    var cards = [
      { label: "Total de anúncios", valor: r.total || 0, classe: "" },
      { label: "Ativos", valor: r.ativos || 0, classe: "am-stat--bom" },
      { label: "Pausados", valor: r.pausados || 0, classe: "am-stat--alerta" },
      { label: "Fotos insuficientes", valor: r.fotosInsuficientes || 0, classe: r.fotosInsuficientes ? "am-stat--alerta" : "" },
      { label: "Sem SKU", valor: r.semSku || 0, classe: r.semSku ? "am-stat--alerta" : "" },
      { label: "Score baixo", valor: r.scoreBaixo || 0, classe: r.scoreBaixo ? "am-stat--ruim" : "" },
      { label: "Mercado Full", valor: r.full || 0, classe: "" },
      { label: "Score médio", valor: r.scoreMedio || 0,
        classe: r.scoreMedio >= 80 ? "am-stat--bom" : r.scoreMedio >= 60 ? "am-stat--alerta" : "am-stat--ruim" },
    ];
    var html = "";
    cards.forEach(function (c) {
      html += '<div class="am-stat ' + c.classe + '">' +
        '<div class="am-stat__label">' + c.label + "</div>" +
        '<div class="am-stat__valor">' + c.valor + "</div></div>";
    });
    el("am-resumo").innerHTML = html;
  }

  function carregarAnuncios() {
    if (!AM.clienteAtual || AM.carregandoCatalogo) return;
    AM.carregandoCatalogo = true;
    var box = el("am-catalogo-container");
    box.innerHTML = '<div class="am-state"><div class="am-spinner"></div>Carregando anúncios...</div>';

    var qs = "clienteSlug=" + encodeURIComponent(AM.clienteAtual.slug) +
             "&page=" + AM.paginacao.page + "&limit=" + AM.paginacao.limit;
    if (AM.filtros.q) qs += "&q=" + encodeURIComponent(AM.filtros.q);
    if (AM.filtros.status) qs += "&status=" + encodeURIComponent(AM.filtros.status);
    if (AM.filtros.filtro) qs += "&filtro=" + encodeURIComponent(AM.filtros.filtro);

    api("/anuncios-meli?" + qs).then(function (r) {
      AM.carregandoCatalogo = false;
      if (!r.data || !r.data.ok) {
        box.innerHTML = '<div class="am-state"><strong>Erro ao carregar</strong>' +
          escapeHtml((r.data && r.data.motivo) || "Tente novamente.") + "</div>";
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
      box.innerHTML = '<div class="am-state"><strong>' +
        (temFiltro ? "Nenhum anúncio para esse filtro" : "Nenhum anúncio sincronizado") + "</strong>" +
        (temFiltro ? "Ajuste a busca ou os filtros acima."
          : 'Use o botão "Sincronização completa" para trazer os anúncios deste cliente.') + "</div>";
      return;
    }

    var html = '<div class="am-catalogo">';
    AM.anuncios.forEach(function (a) { html += cardAnuncioHtml(a); });
    html += "</div>" + paginacaoHtml();
    box.innerHTML = html;

    var cards = box.querySelectorAll(".am-card[data-item]");
    for (var i = 0; i < cards.length; i++) {
      cards[i].querySelector(".am-card__acao").addEventListener("click", function (e) {
        e.stopPropagation();
        abrirDetalhe(this.parentNode.parentNode.getAttribute("data-item"));
      });
      cards[i].addEventListener("click", function () {
        abrirDetalhe(this.getAttribute("data-item"));
      });
    }

    var btnPrev = el("am-pag-prev"), btnNext = el("am-pag-next");
    if (btnPrev) btnPrev.addEventListener("click", function () {
      if (AM.paginacao.page > 1) { AM.paginacao.page--; carregarAnuncios(); window.scrollTo({ top: 0, behavior: "smooth" }); }
    });
    if (btnNext) btnNext.addEventListener("click", function () {
      if (AM.paginacao.page < AM.paginacao.totalPaginas) { AM.paginacao.page++; carregarAnuncios(); window.scrollTo({ top: 0, behavior: "smooth" }); }
    });
  }

  function cardAnuncioHtml(a) {
    var st = statusInfo(a.status);
    var score = a.score_venforce;
    var scoreTxt = score === null || score === undefined ? "—" : score;
    var badges = "";
    badges += '<span class="am-badge ' + st.classe + '">' + st.label + "</span>";
    if (a.is_full) badges += '<span class="am-badge am-badge--full">Full</span>';
    if ((a.pictures_count || 0) < 3) badges += '<span class="am-badge am-badge--alerta">' + (a.pictures_count || 0) + "/3 fotos</span>";
    if (!a.sku) badges += '<span class="am-badge am-badge--ruim">Sem SKU</span>';
    if (a.revisado) badges += '<span class="am-badge am-badge--ok">Revisado</span>';

    var img = a.thumbnail
      ? '<img src="' + escapeHtml(a.thumbnail) + '" alt="" loading="lazy" />'
      : '<span class="am-card__img-vazia">sem imagem</span>';

    return '<div class="am-card" data-item="' + escapeHtml(a.item_id) + '">' +
      '<div class="am-card__img">' + img +
      '<span class="am-card__score ' + scoreClasse(score) + '">' + scoreTxt + "/100</span></div>" +
      '<div class="am-card__body">' +
      '<div class="am-card__titulo">' + escapeHtml(a.titulo || "(sem título)") + "</div>" +
      '<div class="am-card__ids"><b>' + escapeHtml(a.item_id) + "</b>" +
      (a.sku ? " · SKU " + escapeHtml(a.sku) : "") +
      (a.modelo ? "<br>Modelo: " + escapeHtml(a.modelo) : "") + "</div>" +
      '<div class="am-card__preco">' + formatMoeda(a.preco, a.moeda) + "</div>" +
      '<div class="am-card__badges">' + badges + "</div>" +
      '<button class="am-btn am-btn--sm am-card__acao">Ver detalhes</button>' +
      "</div></div>";
  }

  function paginacaoHtml() {
    var p = AM.paginacao;
    if (p.totalPaginas <= 1) return '<div class="am-paginacao"><span>' + p.total + " anúncio(s)</span></div>";
    return '<div class="am-paginacao">' +
      '<button class="am-btn am-btn--sm" id="am-pag-prev"' + (p.page <= 1 ? " disabled" : "") + ">&larr; Anterior</button>" +
      "<span>Página " + p.page + " de " + p.totalPaginas + " · " + p.total + " anúncios</span>" +
      '<button class="am-btn am-btn--sm" id="am-pag-next"' + (p.page >= p.totalPaginas ? " disabled" : "") + ">Próxima &rarr;</button>" +
      "</div>";
  }

  // ===========================================================================
  // Detalhe (drawer)
  // ===========================================================================
  function abrirDetalhe(itemId) {
    AM.detalheAtual = null;
    AM.otimizacoes = { seo: null, descricao: null, ficha_tecnica: null };

    var overlay = document.createElement("div");
    overlay.className = "am-modal-overlay";
    overlay.id = "am-modal-overlay";
    overlay.innerHTML =
      '<div class="am-drawer">' +
      '<div class="am-drawer__head">' +
      '<strong id="am-drawer-titulo">Detalhe do anúncio</strong>' +
      '<button class="am-drawer__close" id="am-drawer-close">&times;</button></div>' +
      '<div class="am-drawer__body" id="am-drawer-body">' +
      '<div class="am-state"><div class="am-spinner"></div>Carregando...</div></div></div>';
    document.body.appendChild(overlay);

    overlay.addEventListener("click", function (e) { if (e.target === overlay) fecharDetalhe(); });
    el("am-drawer-close").addEventListener("click", fecharDetalhe);

    var url = "/anuncios-meli/" + encodeURIComponent(itemId) +
              "?clienteSlug=" + encodeURIComponent(AM.clienteAtual.slug);

    api(url).then(function (r) {
      var body = el("am-drawer-body");
      if (!body) return;
      if (!r.data || !r.data.ok) {
        body.innerHTML = '<div class="am-state"><strong>Erro</strong>' +
          escapeHtml((r.data && r.data.motivo) || "Não foi possível carregar.") + "</div>";
        return;
      }
      AM.detalheAtual = { anuncio: r.data.anuncio, descricao: r.data.descricao || null };
      renderDetalhe();
      carregarHistoricoOtimizacoes(r.data.anuncio.item_id);
    });
  }

  function fecharDetalhe() {
    var o = el("am-modal-overlay"); if (o) o.parentNode.removeChild(o);
  }

  function renderDetalhe() {
    var a = AM.detalheAtual.anuncio;
    var body = el("am-drawer-body");
    var st = statusInfo(a.status);

    var pics = tryParseJSON(a.pictures_json, []);
    var attrs = tryParseJSON(a.attributes_json, []);

    el("am-drawer-titulo").textContent = a.titulo || "Detalhe do anúncio";

    var html =
      '<div class="am-tabs">' +
      '<button class="am-tab am-tab--ativa" data-tab="ia">✨ Otimização IA</button>' +
      '<button class="am-tab" data-tab="geral">Visão geral</button>' +
      '<button class="am-tab" data-tab="ficha">Ficha técnica</button>' +
      '<button class="am-tab" data-tab="fotos">Fotos</button>' +
      '<button class="am-tab" data-tab="desc">Descrição</button>' +
      "</div>";

    // ----- Aba IA (a estrela) -----
    html += '<div class="am-tab-panel am-tab-panel--ativa" data-panel="ia">' +
      painelOtimizacaoHtml() + "</div>";

    // ----- Aba visão geral -----
    html += '<div class="am-tab-panel" data-panel="geral">' +
      (a.thumbnail ? '<img class="am-detalhe-img" src="' + escapeHtml(a.thumbnail) + '" alt="" />' : "") +
      '<div class="am-bloco"><h4>' + escapeHtml(a.titulo || "(sem título)") + "</h4>" +
      kv("MLB", a.item_id) + kv("SKU", a.sku || "—") +
      kv("Modelo", a.modelo || "—") + kv("Marca", a.marca || "—") +
      kv("Status", '<span class="am-badge ' + st.classe + '">' + st.label + "</span>") +
      kv("Preço", formatMoeda(a.preco, a.moeda)) +
      (a.preco_original ? kv("Preço original", formatMoeda(a.preco_original, a.moeda)) : "") +
      kv("Estoque", a.estoque != null ? a.estoque : "—") +
      kv("Vendidos", a.vendidos != null ? a.vendidos : "—") +
      kv("Categoria", a.category_id || "—") +
      kv("Tipo de anúncio", a.listing_type_id || "—") +
      kv("Logística", a.is_full ? "Mercado Full" : a.logistic_type || "—") + "</div>" +
      '<div class="am-bloco"><h4>Score VenForce</h4>' +
      '<div style="display:flex;align-items:baseline;gap:8px;">' +
      '<span style="font-size:26px;font-weight:700;" class="' + scoreClasse(a.score_venforce) + '">' +
      (a.score_venforce || 0) + '</span><span style="color:#5b6680;font-size:13px;">/ 100</span></div>' +
      '<div class="am-score-bar"><div class="am-score-bar__fill" style="width:' +
      (a.score_venforce || 0) + "%;background:" + scoreCorBarra(a.score_venforce || 0) + ';"></div></div>' +
      '<div style="font-size:12.5px;color:#5b6680;margin-top:6px;">Principal ponto: <b>' +
      escapeHtml(a.score_motivo || "—") + "</b></div></div>" +
      '<div class="am-bloco"><h4>Ações</h4><div style="display:flex;gap:8px;flex-wrap:wrap;">' +
      (a.permalink ? '<a class="am-btn am-btn--sm" href="' + escapeHtml(a.permalink) +
        '" target="_blank" rel="noopener">Abrir no Mercado Livre</a>' : "") +
      '<button class="am-btn am-btn--sm" id="am-btn-revisar">' +
      (a.revisado ? "Desmarcar revisão" : "Marcar como revisado") + "</button></div></div>" +
      "</div>";

    // ----- Aba ficha técnica -----
    html += '<div class="am-tab-panel" data-panel="ficha">';
    if (!attrs.length) {
      html += '<div class="am-state">Nenhum atributo retornado.</div>';
    } else {
      var preenchidos = attrs.filter(function (x) { return x && x.value; });
      var vazios = attrs.filter(function (x) { return !x || !x.value; });
      html += '<div class="am-bloco"><h4>Preenchidos (' + preenchidos.length + ')</h4><div class="am-attr-list">';
      if (!preenchidos.length) html += '<div class="am-attr"><span>—</span></div>';
      preenchidos.forEach(function (x) {
        html += '<div class="am-attr"><span>' + escapeHtml(x.name || x.id) +
          "</span><b>" + escapeHtml(x.value) + "</b></div>";
      });
      html += "</div></div>";
      html += '<div class="am-bloco"><h4>Faltando (' + vazios.length + ')</h4><div class="am-attr-list">';
      if (!vazios.length) html += '<div class="am-attr"><span>Tudo preenchido 🎉</span></div>';
      vazios.forEach(function (x) {
        html += '<div class="am-attr am-attr--vazio"><span>' + escapeHtml(x.name || x.id) +
          "</span><b>vazio</b></div>";
      });
      html += "</div></div>";
    }
    html += "</div>";

    // ----- Aba fotos -----
    html += '<div class="am-tab-panel" data-panel="fotos"><div class="am-bloco"><h4>Fotos (' + pics.length + ")</h4>";
    if (pics.length < 3) html += '<div class="am-aviso">Recomendado ter pelo menos 3 fotos. Este anúncio tem ' + pics.length + ".</div>";
    if (!pics.length) html += '<div class="am-state">Sem fotos.</div>';
    else {
      html += '<div class="am-thumbs">';
      pics.forEach(function (u) { html += '<img src="' + escapeHtml(u) + '" alt="" loading="lazy" />'; });
      html += "</div>";
    }
    html += "</div></div>";

    // ----- Aba descrição -----
    html += '<div class="am-tab-panel" data-panel="desc"><div class="am-bloco"><h4>Descrição atual</h4>';
    var desc = AM.detalheAtual.descricao;
    if (desc && desc.trim()) html += '<div class="am-desc">' + escapeHtml(desc.trim()) + "</div>";
    else html += '<div class="am-aviso">Este anúncio não tem descrição preenchida.</div>';
    html += "</div></div>";

    body.innerHTML = html;
    bindAbas();
    bindDetalheGeral();
    bindPainelOtimizacao();
  }

  function kv(rotulo, valor) {
    return '<div class="am-kv"><span>' + escapeHtml(rotulo) + "</span><b>" + valor + "</b></div>";
  }

  function bindAbas() {
    var body = el("am-drawer-body");
    var tabs = body.querySelectorAll(".am-tab");
    var panels = body.querySelectorAll(".am-tab-panel");
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener("click", function () {
        var alvo = this.getAttribute("data-tab");
        for (var j = 0; j < tabs.length; j++) tabs[j].classList.remove("am-tab--ativa");
        this.classList.add("am-tab--ativa");
        for (var k = 0; k < panels.length; k++) {
          panels[k].classList.toggle("am-tab-panel--ativa", panels[k].getAttribute("data-panel") === alvo);
        }
      });
    }
  }

  function bindDetalheGeral() {
    var btnRev = el("am-btn-revisar");
    if (!btnRev) return;
    btnRev.addEventListener("click", function () {
      var a = AM.detalheAtual.anuncio;
      var novo = !a.revisado;
      btnRev.disabled = true; btnRev.textContent = "Salvando...";
      api("/anuncios-meli/" + encodeURIComponent(a.item_id) + "/revisao", {
        method: "PATCH",
        body: { clienteSlug: AM.clienteAtual.slug, revisado: novo },
      }).then(function (r) {
        btnRev.disabled = false;
        if (r.data && r.data.ok) {
          a.revisado = novo;
          btnRev.textContent = novo ? "Desmarcar revisão" : "Marcar como revisado";
          carregarAnuncios();
        } else { btnRev.textContent = "Erro — tentar de novo"; }
      });
    });
  }

  // ===========================================================================
  // PAINEL Otimização IA — HTML + comportamento
  // ===========================================================================
  function painelOtimizacaoHtml() {
    var a = AM.detalheAtual.anuncio;
    var descAtual = AM.detalheAtual.descricao || "";

    var seoSec = otimSecaoHtml({
      id: "seo",
      icon: "S",
      titulo: "SEO — Título e Modelo",
      sub: "Otimização do título e do campo modelo para busca no Mercado Livre.",
      conteudoAtual: seoAtualHtml(a),
      conteudoSugerido: seoSugeridoHtml(null),
      botaoGerar: "✨ Gerar SEO",
    });

    var descSec = otimSecaoHtml({
      id: "descricao",
      icon: "D",
      titulo: "Descrição",
      sub: "Reescreve a descrição em blocos padronizados para Mercado Livre.",
      conteudoAtual: descricaoAtualHtml(descAtual),
      conteudoSugerido: descricaoSugeridaHtml(null),
      botaoGerar: "✨ Gerar Descrição",
    });

    var fichaSec = otimSecaoHtml({
      id: "ficha_tecnica",
      icon: "F",
      titulo: "Ficha Técnica",
      sub: "Identifica atributos faltantes ou inconsistentes e sugere preenchimento.",
      conteudoAtual: fichaAtualHtml(tryParseJSON(a.attributes_json, [])),
      conteudoSugerido: fichaSugeridaHtml(null),
      botaoGerar: "✨ Sugerir Ficha Técnica",
    });

    return '<div class="am-otim">' + seoSec + descSec + fichaSec + "</div>";
  }

  function otimSecaoHtml(o) {
    return '<section class="am-otim-section" data-section="' + o.id + '">' +
      '<div class="am-otim-section__head">' +
        '<div class="am-otim-section__title">' +
          '<div class="am-otim-section__icon">' + o.icon + "</div>" +
          "<div><h3>" + escapeHtml(o.titulo) + "</h3><p>" + escapeHtml(o.sub) + "</p></div>" +
        "</div>" +
        '<span class="am-otim-status" data-status="' + o.id + '">' +
          '<span class="am-otim-status__dot"></span>Aguardando geração</span>' +
      "</div>" +
      '<div class="am-otim-section__body">' +
        '<div class="am-otim-grid">' +
          '<div class="am-otim-col am-otim-col--atual" data-atual="' + o.id + '">' +
            o.conteudoAtual +
          "</div>" +
          '<div class="am-otim-col am-otim-col--sugerido" data-sugerido="' + o.id + '">' +
            o.conteudoSugerido +
          "</div>" +
        "</div>" +
        '<div class="am-otim-actions">' +
          '<button class="am-btn am-btn--ai" data-gerar="' + o.id + '">' + o.botaoGerar + "</button>" +
          '<span class="am-otim-actions__sep"></span>' +
        "</div>" +
      "</div>" +
    "</section>";
  }

  // ----- SEO (lado esquerdo: atual editável) -----
  function seoAtualHtml(a) {
    var titulo = a.titulo || "";
    var modelo = a.modelo || "";
    return '<div class="am-otim-col__label">Atual no Mercado Livre' +
      '<span class="am-otim-col__label-meta">' + titulo.length + "/60</span></div>" +
      '<div class="am-otim-campo">' +
        "<label>Título</label>" +
        '<textarea class="am-textarea" id="am-titulo-atual" rows="2" maxlength="60">' +
          escapeHtml(titulo) + "</textarea>" +
        '<div class="am-otim-campo__row">' +
          '<button class="am-btn am-btn--sm" data-copy="am-titulo-atual">📋 Copiar</button>' +
          '<span class="am-otim-col__label-meta" id="am-titulo-atual-count">' +
            titulo.length + " caracteres</span>" +
        "</div>" +
      "</div>" +
      '<div class="am-otim-campo">' +
        "<label>Campo modelo</label>" +
        '<input class="am-input" id="am-modelo-atual" value="' + escapeHtml(modelo) + '" />' +
        '<div class="am-otim-campo__row">' +
          '<button class="am-btn am-btn--sm" data-copy="am-modelo-atual">📋 Copiar</button>' +
        "</div>" +
      "</div>";
  }

  // ----- SEO (lado direito: sugestões da IA) -----
  function seoSugeridoHtml(otim) {
    if (!otim) {
      return '<div class="am-otim-col__label">Sugestão da IA</div>' +
        '<div class="am-otim-vazio">Clique em <b>Gerar SEO</b> para ver as sugestões aqui.</div>';
    }

    var alts = (tryParseJSON(otim.melhorias_json, {}) || {}).titulos_alternativos || [];
    var alertas = tryParseJSON(otim.alertas_json, []) || [];

    var opcoesHtml = "";
    // título principal
    opcoesHtml += '<div class="am-otim-opcao am-otim-opcao--principal">' +
      '<div class="am-otim-opcao__head"><span>★ Principal</span><span>' +
      (otim.titulo_sugerido_chars || 0) + "/60</span></div>" +
      '<div class="am-otim-opcao__txt">' + escapeHtml(otim.titulo_sugerido || "") + "</div>" +
      '<div class="am-otim-opcao__btns">' +
        '<button class="am-btn am-btn--xs" data-copy-text="' + escapeAttr(otim.titulo_sugerido || "") + '">📋 Copiar</button>' +
        '<button class="am-btn am-btn--xs am-btn--success" data-aprovar-titulo="' + escapeAttr(otim.titulo_sugerido || "") + '">✓ Aprovar esta</button>' +
      "</div>" +
    "</div>";
    // alternativas
    alts.forEach(function (t, idx) {
      var len = String(t || "").length;
      opcoesHtml += '<div class="am-otim-opcao">' +
        '<div class="am-otim-opcao__head"><span>Opção ' + (idx + 1) + "</span><span>" + len + "/60</span></div>" +
        '<div class="am-otim-opcao__txt">' + escapeHtml(t) + "</div>" +
        '<div class="am-otim-opcao__btns">' +
          '<button class="am-btn am-btn--xs" data-copy-text="' + escapeAttr(t) + '">📋 Copiar</button>' +
          '<button class="am-btn am-btn--xs am-btn--success" data-aprovar-titulo="' + escapeAttr(t) + '">✓ Aprovar esta</button>' +
        "</div>" +
      "</div>";
    });

    var score = otim.score_seo != null ? otim.score_seo : 0;
    var alertasHtml = "";
    if (alertas.length) {
      alertasHtml = '<ul class="am-otim-alertas">';
      alertas.forEach(function (al) { alertasHtml += "<li>" + escapeHtml(al) + "</li>"; });
      alertasHtml += "</ul>";
    }

    return '<div class="am-otim-col__label">Sugestão da IA' +
      '<span class="am-badge am-badge--ia">' + escapeHtml(otim.ai_model || "IA") + "</span></div>" +
      '<div class="am-otim-campo"><label>Títulos sugeridos</label>' +
        '<div class="am-otim-opcoes">' + opcoesHtml + "</div></div>" +
      '<div class="am-otim-campo">' +
        "<label>Modelo sugerido</label>" +
        '<input class="am-input" id="am-modelo-sugerido" value="' + escapeAttr(otim.modelo_sugerido || "") + '" />' +
        '<div class="am-otim-campo__row">' +
          '<button class="am-btn am-btn--sm" data-copy="am-modelo-sugerido">📋 Copiar</button>' +
          '<button class="am-btn am-btn--sm am-btn--success" data-aprovar-modelo="1">✓ Aprovar modelo</button>' +
        "</div>" +
      "</div>" +
      '<div class="am-otim-meta">' +
        '<div class="am-otim-meta__row">' +
          '<span>Score SEO:</span><b class="am-otim-score ' + scoreClasse(score) + '">' + score + "/100</b>" +
        "</div>" +
        (otim.motivo ? '<div class="am-otim-meta__row"><span>Motivo:</span><b>' + escapeHtml(otim.motivo) + "</b></div>" : "") +
        alertasHtml +
      "</div>";
  }

  // ----- Descrição -----
  function descricaoAtualHtml(desc) {
    var d = String(desc || "").trim();
    return '<div class="am-otim-col__label">Descrição atual' +
      '<span class="am-otim-col__label-meta">' + d.length + " caracteres</span></div>" +
      '<div class="am-otim-campo">' +
        '<textarea class="am-textarea" id="am-desc-atual" rows="14" placeholder="Sem descrição cadastrada">' +
          escapeHtml(d) + "</textarea>" +
        '<div class="am-otim-campo__row">' +
          '<button class="am-btn am-btn--sm" data-copy="am-desc-atual">📋 Copiar</button>' +
        "</div>" +
      "</div>";
  }

  function descricaoSugeridaHtml(otim) {
    if (!otim) {
      return '<div class="am-otim-col__label">Sugestão da IA</div>' +
        '<div class="am-otim-vazio">Clique em <b>Gerar Descrição</b> para ver a sugestão aqui.</div>';
    }
    var melh = (tryParseJSON(otim.melhorias_json, {}) || {}).itens || [];
    var alertas = tryParseJSON(otim.alertas_json, []) || [];
    var d = otim.descricao_sugerida || "";

    var alertasHtml = "";
    if (alertas.length) {
      alertasHtml = '<ul class="am-otim-alertas">';
      alertas.forEach(function (al) { alertasHtml += "<li>" + escapeHtml(al) + "</li>"; });
      alertasHtml += "</ul>";
    }
    var melhHtml = "";
    if (melh.length) {
      melhHtml = '<div class="am-otim-meta__row"><span>Melhorias:</span></div><ul class="am-otim-alertas" style="color:#5b6680;">';
      melh.forEach(function (m) { melhHtml += "<li>" + escapeHtml(m) + "</li>"; });
      melhHtml += "</ul>";
    }

    return '<div class="am-otim-col__label">Sugestão da IA' +
      '<span class="am-badge am-badge--ia">' + escapeHtml(otim.ai_model || "IA") + "</span></div>" +
      '<div class="am-otim-campo">' +
        "<label>Descrição sugerida (" + d.length + " caracteres)</label>" +
        '<textarea class="am-textarea" id="am-desc-sugerida" rows="14">' + escapeHtml(d) + "</textarea>" +
        '<div class="am-otim-campo__row">' +
          '<button class="am-btn am-btn--sm" data-copy="am-desc-sugerida">📋 Copiar</button>' +
          '<button class="am-btn am-btn--sm am-btn--success" data-aprovar-descricao="1">✓ Aprovar descrição</button>' +
        "</div>" +
      "</div>" +
      (melhHtml || alertasHtml
        ? '<div class="am-otim-meta">' + melhHtml + alertasHtml + "</div>"
        : "");
  }

  // ----- Ficha técnica -----
  function fichaAtualHtml(attrs) {
    var preenchidos = (attrs || []).filter(function (x) { return x && x.value; });
    var vazios = (attrs || []).filter(function (x) { return !x || !x.value; });
    var html = '<div class="am-otim-col__label">Ficha técnica atual' +
      '<span class="am-otim-col__label-meta">' + preenchidos.length + " / " +
      (attrs || []).length + " preenchidos</span></div>";
    if (!attrs || !attrs.length) {
      return html + '<div class="am-otim-vazio">Sem atributos cadastrados neste anúncio.</div>';
    }
    html += '<div style="max-height:380px;overflow-y:auto;">' +
      '<table class="am-ficha-tabela"><thead><tr><th>Atributo</th><th>Valor</th></tr></thead><tbody>';
    preenchidos.forEach(function (x) {
      html += "<tr><td>" + escapeHtml(x.name || x.id) +
        '</td><td class="am-ficha-val">' + escapeHtml(x.value) + "</td></tr>";
    });
    vazios.forEach(function (x) {
      html += "<tr><td>" + escapeHtml(x.name || x.id) +
        '</td><td style="color:#d64545;">vazio</td></tr>';
    });
    html += "</tbody></table></div>";
    return html;
  }

  function fichaSugeridaHtml(otim) {
    if (!otim) {
      return '<div class="am-otim-col__label">Sugestão da IA</div>' +
        '<div class="am-otim-vazio">Clique em <b>Sugerir Ficha Técnica</b> para ver a análise.</div>';
    }
    var sug = tryParseJSON(otim.ficha_tecnica_sugerida_json, []) || [];
    var alertas = tryParseJSON(otim.alertas_json, []) || [];
    if (!sug.length) {
      return '<div class="am-otim-col__label">Sugestão da IA</div>' +
        '<div class="am-otim-vazio">A IA não encontrou ajustes relevantes — ficha técnica já está aceitável.</div>';
    }

    var html = '<div class="am-otim-col__label">Sugestões da IA' +
      '<span class="am-badge am-badge--ia">' + escapeHtml(otim.ai_model || "IA") + "</span></div>" +
      '<div style="max-height:380px;overflow-y:auto;">' +
      '<table class="am-ficha-tabela"><thead><tr><th>Campo</th><th>Atual</th><th>Sugerido</th><th>Conf.</th></tr></thead><tbody>';
    sug.forEach(function (s) {
      var conf = String(s.confianca || "media").toLowerCase();
      html += "<tr>" +
        "<td>" + escapeHtml(s.campo || "—") + "</td>" +
        "<td>" + escapeHtml(s.valor_atual || "(vazio)") + "</td>" +
        '<td class="am-ficha-suj">' + escapeHtml(s.valor_sugerido || "—") + "</td>" +
        '<td><span class="am-conf am-conf--' + conf + '">' + escapeHtml(conf) + "</span></td>" +
      "</tr>";
    });
    html += "</tbody></table></div>";

    if (alertas.length) {
      html += '<ul class="am-otim-alertas">';
      alertas.forEach(function (al) { html += "<li>" + escapeHtml(al) + "</li>"; });
      html += "</ul>";
    }

    html += '<div class="am-otim-actions" style="margin-top:10px;">' +
      '<button class="am-btn am-btn--sm" data-copy-ficha="1">📋 Copiar como lista</button>' +
      '<button class="am-btn am-btn--sm am-btn--success" data-aprovar-ficha="1">✓ Aprovar sugestões</button>' +
      "</div>";
    return html;
  }

  function escapeAttr(s) {
    return escapeHtml(String(s || "").replace(/\n/g, " "));
  }

  // ===========================================================================
  // Bind do painel de IA
  // ===========================================================================
  function bindPainelOtimizacao() {
    var body = el("am-drawer-body");

    // Botões "Copiar" em campos existentes (id)
    body.querySelectorAll("[data-copy]").forEach(function (b) {
      b.addEventListener("click", function () {
        var alvo = el(this.getAttribute("data-copy"));
        if (alvo) copiarTexto(alvo.value !== undefined ? alvo.value : alvo.textContent);
      });
    });
    // Botões "Copiar" com texto inline
    body.querySelectorAll("[data-copy-text]").forEach(function (b) {
      b.addEventListener("click", function () {
        copiarTexto(this.getAttribute("data-copy-text"));
      });
    });
    // Botões "Gerar" por seção
    body.querySelectorAll("[data-gerar]").forEach(function (b) {
      b.addEventListener("click", function () { gerar(this.getAttribute("data-gerar")); });
    });
    // Aprovar título (uma das 3 opções)
    body.querySelectorAll("[data-aprovar-titulo]").forEach(function (b) {
      b.addEventListener("click", function () { aprovarTitulo(this.getAttribute("data-aprovar-titulo")); });
    });
    body.querySelectorAll("[data-aprovar-modelo]").forEach(function (b) {
      b.addEventListener("click", function () { aprovarModelo(); });
    });
    body.querySelectorAll("[data-aprovar-descricao]").forEach(function (b) {
      b.addEventListener("click", function () { aprovarDescricao(); });
    });
    body.querySelectorAll("[data-aprovar-ficha]").forEach(function (b) {
      b.addEventListener("click", function () { aprovarFicha(); });
    });
    body.querySelectorAll("[data-copy-ficha]").forEach(function (b) {
      b.addEventListener("click", copiarFichaSugerida);
    });

    // contador de chars do título atual
    var tat = el("am-titulo-atual");
    if (tat) {
      tat.addEventListener("input", function () {
        var c = el("am-titulo-atual-count");
        if (c) c.textContent = this.value.length + " caracteres";
        var meta = this.parentNode.parentNode.querySelector(".am-otim-col__label-meta");
        if (meta) meta.textContent = this.value.length + "/60";
      });
    }
  }

  // ===========================================================================
  // Histórico — pega últimas otimizações de cada tipo e popula painel
  // ===========================================================================
  function carregarHistoricoOtimizacoes(itemId) {
    var url = "/anuncios-meli/" + encodeURIComponent(itemId) +
              "/otimizacoes?clienteSlug=" + encodeURIComponent(AM.clienteAtual.slug);
    api(url).then(function (r) {
      if (!r.data || !r.data.ok) return;
      var lista = r.data.otimizacoes || [];
      // pega a mais recente de cada tipo
      var porTipo = { seo: null, descricao: null, ficha_tecnica: null };
      lista.forEach(function (o) {
        if (porTipo[o.tipo] === null) porTipo[o.tipo] = o;
      });
      AM.otimizacoes = porTipo;
      if (porTipo.seo) atualizarSecao("seo", porTipo.seo);
      if (porTipo.descricao) atualizarSecao("descricao", porTipo.descricao);
      if (porTipo.ficha_tecnica) atualizarSecao("ficha_tecnica", porTipo.ficha_tecnica);
    });
  }

  // ===========================================================================
  // Gerar (chama IA)
  // ===========================================================================
  function gerar(tipo) {
    if (!AM.detalheAtual) return;
    var a = AM.detalheAtual.anuncio;
    var btn = document.querySelector('[data-gerar="' + tipo + '"]');
    var statusEl = document.querySelector('[data-status="' + tipo + '"]');

    if (btn) { btn.disabled = true; btn.textContent = "Gerando..."; }
    if (statusEl) {
      statusEl.className = "am-otim-status am-otim-status--gerando";
      statusEl.innerHTML = '<span class="am-otim-status__dot"></span>Consultando IA...';
    }

    api("/anuncios-meli/" + encodeURIComponent(a.item_id) + "/otimizar", {
      method: "POST",
      body: { clienteSlug: AM.clienteAtual.slug, tipo: tipo },
    }).then(function (r) {
      if (btn) { btn.disabled = false; btn.textContent = botaoLabelDe(tipo); }
      if (!r.data || !r.data.ok) {
        var motivo = (r.data && r.data.motivo) || "Erro ao consultar a IA.";
        if (statusEl) {
          statusEl.className = "am-otim-status am-otim-status--erro";
          statusEl.innerHTML = '<span class="am-otim-status__dot"></span>' + escapeHtml(motivo);
        }
        toast(motivo);
        return;
      }
      AM.otimizacoes[tipo] = r.data.otimizacao;
      atualizarSecao(tipo, r.data.otimizacao);
      if (statusEl) {
        statusEl.className = "am-otim-status am-otim-status--ok";
        statusEl.innerHTML = '<span class="am-otim-status__dot"></span>Sugestão gerada';
      }
    });
  }

  function botaoLabelDe(tipo) {
    if (tipo === "seo") return "✨ Gerar SEO";
    if (tipo === "descricao") return "✨ Gerar Descrição";
    if (tipo === "ficha_tecnica") return "✨ Sugerir Ficha Técnica";
    return "✨ Gerar";
  }

  function atualizarSecao(tipo, otim) {
    var alvo = document.querySelector('[data-sugerido="' + tipo + '"]');
    if (!alvo) return;
    if (tipo === "seo") alvo.innerHTML = seoSugeridoHtml(otim);
    if (tipo === "descricao") alvo.innerHTML = descricaoSugeridaHtml(otim);
    if (tipo === "ficha_tecnica") alvo.innerHTML = fichaSugeridaHtml(otim);

    var status = document.querySelector('[data-status="' + tipo + '"]');
    if (status && otim.status === "aprovado") {
      status.className = "am-otim-status am-otim-status--ok";
      status.innerHTML = '<span class="am-otim-status__dot"></span>Aprovado em ' +
        formatData(otim.aprovado_at);
    }

    // re-bind dos botões dentro do conteúdo recém-renderizado
    bindPainelOtimizacao();
  }

  // ===========================================================================
  // Aprovação
  // ===========================================================================
  function aprovarTitulo(titulo) {
    var otim = AM.otimizacoes.seo;
    if (!otim) { toast("Gere a sugestão primeiro."); return; }
    if (!titulo || titulo.length > 60) { toast("Título inválido."); return; }
    aprovar(otim.id, { tituloAprovado: titulo }, "Título aprovado.");
  }

  function aprovarModelo() {
    var otim = AM.otimizacoes.seo;
    if (!otim) { toast("Gere a sugestão primeiro."); return; }
    var input = el("am-modelo-sugerido");
    var modelo = input ? input.value.trim() : "";
    if (!modelo) { toast("Modelo vazio."); return; }
    aprovar(otim.id, { modeloAprovado: modelo }, "Modelo aprovado.");
  }

  function aprovarDescricao() {
    var otim = AM.otimizacoes.descricao;
    if (!otim) { toast("Gere a sugestão primeiro."); return; }
    var ta = el("am-desc-sugerida");
    var desc = ta ? ta.value : "";
    if (!desc.trim()) { toast("Descrição vazia."); return; }
    aprovar(otim.id, { descricaoAprovada: desc }, "Descrição aprovada.");
  }

  function aprovarFicha() {
    var otim = AM.otimizacoes.ficha_tecnica;
    if (!otim) { toast("Gere a sugestão primeiro."); return; }
    var sug = tryParseJSON(otim.ficha_tecnica_sugerida_json, []) || [];
    aprovar(otim.id, { fichaAprovadaJson: sug }, "Sugestões aprovadas.");
  }

  function aprovar(otimId, dados, msgOk) {
    api("/anuncios-meli/otimizacoes/" + otimId + "/aprovar", {
      method: "PATCH",
      body: dados,
    }).then(function (r) {
      if (r.data && r.data.ok) {
        toast(msgOk || "Aprovado.");
        // atualiza estado local e UI
        var o = r.data.otimizacao;
        if (o && AM.otimizacoes[o.tipo]) {
          AM.otimizacoes[o.tipo] = o;
          atualizarSecao(o.tipo, o);
        }
      } else {
        toast((r.data && r.data.motivo) || "Erro ao aprovar.");
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
    var overlay = document.createElement("div");
    overlay.className = "am-sync-overlay";
    overlay.id = "am-sync-overlay";
    overlay.innerHTML = '<div class="am-sync-box"><div class="am-spinner"></div><strong>' +
      (modo === "completo" ? "Sincronização completa em andamento" : "Buscando anúncios novos") +
      "</strong><p>Consultando a API do Mercado Livre. Pode levar alguns minutos.</p></div>";
    document.body.appendChild(overlay);

    api("/anuncios-meli/sync", {
      method: "POST",
      body: { clienteSlug: AM.clienteAtual.slug, modo: modo },
    }).then(function (r) {
      var box = overlay.querySelector(".am-sync-box");
      var d = r.data || {};
      if (d.ok) {
        var msg;
        if (d.totalSalvos > 0) {
          msg = "<strong>Sincronização concluída</strong><p>" + (d.totalEncontrados || 0) +
            " anúncios na conta · " + d.totalSalvos + " gravados/atualizados.</p>" +
            (d.limitado ? "<p>O limite de itens por sincronização foi atingido. Rode novamente para continuar.</p>" : "");
        } else {
          msg = "<strong>Tudo em dia</strong><p>" + escapeHtml(d.mensagem || "Nenhum anúncio novo para gravar.") + "</p>";
        }
        box.innerHTML = msg + '<button class="am-btn am-btn--primary" id="am-sync-ok">OK</button>';
        carregarResumo(); carregarAnuncios();
      } else {
        box.innerHTML = "<strong>Não foi possível sincronizar</strong><p>" +
          escapeHtml(d.motivo || "Erro ao consultar o Mercado Livre.") + "</p>" +
          (d.codigo === "NO_TOKEN" ? "<p>Conecte a conta do Mercado Livre deste cliente na tela de Clientes.</p>" : "") +
          '<button class="am-btn" id="am-sync-ok">Fechar</button>';
      }
      var btn = el("am-sync-ok");
      if (btn) btn.addEventListener("click", function () {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
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
