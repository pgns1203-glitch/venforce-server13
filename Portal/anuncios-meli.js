/* =============================================================================
   Anúncios Meli — lógica do módulo (JavaScript puro, sem dependências)
   Central operacional + Agente Otimizador Textual IA.

   A listagem é UMA SÓ (ver docs/AUDITORIA_ANUNCIOS_ML_LISTAGEM_UNIFICADA.md):
   anúncio agrupado e anúncio individual dividem a mesma lista, a mesma
   ordenação e a mesma paginação. A família é forma de agrupamento interno do
   Mercado Livre, não uma categoria de tela — não existe aba.

   Endpoints consumidos:
     GET   /anuncios-meli/clientes
     POST  /anuncios-meli/sync
     GET   /anuncios-meli/resumo?clienteSlug=
     GET   /anuncios-meli/familias?clienteSlug=...    (A LISTA unificada)
     GET   /anuncios-meli/familias/:familyId          (expansão do agrupador)
     GET   /anuncios-meli/performance                 (métricas 7d + margem, assíncrono — nunca bloqueia a lista)
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
    // ── Listagem UNIFICADA ─────────────────────────────────────────────────
    // Uma lista só. `AM.anuncios` guarda linhas, e cada linha é um agrupador
    // (tipo "familia", quando o Mercado Livre agrupou aquele produto) ou o
    // próprio anúncio (tipo "item"). Não existe modo, aba nem segunda lista:
    // a família é forma de agrupamento interno do ML, não categoria de tela.
    // Ver docs/AUDITORIA_ANUNCIOS_ML_LISTAGEM_UNIFICADA.md.
    //
    // Cache dos agrupadores já conhecidos: family_id -> detalhe. Reabrir um
    // agrupador não gasta requisição — e, desde o pré-carregamento em
    // background (ver garantirFamiliaDetalhe/carregarMetricasDosGruposVisiveis),
    // a família pode já estar aqui ANTES do primeiro clique.
    //
    // `performanceCache` é o mesmo tipo de cache, por item_id, mas com dois
    // aspectos independentes (`temMetricas`/`temMargem`): o pré-carregamento
    // só pede metricas7d (nunca margem, que fica cara — Motor de Margem — e
    // só faz sentido quando o operador realmente abre o agrupador). Ao
    // expandir, só o aspecto que falta é buscado — metricas7d já cacheado
    // NUNCA é pedido de novo.
    //
    // `familyFetchEmVoo`/`metricasEmVoo`/`margemEmVoo`/`composicaoEmVoo`
    // deduplicam chamadas concorrentes para o MESMO family_id/item_id: o
    // pré-carregamento em background e um clique do operador na mesma
    // família (ou abrir o modal de um item que já está em voo) nunca
    // disparam duas requisições — o segundo pedido reaproveita a Promise já
    // em voo do primeiro (ver garantirFamiliaDetalhe/carregarPerformance).
    //
    // `composicao`/`temComposicao` (por item_id, dentro de
    // `performanceCache[itemId]`): a decomposição da margem (venda, custo,
    // comissão, frete, taxa fixa, imposto) que alimenta a seção "Composição
    // da margem" do modal de detalhe — só pedida quando o operador abre
    // aquela seção (ver garantirComposicaoDoItem), nunca junto do resto.
    state: {
      familyCache: {},
      familyFetchEmVoo: {},
      familyFetchFalhou: {},
      performanceCache: {},
      metricasEmVoo: {},
      margemEmVoo: {},
      composicaoEmVoo: {},
    },
    // familiaEpoca invalida de uma vez toda expansão/pré-carregamento em voo
    // quando o cliente/conta muda (senão o detalhe do cliente A pintaria a
    // tela do B, ou escreveria no cache do B usando a época do A).
    familiaEpoca: 0,
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

  // Dois critérios DIFERENTES, de propósito — não unificar de volta:
  //  - tag visual "Catálogo": só catalog_listing===true. family_name é outro
  //    conceito da doc do ML (família/User Products), não indica publicação
  //    de catálogo — usá-lo aqui gerava falso positivo na tag.
  //  - bloqueio de edição do título: mais amplo (catalog_listing OU
  //    family_name), porque o ML já demonstrou recusar o PUT de título só
  //    por family_name, mesmo sem catalog_listing=true (achado da
  //    investigação do BODY_INVALID_FIELDS).
  function ehCatalogoOficial(a) {
    return !!(a && a.catalog_listing === true);
  }

  function tituloTravadoPorCatalogo(a) {
    return !!(a && (a.catalog_listing === true || a.family_name));
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

  // Todo card de KPI vale para a lista inteira. Enquanto a tela tinha duas
  // abas, metade dos cards ficava desabilitada em cada uma — a aba "Sem
  // agrupamento" monopolizava o parâmetro `filtro`, e a aba "Famílias" lia um
  // endpoint que só aceitava `q`. Com uma lista só, o recorte deixou de
  // disputar o slot do filtro e nenhum card fica indisponível.
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

    // Trocar de cliente/conta invalida o cache de expansões: ele é indexado só
    // por family_id, então sem isso um agrupador do cliente anterior
    // reapareceria para o cliente novo. A época sobe junto para descartar toda
    // expansão que ainda esteja em voo.
    resetarExpansoes();

    if (!ctx) { AM.clienteAtual = null; AM.contaMlId = ""; return; }

    AM.clienteAtual = { slug: ctx.slug, nome: ctx.nome };
    AM.contaMlId = ctx.contaId;
    AM.resumo = null;
    AM.anuncios = [];
    AM.paginacao.page = 1;
    AM.filtros = { q: "", status: "", filtro: "" };
    AM.kpiAtivo = null;
    if (el("am-busca")) el("am-busca").value = "";
    atualizarIndicadorFiltros();
    renderHudHeader();
    carregarResumo();
    carregarAnuncios();
  }

  // Zera o cache de agrupadores expandidos/pré-carregados. Chamado na troca
  // de contexto. `familyFetchEmVoo` some junto: sem isso, uma família com o
  // MESMO family_id na conta nova reaproveitaria a Promise da conta velha
  // (fechada sobre a query string errada). performanceCache NÃO é zerado —
  // item_id é global no Mercado Livre, então o cache continua válido.
  function resetarExpansoes() {
    AM.state.familyCache = {};
    AM.state.familyFetchEmVoo = {};
    AM.state.familyFetchFalhou = {};
    AM.familiaEpoca++;
  }

  function bindEventosFixos() {
    document.addEventListener("vf:context", aplicarContextoDoShell);
    el("am-busca").addEventListener("input", function (e) {
      AM.filtros.q = e.target.value;
      atualizarIndicadorFiltros();
      if (AM.buscaTimer) clearTimeout(AM.buscaTimer);
      AM.buscaTimer = setTimeout(function () {
        // Uma busca, uma lista. O backend casa o termo por item (título, MLB,
        // SKU, MLBU ou nome da família) e devolve o GRUPO inteiro de quem
        // casou — um anúncio nunca aparece órfão do seu agrupador.
        AM.paginacao.page = 1;
        carregarAnuncios();
      }, 350);
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

  // A LISTA. Uma requisição, uma ordenação, uma paginação — para anúncios
  // agrupados e não agrupados. O endpoint devolve linhas já resolvidas em
  // grupo (ver docs/AUDITORIA_ANUNCIOS_ML_LISTAGEM_UNIFICADA.md §4.5); a tela
  // não intercala nada e não decide quem agrupa com quem.
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

    api("/anuncios-meli/familias?" + qs).then(function (r) {
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
        "<span>Estoque</span><span>Vendidos</span><span>Métricas últ. 7 dias</span>" +
        "<span>Margem</span><span>Score VenForce</span><span></span>" +
      "</div>";
    // Mesma grade, mesmas colunas, mesma densidade para os dois tipos de
    // linha. O que muda é só o que existe embaixo: um agrupador abre, um
    // anúncio individual não tem nada para abrir (no modelo do ML a relação
    // ali é 1:1). Nenhuma moldura, cor ou seção separa os dois.
    AM.anuncios.forEach(function (linha, idx) {
      html += linha.tipo === "familia" ? rowGrupoHtml(linha, idx) : rowAnuncioHtml(linha);
    });
    html += "</div>" + paginacaoHtml(AM.paginacao, "am-pag", "anúncio");
    box.innerHTML = html;

    bindLinhasAnuncio(box);
    bindEstoqueEditavel(box);

    box.querySelectorAll(".am-row--grupo[data-familia]").forEach(function (row) {
      row.addEventListener("click", function () { alternarGrupo(row); });
      row.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); alternarGrupo(row); }
      });
    });

    bindPaginacao("am-pag", AM.paginacao, function (pagina) {
      AM.paginacao.page = pagina;
      carregarAnuncios();
    });

    // Métricas últ. 7 dias + margem chegam DEPOIS que a lista já está na
    // tela — nunca atrasam este render. Anúncios avulsos (tipo "item") pedem
    // as DUAS (metricas7d + margem, como sempre). Agrupadores pedem só
    // metricas7d dos filhos, em background, para preencher a SOMA na
    // linha-mãe sem exigir clique (ver carregarMetricasDosGruposVisiveis) —
    // a margem continua reservada para quando o operador realmente expande.
    carregarPerformance(
      AM.anuncios.filter(function (l) { return l.tipo === "item"; }).map(function (l) { return l.item_id; })
    );
    carregarMetricasDosGruposVisiveis();
  }

  // Linhas de anúncio da lista principal (tipo "item"). As linhas de MLB
  // dentro de um agrupador expandido têm o seu próprio bind (bindLinhasMlb),
  // porque são outra classe — mas abrem o MESMO modal.
  function bindLinhasAnuncio(raiz) {
    raiz.querySelectorAll(".am-row[data-item]").forEach(function (row) {
      function abrir() { abrirDetalhe(row.getAttribute("data-item"), row); }
      // Mesmas duas exceções da linha filha (ver bindLinhasMlb): controles
      // próprios da linha não podem abrir o modal por cima deles.
      function ehControleProprio(e) {
        return !!(e.target.closest(".am-row__link") || e.target.closest(".am-estoque"));
      }
      row.addEventListener("click", function (e) {
        if (ehControleProprio(e)) return; // ação externa não abre o modal
        abrir();
      });
      row.addEventListener("keydown", function (e) {
        if (ehControleProprio(e)) return; // deixa o link nativo agir (Enter = navegar)
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); abrir(); }
      });
    });
  }

  // ===========================================================================
  // LINHA DE AGRUPADOR — e a expansão Agrupador -> Item MLB
  //
  // A hierarquia do Mercado Livre tem três níveis (family_id ->
  // user_product_id -> item_id) e a tela mostra os três, como a listagem
  // oficial do ML:
  //
  //   AGRUPADOR / FAMÍLIA
  //     └── VARIAÇÃO   (nome amigável + MLBU discreto)
  //          ├── MLB Clássico
  //          └── MLB Premium
  //
  // A variação voltou a ser nível visível, mas com o peso trocado: antes ela
  // era uma faixa "PRODUTO MLBU-123 · 2 anúncios" — o MLBU como manchete de um
  // nível. Agora a manchete é o NOME da variação ("Azul P") e o MLBU é
  // legenda, do tamanho de um SKU. O MLBU não é entidade operável: o nível não
  // tem handler, não expande, não abre nada.
  //
  // Ações por nível, de propósito:
  //   Agrupador -> só expandir/colapsar (a família é chave derivada do ML, não
  //                entidade operável: não tem preço nem status próprio);
  //   Variação  -> nada: é subtítulo dos MLBs, sem handler;
  //   Item MLB  -> abrirDetalhe() (o modal de sempre) e edição de ESTOQUE na
  //                própria linha — o único dado do anúncio que se escreve sem
  //                abrir o modal, porque no ML ele pertence à variação e não
  //                ao anúncio (ver salvarEstoque).
  //
  // Nenhum PAINEL abre sozinho — expandir (ver MLBs, editar estoque) é sempre
  // ação explícita do operador. O DETALHE da família, porém, é buscado
  // sozinho em BACKGROUND assim que a família aparece na página (ver
  // carregarMetricasDosGruposVisiveis), só para somar as métricas 7d na
  // linha-mãe — a primeira expansão de verdade (clique) reaproveita esse
  // cache (AM.state.familyCache, via GET /anuncios-meli/familias/:familyId) e
  // só então busca a margem, que o pré-carregamento nunca pede.
  // ===========================================================================

  function iconeChevronSvg() {
    return '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>';
  }

  function plural(n, singular, pluralForma) {
    return n + " " + (n === 1 ? singular : pluralForma);
  }

  // Status do agrupador. A família não tem status no Mercado Livre — ela é
  // uma chave derivada de atributos. O que existe é o status de cada anúncio
  // dela, então a linha mostra o consenso e admite "Misto" quando não há:
  // inventar um status único seria afirmar algo que a API não diz.
  function statusGrupo(f) {
    var c = f.status_contagem || {};
    var total = f.total_itens || 0;
    if (total && c.ativos === total) return { label: "Ativo", classe: "is-success", titulo: "" };
    if (total && c.pausados === total) return { label: "Pausado", classe: "is-warning", titulo: "" };
    if (total && c.encerrados === total) return { label: "Encerrado", classe: "is-danger", titulo: "" };
    return {
      label: "Misto",
      classe: "is-info",
      titulo: (c.ativos || 0) + " ativos · " + (c.pausados || 0) + " pausados · " +
              (c.encerrados || 0) + " encerrados",
    };
  }

  // Preço do agrupador. "Preço por variação" é o nome da própria iniciativa do
  // ML: uma família existe justamente para ter preços diferentes por variação.
  // Faixa quando os extremos diferem, valor único quando coincidem.
  function precoGrupoHtml(f) {
    var min = f.preco_min, max = f.preco_max;
    if (min === null || min === undefined) return "—";
    if (max === null || max === undefined || Number(min) === Number(max)) {
      return escapeHtml(formatMoeda(min, f.moeda));
    }
    return '<span class="am-row__faixa">' + escapeHtml(formatMoeda(min, f.moeda)) +
      "<small>até " + escapeHtml(formatMoeda(max, f.moeda)) + "</small></span>";
  }

  // Uma linha de agrupador, na MESMA grade de 10 colunas de rowAnuncioHtml.
  // O painel de expansão é irmão da linha (não filho): .am-listagem é bloco,
  // não grade, então o painel simplesmente ocupa a largura inteira sem
  // precisar de caixa aninhada e sem desalinhar coluna nenhuma.
  function rowGrupoHtml(f, idx) {
    var painelId = "am-grupo-painel-" + idx;
    // A capa vem pronta em cover.thumbnail: o backend elege a variação que
    // representa a família (a mais relevante para a busca, quando há busca) a
    // cada leitura. O front NÃO deduz capa a partir dos itens — se fizesse
    // isso, a imagem só apareceria depois de expandir e poderia contradizer a
    // escolha da API.
    var capa = (f.cover && f.cover.thumbnail)
      ? '<img src="' + escapeHtml(f.cover.thumbnail) + '" alt="" loading="lazy" />'
      : iconeImagemSvg();
    var st = statusGrupo(f);
    var rotulo = f.family_name || "(família sem nome)";

    return '<div class="am-row am-row--grupo" data-familia="' + escapeAttr(f.family_id) + '" ' +
      'tabindex="0" role="button" aria-expanded="false" aria-controls="' + painelId + '" ' +
      'aria-label="Ver as variações de ' + escapeAttr(rotulo) + '">' +
      '<div class="am-row__thumb" aria-hidden="true">' + capa + "</div>" +
      '<div class="am-row__main">' +
        '<h3 class="am-row__titulo">' + escapeHtml(rotulo) + "</h3>" +
        '<div class="am-row__ids">' +
          // O identificador do AGRUPADOR, na mesma posição em que a linha do
          // anúncio individual mostra o MLB — é o "ID maior" do produto. Vem
          // rotulado porque, ao contrário de um MLB, family_id é um número
          // solto: sem o rótulo seria indistinguível de qualquer outro número
          // da linha. MLBU não aparece aqui nem em lugar nenhum da UI.
          '<span>Família <span class="vf-mono">' + escapeHtml(f.family_id) + "</span></span>" +
          "<span>" + plural(f.total_user_products || 0, "variação", "variações") + "</span>" +
          "<span>" + plural(f.total_itens || 0, "anúncio", "anúncios") + "</span>" +
        "</div>" +
      "</div>" +
      '<span class="vf-status ' + st.classe + '"' +
        (st.titulo ? ' title="' + escapeAttr(st.titulo) + '"' : "") + ">" + st.label + "</span>" +
      '<span class="am-row__preco">' + precoGrupoHtml(f) + "</span>" +
      // A soma que dá sentido ao agrupador: estoque por User Product distinto.
      '<span class="am-row__num" title="Soma do estoque das ' +
        escapeAttr(plural(f.total_user_products || 0, "variação", "variações")) + '">' +
        (f.estoque_total != null ? f.estoque_total : "—") + "</span>" +
      '<span class="am-row__num">' + (f.vendidos_total != null ? f.vendidos_total : "—") + "</span>" +
      // Métricas 7d: soma dos filhos, buscada sozinha em BACKGROUND assim
      // que a família aparece na página — não depende de expandir (ver
      // carregarMetricasDosGruposVisiveis/metricas7dAgregadoCelulaHtml).
      // Margem NUNCA agrega: fica "—" sempre, mesmo expandida (margem
      // enganosa é pior que margem ausente — regra do usuário, sem exceção
      // para soma, e sem gastar o Motor de Margem para um filho oculto).
      metricas7dAgregadoCelulaHtml(f.family_id) +
      '<span class="am-margem am-margem--indisponivel" title="A margem é calculada só por anúncio (MLB) — não existe uma margem do agrupador">—</span>' +
      scoreGaugeHtml(f.score_min) +
      '<div class="am-row__acao">' +
        '<span class="am-row__chevron" aria-hidden="true">' + iconeChevronSvg() + "</span>" +
      "</div>" +
    "</div>" +
    '<div class="am-grupo-painel" id="' + painelId + '" hidden></div>';
  }

  // Ponto ÚNICO de leitura do detalhe de uma família: cache -> Promise já em
  // voo (o pré-carregamento em background e um clique do operador na MESMA
  // família nunca disparam duas requisições) -> requisição nova. `época`
  // continua protegendo contra resposta tardia depois de trocar
  // cliente/conta — uma resposta cuja época não bate nunca escreve no cache
  // nem é devolvida (resolve pra null, e quem chamou trata como falha).
  function garantirFamiliaDetalhe(familyId) {
    var cache = AM.state.familyCache[familyId];
    if (cache) return Promise.resolve(cache);
    var emVoo = AM.state.familyFetchEmVoo[familyId];
    if (emVoo) return emVoo;

    var minhaEpoca = AM.familiaEpoca;
    var qs = "clienteSlug=" + encodeURIComponent(AM.clienteAtual.slug);
    if (AM.contaMlId) qs += "&clienteContaId=" + encodeURIComponent(AM.contaMlId);

    var promessa = api("/anuncios-meli/familias/" + encodeURIComponent(familyId) + "?" + qs).then(function (r) {
      delete AM.state.familyFetchEmVoo[familyId];
      if (minhaEpoca !== AM.familiaEpoca) return null; // outro cliente/conta assumiu a tela
      if (!r.data || !r.data.ok || !r.data.familia) return null;
      AM.state.familyCache[familyId] = r.data.familia;
      return r.data.familia;
    });
    AM.state.familyFetchEmVoo[familyId] = promessa;
    return promessa;
  }

  // Garante metricas7d (+ margem, quando pedida) dos filhos de UMA família já
  // conhecida (precisa estar em AM.state.familyCache — quem ainda não tem
  // detalhe usa garantirFamiliaDetalhe antes). Delega a carregarPerformance,
  // que já dedupe por item/aspecto — chamar isto de novo sem nada pendente
  // não gasta requisição nenhuma.
  function garantirPerformanceDaFamilia(familyId, incluirMargem) {
    var familia = AM.state.familyCache[familyId];
    if (!familia) return Promise.resolve();
    var ids = [];
    (familia.user_products || []).forEach(function (up) {
      (up.itens || []).forEach(function (item) { ids.push(item.item_id); });
    });
    if (!ids.length) return Promise.resolve();
    return carregarPerformance(ids, { incluirMargem: incluirMargem });
  }

  // Depois do primeiro paint (nunca atrasa o render — mesmo padrão da busca
  // de performance dos itens avulsos), busca em BACKGROUND o detalhe de cada
  // agrupador VISÍVEL nesta página e, com os filhos já conhecidos, as
  // métricas 7d deles — só para preencher a SOMA na linha-mãe sem exigir
  // clique. Margem NUNCA entra aqui (incluirMargem: false): filho ainda
  // oculto não pode gastar o Motor de Margem só para calcular um agregado
  // que nem existe (ver rowGrupoHtml — margem é só por MLB). O resultado
  // fica em AM.state.familyCache/performanceCache — expandir depois lê
  // daqui, nunca refaz a chamada.
  function carregarMetricasDosGruposVisiveis() {
    AM.anuncios.forEach(function (l) {
      if (l.tipo !== "familia") return;
      var familyId = l.family_id;
      garantirFamiliaDetalhe(familyId).then(function (familia) {
        if (!familia) {
          // Detalhe não veio (rede, 404, época trocou): sem filhos conhecidos
          // não há soma possível — marca para a célula sair de "carregando"
          // e virar "—" em vez de ficar presa para sempre.
          AM.state.familyFetchFalhou[familyId] = true;
          repintarLinhaDoGrupo(familyId);
          return;
        }
        return garantirPerformanceDaFamilia(familyId, false).then(function () {
          // Cobre tanto o caminho feliz quanto a falha da chamada de
          // metricas7d: se o agregado ainda não é computável depois desta
          // tentativa, marca como falhou — mesma régua "—" de qualquer
          // célula desta tela, nunca um spinner permanente.
          AM.state.familyFetchFalhou[familyId] = !metricas7dAgregadoDoGrupo(familyId);
          repintarLinhaDoGrupo(familyId);
        });
      });
    });
  }

  // Expandir/colapsar. Colapsar NÃO descarta o que já foi renderizado, e
  // reabrir lê AM.state.familyCache — nenhuma requisição nova.
  function alternarGrupo(linha) {
    var painel = linha.nextElementSibling;
    if (!painel || !painel.classList.contains("am-grupo-painel")) return;
    var familyId = linha.getAttribute("data-familia");
    var abrindo = linha.getAttribute("aria-expanded") !== "true";

    linha.setAttribute("aria-expanded", abrindo ? "true" : "false");
    linha.classList.toggle("is-aberta", abrindo);
    painel.hidden = !abrindo;
    if (!abrindo) return;

    var cache = AM.state.familyCache[familyId];
    if (cache) {
      // Já conhecida (clique repetido, ou o pré-carregamento em background já
      // respondeu): pinta na hora. A margem dos filhos, porém, só é buscada
      // AGORA — o pré-carregamento nunca a pede (ver carregarMetricasDosGruposVisiveis).
      renderFamiliaDetalhe(cache, painel);
      garantirPerformanceDaFamilia(familyId, true).then(function () { repintarLinhaDoGrupo(familyId); });
      return;
    }
    if (painel.getAttribute("data-carregando") === "1") return; // já tem um clique em voo
    carregarFamiliaDetalhe(familyId, painel);
  }

  function carregarFamiliaDetalhe(familyId, painel) {
    painel.setAttribute("data-carregando", "1");
    painel.innerHTML = estadoHtml("loading", "Carregando produtos da família…");

    // Reaproveita a MESMA Promise do pré-carregamento em background, se
    // houver uma em voo para esta família — nunca duas requisições para o
    // mesmo family_id só porque uma partiu sozinha e a outra veio de um
    // clique.
    garantirFamiliaDetalhe(familyId).then(function (familia) {
      painel.removeAttribute("data-carregando");
      if (!familia) {
        painel.innerHTML = estadoHtml("error", "Erro ao carregar a família", "Tente novamente.");
        return;
      }
      renderFamiliaDetalhe(familia, painel);

      // Métricas 7d (se o pré-carregamento ainda não tiver respondido) +
      // margem (que o pré-carregamento NUNCA pede) dos filhos. Quando os
      // dois terminam (sucesso OU falha — o que importa é não estar mais em
      // voo), a linha-mãe repinta com a soma. Margem nunca agrega (ver
      // rowGrupoHtml) — só as métricas de tráfego/venda fazem sentido somadas.
      garantirPerformanceDaFamilia(familyId, true).then(function () {
        repintarLinhaDoGrupo(familyId);
      });
    });
  }

  function renderFamiliaDetalhe(familia, painel) {
    var ups = familia.user_products || [];
    if (!ups.length) {
      painel.innerHTML = estadoHtml("empty", "Família sem produtos visíveis",
        "Nenhum anúncio desta família pertence à operação selecionada.");
      return;
    }
    var html = "";
    ups.forEach(function (up) { html += variacaoHtml(up, familia); });
    painel.innerHTML = html;
    bindLinhasMlb(painel);
    bindEstoqueEditavel(painel);
    // Expandir não mexe na capa: ela já veio decidida na listagem.
  }

  // Condição comercial do anúncio: é o que distingue dois MLBs da MESMA
  // variação, e virou informação necessária quando o nível do MLBU saiu da
  // tela. Deriva de listing_type_id pelo mesmo mapa que o modal de detalhe já
  // usava (TIPO_ANUNCIO) — nenhum rótulo novo, nenhuma regra nova.
  function condicaoComercial(a) {
    if (!a.listing_type_id) return "";
    return TIPO_ANUNCIO[a.listing_type_id] || a.listing_type_id;
  }

  // Ordem dos filhos dentro de uma variação. O padrão operacional do negócio é
  // Clássico + Premium por variação, e é essa a leitura que o ML dá — mas o
  // padrão NÃO é regra: a ordem é só preferência de exibição, com desempate
  // por item_id. Um tipo desconhecido, ou variação com 1 ou com 5 MLBs,
  // continua funcionando sem caso especial.
  var ORDEM_CONDICAO = { gold_special: 1, gold_pro: 2 };

  function ordenarFilhos(itens) {
    return itens.slice().sort(function (a, b) {
      var pa = ORDEM_CONDICAO[a.listing_type_id] || 9;
      var pb = ORDEM_CONDICAO[b.listing_type_id] || 9;
      if (pa !== pb) return pa - pb;
      return String(a.item_id).localeCompare(String(b.item_id));
    });
  }

  // ---------------------------------------------------------------------------
  // NOME AMIGÁVEL DA VARIAÇÃO — o "Azul 36" da listagem oficial do ML.
  //
  // Sai do TÍTULO do próprio anúncio. No modelo de User Products o ML compõe o
  // título do item como family_name + os valores dos atributos que variam:
  //
  //     family_name : "Apple iPhone 256GB"
  //     title       : "Apple iPhone 256GB Rojo"   ->  variação: "Rojo"
  //
  // (documentacao_api_meli/preco-variacao.md, resposta de criação de item; e
  // "se o family_name for modificado, o título do item será recalculado").
  // E `title` está na lista de campos SINCRONIZADOS por User Product
  // (user-products.md): o título pertence à VARIAÇÃO, não à condição de venda.
  // É isso que autoriza o título a nomeá-la — os dois MLBs de uma variação têm
  // o mesmo título por definição do ML.
  //
  // Por que NÃO pelos atributos: quem define a variação são os atributos com
  // hierarchy CHILD_PK / tag variation_attribute, e meliSyncService grava
  // attributes_json só como {id, name, value} — descarta `tags` e `hierarchy`.
  // Sem eles não há como saber qual atributo varia, e o conjunto depende da
  // categoria: cravar COLOR/SIZE seria regra inventada. O caminho documentado
  // para resolver isso de verdade é GET /user-products-families/{family_id},
  // que devolve `child_attributes_ids` — mas é chamada e persistência novas,
  // ou seja, reabrir a sincronização. Fica registrado, não feito.
  //
  // Quando o título não começa pelo family_name (título legado, family_name
  // trocado depois, item que nunca passou por UPtin) não existe sufixo para
  // extrair — e aí o nome é o título INTEIRO, que é o melhor identificador
  // fiel do payload. Nunca um recorte adivinhado.
  // ---------------------------------------------------------------------------

  // O título que representa a variação. É o do primeiro item com título: eles
  // são iguais entre irmãos por sincronização do ML, e quando um difere (linha
  // velha no snapshot) esse item mostra o seu na própria linha.
  function tituloDaVariacao(itens) {
    for (var i = 0; i < itens.length; i++) {
      if (itens[i] && itens[i].titulo) return itens[i].titulo;
    }
    return "";
  }

  function skuDaVariacao(itens) {
    for (var i = 0; i < itens.length; i++) {
      if (itens[i] && itens[i].sku) return itens[i].sku;
    }
    return "";
  }

  function nomeVariacao(itens, familyName) {
    var base = tituloDaVariacao(itens);
    if (!base) {
      // Sem título, o próximo identificador fiel é o SKU. Sem nenhum dos dois
      // não se inventa nome: o MLBU já está na legenda, abaixo.
      var sku = skuDaVariacao(itens);
      return sku
        ? { nome: sku, origem: "sku" }
        : { nome: "Variação sem nome", origem: "vazio" };
    }
    var fam = String(familyName || "").trim();
    if (fam && base.length > fam.length &&
        base.slice(0, fam.length).toLowerCase() === fam.toLowerCase()) {
      // Separadores que o vendedor costuma pôr entre o nome do produto e a
      // variação ("Camiseta - Azul P"): saem do começo do sufixo para o rótulo
      // não abrir com pontuação solta.
      var sufixo = base.slice(fam.length).replace(/^[\s\-–—,:;/|]+/, "").trim();
      if (sufixo) return { nome: sufixo, origem: "sufixo" };
    }
    return { nome: base, origem: "titulo" };
  }

  // Bloco de uma variação: nome amigável em destaque, MLBU como legenda, e os
  // MLBs logo abaixo — a leitura da listagem oficial do ML.
  //
  // O nível é SUBTÍTULO, não entidade: não tem handler, não expande, não abre
  // nada e não é foco de teclado. O que se opera continua sendo o anúncio (a
  // linha abaixo) e o agrupador (a linha acima). O user_product_id aparece
  // como texto porque é o endereço do produto físico no ML — mas em tamanho de
  // legenda, nunca como manchete do nível.
  function variacaoHtml(up, familia) {
    var itens = ordenarFilhos(up.itens || []);
    var base = tituloDaVariacao(itens);
    var v = nomeVariacao(itens, familia && familia.family_name);

    var html = '<div class="am-variacao" data-user-product="' +
      escapeAttr(up.user_product_id) + '" data-nome-origem="' + v.origem + '">' +
      '<div class="am-variacao__head">' +
        '<span class="am-variacao__nome">' + escapeHtml(v.nome) + "</span>" +
        '<span class="am-variacao__id vf-mono" title="User Product — o produto físico do Mercado Livre que reúne estas condições de venda">' +
          escapeHtml(up.user_product_id) + "</span>" +
      "</div>";

    itens.forEach(function (item, i) {
      html += rowMlbCompactaHtml(item, {
        irma: i > 0,
        // O título só aparece na linha quando DIFERE do que nomeou a variação.
        // No caso normal ele seria a terceira repetição da mesma frase (linha
        // do agrupador, cabeçalho da variação, linha do anúncio) e o que
        // distingue os irmãos é a condição comercial e o preço. Quando difere,
        // aparece — é comparação de dado, não suposição.
        tituloProprio: (item.titulo || "") !== base,
      });
    });
    return html + "</div>";
  }

  // A linha do MLB dentro do agrupador — hoje filha DIRETA dele. Não reusa
  // rowAnuncioHtml() (a linha da lista é mais alta, com badges e medidor), mas
  // ocupa EXATAMENTE as mesmas 10 colunas: a expansão é a continuação da
  // tabela, não uma tabela própria. Enquanto ela era uma árvore separada tinha
  // grade própria, e preço/estoque caíam em colunas que não eram as do
  // cabeçalho. O recuo sai de padding, nunca de uma coluna extra.
  //
  // A condição comercial entra DENTRO da célula de identificação, junto do
  // MLB — não numa coluna nova. Uma nona coluna desalinharia a expansão do
  // cabeçalho, que é justamente o que a unificação da tabela consertou.
  //
  // O que se reusa de verdade: o modelo de dados (/familias/:familyId devolve
  // os mesmos campos) e o handler abrirDetalhe().
  function rowMlbCompactaHtml(a, opcoes) {
    var op = opcoes || {};
    var st = statusInfo(a.status);
    var img = a.thumbnail
      ? '<img src="' + escapeHtml(a.thumbnail) + '" alt="" loading="lazy" />'
      : iconeImagemSvg();
    var sku = a.sku
      ? '<span class="vf-mono">' + escapeHtml(a.sku) + "</span>"
      : '<span class="vf-mono am-row__sem-sku">sem SKU</span>';
    var linkMl = a.permalink
      ? '<a class="am-row__link" href="' + escapeHtml(a.permalink) + '" target="_blank" rel="noopener" ' +
        'aria-label="Abrir ' + escapeAttr(a.titulo || a.item_id) + ' no Mercado Livre" title="Abrir no Mercado Livre">' +
        iconeExternoSvg() + "</a>"
      : "";
    // Score em número, não no medidor semicircular: o medidor tem altura
    // própria e engordaria a linha filha até a altura da linha-mãe.
    var score = a.score_venforce === null || a.score_venforce === undefined
      ? '<span class="am-mlb__score">—</span>'
      : '<span class="am-mlb__score ' + scoreClasse(a.score_venforce) + '" title="' +
        escapeAttr(scoreLegenda(a.score_venforce)) + '">' + a.score_venforce + "</span>";

    var cond = condicaoComercial(a);
    var condHtml = cond
      ? '<span class="am-mlb__cond">' + escapeHtml(cond) + "</span>"
      : "";
    // Título na linha só quando ele NÃO é o que já nomeou a variação logo
    // acima (ver variacaoHtml): aí o que sobra — MLB, condição comercial e
    // preço — é exatamente o que diferencia dois anúncios do mesmo produto.
    var tituloHtml = op.tituloProprio
      ? '<span class="am-mlb__titulo">' + escapeHtml(a.titulo || "(sem título)") + "</span>"
      : "";

    return '<div class="am-mlb' + (op.irma ? " am-mlb--irma" : "") +
      '" data-item="' + escapeAttr(a.item_id) + '" tabindex="0" role="button" ' +
      'aria-label="Ver detalhes de ' +
      escapeAttr((a.titulo || a.item_id) + (cond ? " — " + cond : "")) + '">' +
      '<span class="am-mlb__thumb" aria-hidden="true">' + img + "</span>" +
      '<span class="am-mlb__main">' +
        tituloHtml +
        '<span class="am-mlb__ids"><span class="vf-mono">' + escapeHtml(a.item_id) + "</span>" +
          condHtml + sku + "</span>" +
      "</span>" +
      '<span class="vf-status ' + st.classe + '">' + st.label + "</span>" +
      precoCelulaHtml(a, "am-mlb__preco") +
      celulaEstoqueHtml(a, "am-mlb__num") +
      '<span class="am-mlb__num">' + (a.vendidos != null ? a.vendidos : "—") + "</span>" +
      metricas7dCelulaHtml(a.item_id) +
      margemCelulaHtml(a.item_id) +
      score +
      '<span class="am-mlb__acao">' + linkMl + "</span>" +
    "</div>";
  }

  // ===========================================================================
  // MÉTRICAS ÚLT. 7 DIAS + MARGEM — enriquecimento AO VIVO e ASSÍNCRONO
  //
  // Duas colunas novas, GET /anuncios-meli/performance. Nunca bloqueiam a
  // abertura da página nem a expansão de um agrupador: a linha nasce com a
  // célula em "carregando…" e carregarPerformance() a resolve depois, só
  // para os item_id que estão de fato visíveis — nunca um recorte decidido
  // aqui, sempre a lista exata que o render acabou de montar.
  //
  // AM.state.performanceCache é o cache de sessão (por item_id, nunca
  // persistido): reabrir uma família já expandida antes, ou repintar uma
  // linha depois de editar o estoque, lê daqui — nenhuma das duas gasta uma
  // chamada nova ao Mercado Livre/Motor de Margem.
  //
  // Margem é coluna PRÓPRIA, separada das métricas de tráfego/venda — nunca
  // misturada na mesma célula. Só existe por MLB: a linha do agrupador
  // mostra "—" fixo (ver rowGrupoHtml), mesmo depois de expandida.
  // ===========================================================================

  function formatarInteiroOuTraco(v) {
    if (v === null || v === undefined) return "—";
    return Number(v).toLocaleString("pt-BR");
  }

  function formatarPercentualCompacto(v) {
    if (v === null || v === undefined) return "—";
    return Number(v).toFixed(1).replace(".", ",") + "%";
  }

  function metricas7dConteudoHtml(m) {
    if (!m) return '<span class="am-metricas7d__linha am-metricas7d__vazio">—</span>';
    var conv = m.conversao == null ? "" : " · " + formatarPercentualCompacto(m.conversao);
    return (
      '<span class="am-metricas7d__linha" title="Visualizações nos últimos 7 dias">👁 ' +
        formatarInteiroOuTraco(m.views) + "</span>" +
      '<span class="am-metricas7d__linha" title="Vendas (e conversão) nos últimos 7 dias">🛒 ' +
        formatarInteiroOuTraco(m.vendas) + conv + "</span>"
    );
  }

  function metricas7dCelulaHtml(itemId) {
    var cache = AM.state.performanceCache[itemId];
    var pronto = cache && cache.temMetricas;
    var conteudo = pronto
      ? metricas7dConteudoHtml(cache.metricas7d)
      : '<span class="am-metricas7d__linha am-metricas7d__vazio">carregando…</span>';
    return '<span class="am-metricas7d' + (pronto ? "" : " am-metricas7d--carregando") +
      '" data-metricas-item="' + escapeAttr(itemId) + '">' + conteudo + "</span>";
  }

  // Soma das métricas 7d dos FILHOS — só do agrupador, nunca da margem (ver
  // rowGrupoHtml). Mesma régua "—" do backend: sem views não há conversão,
  // vendas ausente (chamada falhou) nunca vira 0 fingido.
  function agregarConversao(vendas, views) {
    if (views === null || views === undefined || views === 0) return null;
    if (vendas === null || vendas === undefined) return null;
    var pct = (vendas / views) * 100;
    if (!isFinite(pct)) return null;
    return Math.round(pct * 10) / 10;
  }

  // null enquanto os filhos ainda são desconhecidos (família sem detalhe em
  // cache — o pré-carregamento em background ainda não respondeu) OU
  // enquanto algum filho ainda não tem metricas7d — um agregado parcial
  // enganaria tanto quanto uma margem em média simples. Só sai quando TODOS
  // os filhos já responderam (sucesso ou falha, tanto faz — o que importa é
  // não estar mais em voo).
  function metricas7dAgregadoDoGrupo(familyId) {
    var familia = AM.state.familyCache[familyId];
    if (!familia) return null;
    var ids = [];
    (familia.user_products || []).forEach(function (up) {
      (up.itens || []).forEach(function (item) { ids.push(item.item_id); });
    });
    if (!ids.length) return null;
    if (!ids.every(function (id) {
      var c = AM.state.performanceCache[id];
      return !!(c && c.temMetricas);
    })) return null;

    var somaViews = 0, temViews = false;
    var somaVendas = 0, temVendas = true;
    ids.forEach(function (id) {
      var m = AM.state.performanceCache[id].metricas7d;
      if (m && m.views != null) { somaViews += m.views; temViews = true; }
      if (m && m.vendas != null) somaVendas += m.vendas; else temVendas = false;
    });

    var views = temViews ? somaViews : null;
    var vendas = temVendas ? somaVendas : null;
    return { views: views, vendas: vendas, conversao: agregarConversao(vendas, views) };
  }

  function metricas7dAgregadoCelulaHtml(familyId) {
    var agregado = metricas7dAgregadoDoGrupo(familyId);
    if (agregado) {
      return '<span class="am-metricas7d" title="Soma dos últimos 7 dias de todas as variações">' +
        metricas7dConteudoHtml(agregado) + "</span>";
    }
    // Ainda não: o pré-carregamento em background falhou de verdade (mostra
    // "—", igual à falha de qualquer célula de item) ou simplesmente ainda
    // está em voo (mostra "carregando…", nunca um "—" definitivo — a soma
    // chega sozinha quando a resposta voltar).
    if (AM.state.familyFetchFalhou[familyId]) {
      return '<span class="am-metricas7d am-metricas7d--indisponivel" title="Não foi possível calcular a soma agora">—</span>';
    }
    return '<span class="am-metricas7d am-metricas7d--carregando" title="Calculando a soma dos últimos 7 dias…">' +
      '<span class="am-metricas7d__linha am-metricas7d__vazio">carregando…</span>' +
    "</span>";
  }

  // Cor por STATUS real do Motor de Margem (marginStatus.js) — nunca um
  // limiar próprio reinventado aqui sobre o percentual.
  var MARGEM_CLASSE = {
    HEALTHY: "is-success",
    LOW_MARGIN: "is-warning",
    SUSPECT_DATA: "is-warning",
    RECONCILING: "is-info",
    LOSS: "is-danger",
    UNVALIDATED: "is-neutral",
  };

  // Selo discreto de explicação — mesmo componente vf-info/vf-info-dot da
  // Fundação (o ROAS em Ads usa o mesmo), não uma tooltip nova inventada.
  function infoDotHtml(texto) {
    return '<span class="vf-info am-margem__info">' +
      '<button type="button" class="vf-info-dot" aria-label="Sobre esta margem"></button>' +
      '<span class="vf-info__tip" role="tooltip">' + escapeHtml(texto) + "</span>" +
    "</span>";
  }

  function margemConteudoHtml(m, margemIndisponivel) {
    // Nível de CONTEXTO (Base não vinculada, múltiplas bases, grant caído):
    // mesma mensagem que o Motor já gera — nunca um "Sem custo na Base"
    // genérico inventado aqui.
    if (margemIndisponivel) {
      return '<span class="am-margem__estado" title="' + escapeAttr(margemIndisponivel.mensagem || "") + '">' +
        escapeHtml(margemIndisponivel.mensagem || "Indisponível") + "</span>";
    }
    if (!m) return '<span class="am-margem__vazio">—</span>';

    var classe = MARGEM_CLASSE[m.status] || "is-neutral";
    // Precedência REALIZADA > PROJETADA — mesma regra que o próprio Motor já
    // usa para ordenar (motorMargemService.valorOrdenacao).
    var origemRotulo = m.origem === "realized" ? "Realizada" : "Projetada";
    var tip = "Calculada pelo Motor de Margem — margem " + origemRotulo.toLowerCase() + ".";
    // Preço alvo é aditivo à explicação da margem (mesmo infoDot) — nunca um
    // segundo cálculo aqui, só o texto do que o Motor já resolveu em
    // item.margin.target (ver montarMapaMargem/computeTargetPrice).
    if (m.precoAlvo != null) {
      tip += " Preço alvo p/ bater a margem configurada: " + formatMoeda(m.precoAlvo) + ".";
    }

    if (m.marginPercent != null) {
      return '<span class="am-margem__valor ' + classe + '">' + formatarPercentualCompacto(m.marginPercent) + "</span>" +
        '<span class="am-margem__origem">' + origemRotulo + "</span>" +
        infoDotHtml(tip);
    }
    // Sem número (ex.: UNVALIDATED) — rótulo REAL do Motor, com a razão real
    // (statusReasons[0], já gerada por classifyStatus) como tooltip.
    var motivo = (m.statusReasons && m.statusReasons[0]) || "";
    return '<span class="am-margem__estado ' + classe + '" title="' + escapeAttr(motivo) + '">' +
      escapeHtml(m.statusLabel || "Indisponível") + "</span>" +
      infoDotHtml(tip);
  }

  function margemCelulaHtml(itemId) {
    var cache = AM.state.performanceCache[itemId];
    var pronto = cache && cache.temMargem;
    var conteudo = pronto
      ? margemConteudoHtml(cache.margem, cache.margemIndisponivel)
      : '<span class="am-margem__vazio">carregando…</span>';
    return '<span class="am-margem' + (pronto ? "" : " am-margem--carregando") +
      '" data-margem-item="' + escapeAttr(itemId) + '">' + conteudo + "</span>";
  }

  // Preço da linha — alimentado pelo MESMO GET /anuncios-meli/performance da
  // margem (margem[itemId].precoAtual, `item.pricing.current` do Motor: a
  // cotação ao vivo do sale_price, não recalculada aqui). Enquanto a
  // performance não chegou, ou quando o Motor não tem evidência de preço
  // (`precoAtual == null` — nunca 0), mostra o preço já sincronizado
  // (`a.preco`) que a listagem sempre teve — o Motor só substitui quando
  // tem algo melhor para mostrar, nunca esvazia o preço da tela.
  function precoCelulaHtml(a, classe) {
    var cache = AM.state.performanceCache[a.item_id];
    var m = cache && cache.margem;
    var preco = m && m.precoAtual != null ? m.precoAtual : a.preco;
    return '<span class="' + classe + '" data-preco-item="' + escapeAttr(a.item_id) + '">' +
      formatMoeda(preco, a.moeda) + "</span>";
  }

  // Busca metricas7d, margem e/ou composição da margem para os item_id
  // pedidos — só o aspecto que FALTA em cada um (AM.state.performanceCache
  // guarda os três de forma independente: `temMetricas`/`temMargem`/
  // `temComposicao`). Isso é o que permite ao pré-carregamento em
  // background pedir só metricas7d dos filhos ocultos (opcoes.incluirMargem:
  // false), a expansão da família pedir só a margem que falta (sem repetir
  // a métrica que o pré-carregamento já trouxe), e o modal de detalhe pedir
  // só a composição (sem repetir margem/métricas já conhecidas da lista).
  //
  // `metricasEmVoo`/`margemEmVoo`/`composicaoEmVoo` (por item_id) dedupem
  // chamadas concorrentes para o MESMO item/aspecto: o pré-carregamento em
  // background, um clique do operador na mesma família, e abrir o modal de
  // um item já em voo nunca disparam duas requisições.
  //
  // Nunca bloqueia quem chamou: é sempre disparada DEPOIS que a linha (ou o
  // modal) já está pintada na tela. Devolve a Promise da leitura (resolvida
  // de imediato quando não há nada pendente — tudo já em cache/em voo):
  // quem precisa saber "os filhos desta família já são conhecidos" (ver
  // repintarLinhaDoGrupo) ou "a composição já chegou" (ver
  // garantirComposicaoDoItem) encadeia nela em vez de reimplementar a espera.
  function carregarPerformance(itemIds, opcoes) {
    if (!AM.clienteAtual) return Promise.resolve();
    var incluirMargem = !opcoes || opcoes.incluirMargem !== false;
    // Composição é OPT-IN (ao contrário de métricas/margem): só o modal de
    // detalhe pede, explicitamente, ao abrir a seção "Composição da margem".
    var incluirComposicao = !!(opcoes && opcoes.incluirComposicao);

    var vistos = {};
    var pendentesMetricas = [];
    var pendentesMargem = [];
    var pendentesComposicao = [];
    (itemIds || []).forEach(function (id) {
      if (!id || vistos[id]) return;
      vistos[id] = true;
      var cache = AM.state.performanceCache[id];
      if ((!cache || !cache.temMetricas) && !AM.state.metricasEmVoo[id]) pendentesMetricas.push(id);
      if (incluirMargem && (!cache || !cache.temMargem) && !AM.state.margemEmVoo[id]) pendentesMargem.push(id);
      if (incluirComposicao && (!cache || !cache.temComposicao) && !AM.state.composicaoEmVoo[id]) pendentesComposicao.push(id);
    });
    if (!pendentesMetricas.length && !pendentesMargem.length && !pendentesComposicao.length) return Promise.resolve();

    var idsUniao = [];
    var vistosUniao = {};
    pendentesMetricas.concat(pendentesMargem, pendentesComposicao).forEach(function (id) {
      if (vistosUniao[id]) return;
      vistosUniao[id] = true;
      idsUniao.push(id);
    });

    var pendentesMetricasSet = {};
    pendentesMetricas.forEach(function (id) { pendentesMetricasSet[id] = true; AM.state.metricasEmVoo[id] = true; });
    var pendentesMargemSet = {};
    pendentesMargem.forEach(function (id) { pendentesMargemSet[id] = true; AM.state.margemEmVoo[id] = true; });
    var pendentesComposicaoSet = {};
    pendentesComposicao.forEach(function (id) { pendentesComposicaoSet[id] = true; AM.state.composicaoEmVoo[id] = true; });

    var qs = "clienteSlug=" + encodeURIComponent(AM.clienteAtual.slug) +
      "&itemIds=" + encodeURIComponent(idsUniao.join(",")) +
      "&incluirMetricas=" + (pendentesMetricas.length ? "1" : "0") +
      "&incluirMargem=" + (pendentesMargem.length || pendentesComposicao.length ? "1" : "0") +
      "&incluirComposicao=" + (pendentesComposicao.length ? "1" : "0");
    if (AM.contaMlId) qs += "&clienteContaId=" + encodeURIComponent(AM.contaMlId);

    return api("/anuncios-meli/performance?" + qs).then(function (r) {
      pendentesMetricas.forEach(function (id) { delete AM.state.metricasEmVoo[id]; });
      pendentesMargem.forEach(function (id) { delete AM.state.margemEmVoo[id]; });
      pendentesComposicao.forEach(function (id) { delete AM.state.composicaoEmVoo[id]; });

      var dados = r.data;
      if (dados && dados.ok) {
        idsUniao.forEach(function (id) {
          var atual = AM.state.performanceCache[id] || {
            metricas7d: null, temMetricas: false,
            margem: null, margemIndisponivel: null, temMargem: false,
            composicao: null, temComposicao: false,
          };
          if (pendentesMetricasSet[id]) {
            atual.metricas7d = (dados.metricas7d && dados.metricas7d[id]) || null;
            atual.temMetricas = true;
          }
          // A composição pediu margem "de carona" (qs acima): se ISSO foi
          // quem ligou incluirMargem=1 para este id (pendentesMargemSet não
          // tinha o id, mas pendentesComposicaoSet tem), a margem também
          // chega nesta resposta e precisa ser gravada — senão o badge da
          // seção ficaria "carregando" para sempre.
          if (pendentesMargemSet[id] || pendentesComposicaoSet[id]) {
            atual.margem = (dados.margem && dados.margem[id]) || null;
            atual.margemIndisponivel = dados.margemIndisponivel || null;
            atual.temMargem = true;
          }
          if (pendentesComposicaoSet[id]) {
            atual.composicao = (dados.composicao && dados.composicao[id]) || null;
            atual.temComposicao = true;
          }
          AM.state.performanceCache[id] = atual;
        });
      }
      // Falha da chamada inteira: nada é marcado como resolvido (permite
      // uma tentativa futura), e as células pedidas só repintam com o que
      // JÁ está no cache — nunca apagam um aspecto que outra chamada
      // independente já tinha trazido com sucesso.
      pintarPerformanceEmCelulas(idsUniao);
    });
  }

  // Ponto único do modal de detalhe para buscar a composição da margem de
  // UM item — chamado só quando o operador abre a seção "Composição da
  // margem" (nunca ao abrir o modal). Força incluirMargem:true junto: o
  // item pode nunca ter passado pela lista (aberto direto, ou a lista não
  // tinha buscado a margem dele ainda), então a composição não pode supor
  // que a margem já está em cache. O dedupe de carregarPerformance garante
  // que isso não gasta chamada nova quando já está tudo pronto.
  function garantirComposicaoDoItem(itemId) {
    return carregarPerformance([itemId], { incluirMargem: true, incluirComposicao: true });
  }

  // Repinta SÓ a linha-mãe (nunca o painel, nunca renderCatalogo — fechar
  // todos os agrupadores abertos seria o mesmo bug que atualizarAgregadosDoGrupo
  // já evita). metricas7dAgregadoCelulaHtml lê o agregado do cache — não há
  // estado próprio para sincronizar, só um novo render a partir da MESMA
  // fonte de sempre (AM.state.familyCache + AM.state.performanceCache).
  function repintarLinhaDoGrupo(familyId) {
    var linha = document.querySelector('.am-row--grupo[data-familia="' + familyId + '"]');
    if (!linha) return;
    for (var i = 0; i < AM.anuncios.length; i++) {
      var g = AM.anuncios[i];
      if (g.tipo !== "familia" || String(g.family_id) !== String(familyId)) continue;
      var nova = document.createElement("div");
      nova.innerHTML = rowGrupoHtml(g, i);
      var substituta = nova.firstElementChild;
      var aberta = linha.getAttribute("aria-expanded") === "true";
      substituta.setAttribute("aria-expanded", aberta ? "true" : "false");
      if (aberta) substituta.classList.add("is-aberta");
      linha.parentNode.replaceChild(substituta, linha);
      substituta.addEventListener("click", function () { alternarGrupo(substituta); });
      substituta.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); alternarGrupo(substituta); }
      });
      return;
    }
  }

  // Só pinta células que ainda existem no DOM (trocar de página/cliente no
  // meio do caminho não pinta a tela errada — o item simplesmente não é
  // mais encontrado) e só as que fazem parte DESTE lote (`alvo`), nunca
  // sobrescrevendo a célula de um item de outra leitura em andamento.
  function pintarPerformanceEmCelulas(ids) {
    var alvo = {};
    ids.forEach(function (id) { alvo[id] = true; });

    document.querySelectorAll(".am-metricas7d[data-metricas-item]").forEach(function (cel) {
      var id = cel.getAttribute("data-metricas-item");
      if (!alvo[id]) return;
      var cache = AM.state.performanceCache[id];
      cel.classList.remove("am-metricas7d--carregando");
      cel.innerHTML = metricas7dConteudoHtml(cache ? cache.metricas7d : null);
    });
    document.querySelectorAll(".am-margem[data-margem-item]").forEach(function (cel) {
      var id = cel.getAttribute("data-margem-item");
      if (!alvo[id]) return;
      var cache = AM.state.performanceCache[id];
      cel.classList.remove("am-margem--carregando");
      cel.innerHTML = margemConteudoHtml(cache ? cache.margem : null, cache ? cache.margemIndisponivel : null);
    });
    // Preço: só troca a célula quando o Motor realmente trouxe precoAtual —
    // sem evidência (null) a célula fica exatamente como nasceu, mostrando
    // o preço sincronizado (a.preco). Nunca zera nem apaga o que já tinha.
    document.querySelectorAll("[data-preco-item]").forEach(function (cel) {
      var id = cel.getAttribute("data-preco-item");
      if (!alvo[id]) return;
      var cache = AM.state.performanceCache[id];
      var m = cache && cache.margem;
      if (m && m.precoAtual != null) {
        cel.textContent = formatMoeda(m.precoAtual);
      }
    });
  }

  // ===========================================================================
  // ESTOQUE EDITÁVEL NA LINHA DO MLB
  //
  // A edição parte de um anúncio, mas o estoque NÃO é do anúncio: no modelo de
  // User Products o ML replica `available_quantity` em todos os itens do mesmo
  // user_product_id (documentacao_api_meli/user-products.md). Então salvar a
  // partir do Clássico muda o Premium da mesma variação junto — e a tela mostra
  // isso na hora, nos dois, porque é o que o ML garante. Quem faz a escrita é
  // PATCH /anuncios-meli/:itemId/estoque -> PUT /items { available_quantity };
  // os irmãos afetados voltam na resposta (itens_sincronizados), nunca são
  // deduzidos aqui.
  //
  // A célula ocupa a MESMA coluna de estoque de sempre. Nenhuma coluna nova:
  // a grade --am-cols é compartilhada com o cabeçalho e com a linha-mãe.
  // ===========================================================================

  function botaoEstoqueHtml(rotulo) {
    return '<button type="button" class="am-estoque__btn" ' +
      'title="Editar o estoque desta variação no Mercado Livre" ' +
      'aria-label="Estoque ' + escapeAttr(rotulo) + ' — editar no Mercado Livre">' +
      escapeHtml(rotulo) + "</button>";
  }

  // `classeColuna` é a classe de coluna do nível que está desenhando a linha
  // (.am-mlb__num no filho, .am-row__num no anúncio individual): a célula se
  // comporta igual nos dois, mas continua vestida como a coluna do seu nível.
  // `.am-estoque` é o que marca "esta célula é editável" — é por ela que o
  // bind acha as células e que os handlers de linha sabem não abrir o modal.
  function celulaEstoqueHtml(a, classeColuna) {
    var tem = a.estoque != null;
    return '<span class="' + (classeColuna || "am-mlb__num") + ' am-estoque" data-estoque-item="' +
      escapeAttr(a.item_id) + '" data-estoque-valor="' +
      escapeAttr(tem ? a.estoque : "") + '">' +
      botaoEstoqueHtml(tem ? String(a.estoque) : "—") + "</span>";
  }

  function bindEstoqueEditavel(raiz) {
    raiz.querySelectorAll(".am-estoque").forEach(function (cel) {
      cel.addEventListener("click", function (e) {
        // A célula fica DENTRO da linha, que abre o modal. O clique aqui é
        // sempre da célula — nunca escala para a linha.
        e.stopPropagation();
        if (e.target.closest(".am-estoque__btn")) abrirEditorEstoque(cel);
      });
    });
  }

  // Estados da célula, todos nela mesma: leitura -> edição -> salvando ->
  // leitura. O `data-estoque-valor` é a memória do valor de leitura, e é o que
  // o Esc restaura.
  function pintarEstoqueLeitura(cel) {
    var bruto = cel.getAttribute("data-estoque-valor");
    cel.removeAttribute("data-estoque-editando");
    cel.classList.remove("is-editando", "is-salvando");
    cel.innerHTML = botaoEstoqueHtml(bruto === "" || bruto === null ? "—" : bruto);
  }

  function abrirEditorEstoque(cel) {
    if (cel.getAttribute("data-estoque-editando") === "1") return;
    if (cel.classList.contains("is-salvando")) return;
    var atual = cel.getAttribute("data-estoque-valor") || "";
    cel.setAttribute("data-estoque-editando", "1");
    cel.classList.add("is-editando");
    // O campo é `number` com min 0 e sem casas: 0 é valor válido e
    // significativo (o ML pausa o anúncio por falta de estoque), então nada
    // aqui pode tratar 0 como "vazio".
    cel.innerHTML = '<input type="number" class="am-estoque__input" min="0" step="1" ' +
      'inputmode="numeric" value="' + escapeAttr(atual) + '" ' +
      'title="Enter salva no Mercado Livre, Esc cancela" ' +
      'aria-label="Estoque em unidades. Enter salva no Mercado Livre, Esc cancela." />';
    var input = cel.querySelector(".am-estoque__input");
    if (!input) return;
    input.focus();
    input.select();

    input.addEventListener("keydown", function (e) {
      // stopPropagation PRIMEIRO, antes de qualquer coisa que mexa no DOM.
      //
      // A linha é role="button" e trata Enter como "abrir o modal"; o guard
      // dela ignora eventos vindos da célula via `e.target.closest('.am-estoque')`.
      // Só que salvar/cancelar substitui o innerHTML da célula, o que
      // DESLIGA o input do documento — e um nó solto não tem `closest` que
      // chegue à célula. O guard passava a falhar e o Enter de salvar abria o
      // modal por cima. Barrar a subida antes de mexer no DOM é o que fecha
      // isso, e não depende de ordem de listener.
      e.stopPropagation();
      if (e.key === "Enter") {
        e.preventDefault();
        salvarEstoque(cel, input.value);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        pintarEstoqueLeitura(cel);
      }
    });

    // Sair do campo CANCELA — nunca salva. Escrever num anúncio real por
    // distração (um clique fora, um Tab) seria efeito colateral inaceitável
    // numa tela que lista centenas de anúncios. Salvar é sempre Enter.
    input.addEventListener("blur", function () {
      if (cel.classList.contains("is-salvando")) return;
      pintarEstoqueLeitura(cel);
    });
  }

  function salvarEstoque(cel, bruto) {
    var itemId = cel.getAttribute("data-estoque-item");
    var anterior = cel.getAttribute("data-estoque-valor") || "";
    var texto = String(bruto == null ? "" : bruto).trim();

    // Nada mudou: não gasta uma escrita no Mercado Livre.
    if (texto === anterior) { pintarEstoqueLeitura(cel); return; }
    if (!/^\d+$/.test(texto)) {
      toast("O estoque precisa ser um número inteiro igual ou maior que zero.", "is-danger");
      pintarEstoqueLeitura(cel);
      return;
    }

    cel.classList.remove("is-editando");
    cel.classList.add("is-salvando");
    cel.removeAttribute("data-estoque-editando");
    cel.innerHTML = '<span class="am-estoque__salvando" aria-live="polite">salvando…</span>';

    var corpo = { clienteSlug: AM.clienteAtual.slug, estoque: Number(texto) };
    if (AM.contaMlId) corpo.clienteContaId = AM.contaMlId;

    api("/anuncios-meli/" + encodeURIComponent(itemId) + "/estoque", {
      method: "PATCH",
      body: corpo,
    }).then(function (r) {
      var dados = r.data || {};
      if (!dados.ok) {
        // O snapshot não mudou no servidor, então a célula volta ao valor de
        // antes. A recusa do ML é mostrada como ela veio — não é traduzida
        // nem resumida em "erro ao salvar".
        cel.classList.remove("is-salvando");
        pintarEstoqueLeitura(cel);
        toast(dados.motivo || "Não foi possível salvar o estoque.", "is-danger");
        return;
      }
      cel.classList.remove("is-salvando");
      aplicarEstoqueConfirmado(cel, itemId, dados);
    });
  }

  // Reflete na tela o que o ML CONFIRMOU: o item editado, os irmãos do mesmo
  // MLBU (regra do ML, lista vinda do SERVIDOR — nunca deduzida aqui) e o
  // estoque agregado do agrupador. Sem reconsultar a lista, que colapsaria as
  // expansões e tiraria o operador do lugar onde ele estava.
  function aplicarEstoqueConfirmado(cel, itemId, dados) {
    var afetados = {};
    afetados[itemId] = true;
    (dados.itens_sincronizados || []).forEach(function (id) { afetados[id] = true; });

    var painel = cel.closest(".am-grupo-painel");
    var linha = painel && painel.previousElementSibling;
    var familyId = linha && linha.getAttribute("data-familia");
    var familia = familyId ? AM.state.familyCache[familyId] : null;

    if (familia) {
      // Dentro de um agrupador: o cache é a fonte do painel e do agregado, e
      // por isso é ele que tem de mudar primeiro — colapsar e reabrir lê o
      // cache, não a rede.
      (familia.user_products || []).forEach(function (up) {
        (up.itens || []).forEach(function (item) {
          if (!afetados[item.item_id]) return;
          item.estoque = dados.estoque;
          // Status só do item editado, e só o que o servidor devolveu: o ML
          // pausa/reativa por falta de estoque, mas `status` NÃO está na lista
          // de campos que ele replica por User Product — supor a transição do
          // irmão seria inventar.
          if (item.item_id === itemId && dados.anuncio && dados.anuncio.status) {
            item.status = dados.anuncio.status;
          }
        });
      });
      renderFamiliaDetalhe(familia, painel);
      atualizarAgregadosDoGrupo(familyId, familia, linha);
    }

    // Linhas de anúncio individual da lista (tipo "item"): o estado da lista
    // também tem de acompanhar, senão uma troca de página repinta o número
    // velho. Um anúncio individual não tem irmão de variação na prática (a
    // relação UP:item ali é 1:1), mas se o servidor disser que tem, o que ele
    // disse é que vale.
    AM.anuncios.forEach(function (g) {
      if (g.tipo !== "item" || !afetados[g.item_id]) return;
      g.estoque = dados.estoque;
      g.estoque_total = dados.estoque;
      var statusNovo = g.item_id === itemId && dados.anuncio && dados.anuncio.status;
      if (!statusNovo || statusNovo === g.status) return;
      // O ML pausa o anúncio quando o estoque vai a zero (e reativa quando
      // volta): deixar a linha dizendo "Ativo" seria a tela mentindo sobre o
      // que acabou de acontecer. Repinta a linha inteira, no lugar.
      g.status = statusNovo;
      var alvo = document.querySelector('.am-row[data-item="' + g.item_id + '"]');
      if (!alvo) return;
      var caixa = document.createElement("div");
      caixa.innerHTML = rowAnuncioHtml(g);
      // Vincula com a linha ainda DENTRO da caixa temporária: os binds varrem
      // os descendentes da raiz, então passar o container da lista aqui
      // duplicaria os listeners de todas as outras linhas — e um clique
      // passaria a abrir o modal duas vezes. Listener sobrevive a mover o nó.
      bindLinhasAnuncio(caixa);
      bindEstoqueEditavel(caixa);
      alvo.parentNode.replaceChild(caixa.firstElementChild, alvo);
    });

    // Por último, qualquer célula ainda visível dos itens afetados que o
    // repinte acima não tenha alcançado (o irmão numa outra linha da lista, a
    // própria célula quando a edição partiu de um anúncio individual).
    pintarCelulasDeEstoque(afetados, dados.estoque);

    var irmaos = (dados.itens_sincronizados || []).length;
    toast(
      irmaos
        ? "Estoque atualizado no Mercado Livre — e nos outros " +
          plural(irmaos, "anúncio desta variação", "anúncios desta variação") + "."
        : "Estoque atualizado no Mercado Livre.",
      "is-success"
    );
  }

  function pintarCelulasDeEstoque(afetados, valor) {
    document.querySelectorAll(".am-estoque[data-estoque-item]").forEach(function (c) {
      if (!afetados[c.getAttribute("data-estoque-item")]) return;
      c.setAttribute("data-estoque-valor", String(valor));
      c.classList.remove("is-salvando");
      pintarEstoqueLeitura(c);
    });
  }

  // Recalcula os agregados da linha-mãe a partir do cache da família, pela
  // MESMA régua do banco:
  //
  //   estoque_total   = soma do estoque por User Product DISTINTO
  //                     (CTE estoque_por_up usa MAX(estoque) por UP, porque o
  //                     ML replica o valor entre os itens do UP — somar item a
  //                     item duplicaria);
  //   status_contagem = contagem por status sobre TODOS os itens do grupo.
  //
  // É legítimo recalcular aqui porque o detalhe da família cobre exatamente o
  // mesmo conjunto que a linha agrega: os agregados da listagem são do grupo
  // inteiro e NÃO sofrem o filtro/busca (ver meliFamiliaService, CTE `grupos`
  // vs `selecionados`).
  function atualizarAgregadosDoGrupo(familyId, familia, linha) {
    var estoqueTotal = 0;
    var contagem = { ativos: 0, pausados: 0, encerrados: 0 };
    var totalItens = 0;

    (familia.user_products || []).forEach(function (up) {
      var maior = null;
      (up.itens || []).forEach(function (item) {
        totalItens++;
        if (item.status === "active") contagem.ativos++;
        else if (item.status === "paused") contagem.pausados++;
        else if (item.status === "closed") contagem.encerrados++;
        if (item.estoque != null && (maior === null || item.estoque > maior)) maior = item.estoque;
      });
      if (maior !== null) estoqueTotal += maior;
    });

    for (var i = 0; i < AM.anuncios.length; i++) {
      var g = AM.anuncios[i];
      if (g.tipo !== "familia" || String(g.family_id) !== String(familyId)) continue;
      g.estoque_total = estoqueTotal;
      g.status_contagem = contagem;
      g.total_itens = totalItens;
      if (linha) {
        // Repinta só a linha-mãe, no lugar: renderCatalogo() inteiro fecharia
        // todos os painéis abertos.
        var nova = document.createElement("div");
        nova.innerHTML = rowGrupoHtml(g, i);
        var substituta = nova.firstElementChild;
        var aberta = linha.getAttribute("aria-expanded") === "true";
        substituta.setAttribute("aria-expanded", aberta ? "true" : "false");
        if (aberta) substituta.classList.add("is-aberta");
        linha.parentNode.replaceChild(substituta, linha);
        substituta.addEventListener("click", function () { alternarGrupo(substituta); });
        substituta.addEventListener("keydown", function (e) {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); alternarGrupo(substituta); }
        });
      }
      break;
    }
  }

  // Mesmo contrato de interação da linha do catálogo: clique ou Enter/Espaço
  // abrem o modal de sempre; o link externo continua sendo do navegador.
  function bindLinhasMlb(raiz) {
    raiz.querySelectorAll(".am-mlb[data-item]").forEach(function (row) {
      function abrir() { abrirDetalhe(row.getAttribute("data-item"), row); }
      // Duas exceções, e o motivo é o mesmo: são controles PRÓPRIOS dentro da
      // linha. O link externo é do navegador; a célula de estoque edita no
      // lugar. Nenhum dos dois pode abrir o modal por cima do que o operador
      // estava fazendo.
      function ehControleProprio(e) {
        return !!(e.target.closest(".am-row__link") || e.target.closest(".am-estoque"));
      }
      row.addEventListener("click", function (e) {
        if (ehControleProprio(e)) return;
        abrir();
      });
      row.addEventListener("keydown", function (e) {
        if (ehControleProprio(e)) return;
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); abrir(); }
      });
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
    if (ehCatalogoOficial(a)) badges += '<span class="vf-tag is-primary">Catálogo</span>';
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
      precoCelulaHtml(a, "am-row__preco") +
      // O anúncio individual também é um MLB, e o estoque dele se edita aqui
      // pelo mesmo caminho da linha filha. A linha do AGRUPADOR não tem esta
      // célula: o estoque dela é soma de variações, não um número que exista
      // no Mercado Livre para ser escrito (ver rowGrupoHtml).
      celulaEstoqueHtml(a, "am-row__num") +
      '<span class="am-row__num">' + (a.vendidos != null ? a.vendidos : "—") + "</span>" +
      metricas7dCelulaHtml(a.item_id) +
      margemCelulaHtml(a.item_id) +
      scoreGaugeHtml(a.score_venforce) +
      '<div class="am-row__acao">' + linkMl + "</div>" +
    "</div>";
  }

  // Uma implementação de paginação para as DUAS listas (anúncios e famílias).
  // `pag` é sempre { page, totalPaginas, total }; `prefixo` dá os ids dos
  // botões e `rotulo` o substantivo contado.
  function paginacaoHtml(pag, prefixo, rotulo) {
    var p = pag || { page: 1, totalPaginas: 1, total: 0 };
    var nome = rotulo || "anúncio";
    var aria = 'aria-label="Paginação de ' + nome + 's"';
    if (p.totalPaginas <= 1) {
      return '<nav class="vf-pagination am-paginacao" ' + aria + '><span class="vf-pagination__info">' +
        p.total + " " + nome + "(s)</span></nav>";
    }
    return '<nav class="vf-pagination am-paginacao" ' + aria + ">" +
      '<span class="vf-pagination__info">Página ' + p.page + " de " + p.totalPaginas + " · " + p.total + " " + nome + "s</span>" +
      '<div class="vf-pagination__actions">' +
      '<button type="button" class="vf-btn vf-btn--secondary vf-btn--sm" id="' + prefixo + '-prev"' + (p.page <= 1 ? " disabled" : "") + ">← Anterior</button>" +
      '<button type="button" class="vf-btn vf-btn--secondary vf-btn--sm" id="' + prefixo + '-next"' + (p.page >= p.totalPaginas ? " disabled" : "") + ">Próxima →</button></div>" +
      "</nav>";
  }

  function bindPaginacao(prefixo, pag, irPara) {
    var prev = el(prefixo + "-prev"), next = el(prefixo + "-next");
    if (prev) prev.addEventListener("click", function () {
      if (pag.page > 1) { irPara(pag.page - 1); window.scrollTo({ top: 0, behavior: "smooth" }); }
    });
    if (next) next.addEventListener("click", function () {
      if (pag.page < pag.totalPaginas) { irPara(pag.page + 1); window.scrollTo({ top: 0, behavior: "smooth" }); }
    });
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
      // Preço: escrita REAL no Mercado Livre (PATCH .../preco). `salvando`
      // trava contra clique duplo/Enter duplo e contra o campo virar
      // editável de novo durante a chamada.
      precoMargem: { salvando: false },
      // Custo do produto / Custos adicionais: overrides de SIMULAÇÃO — nunca
      // persistidos, nunca enviados ao Mercado Livre. `resultado` é a última
      // resposta de POST .../simular-margem; null enquanto nenhum dos dois
      // campos estiver com override ativo (a composição usa a margem REAL).
      simulacaoMargem: { custoProduto: null, custosAdicionais: null, resultado: null },
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

    var margemSecaoAtual = el("am-det-margem");
    var margemAberta = !!(margemSecaoAtual && margemSecaoAtual.open);

    var html =
      headHtml(a) +
      top2Html(a, pics, attrs) +
      fotosHtml(pics) +
      tituloEModeloHtml(a) +
      descricaoHtml() +
      fichaHtml(attrs) +
      margemComposicaoSecaoHtml(a, margemAberta);

    var scroll = el("am-det-scroll");
    scroll.innerHTML = html;
    bindCamposEditaveis();
    aplicarEstadosEdicao(); // já redesenha a barra de alterações
    bindMargemComposicao();
    bindMargemEditavel(el("am-det-margem-body"));
    bindPrecoEditavel(el("am-det-margem-body"));
    bindRestaurarSimulacaoMargem(el("am-det-margem-body"), a.item_id);
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
    // Bloqueio de edição é mais amplo que a tag visual — ver comentário em
    // ehCatalogoOficial/tituloTravadoPorCatalogo. A tag só acende com
    // catalog_listing===true; o título pode ficar travado sem ela (família).
    var catalogoTag = ehCatalogoOficial(a);
    var tituloTravado = tituloTravadoPorCatalogo(a);

    var thumb = a.thumbnail
      ? '<img src="' + escapeHtml(a.thumbnail) + '" alt="" loading="lazy" />'
      : icImagem(24);

    return '<div class="am-det-head">' +
      '<div class="am-det-head__thumb" aria-hidden="true">' + thumb + "</div>" +
      '<div class="am-det-head__main">' +
        '<div class="am-det-title" id="am-det-title-wrap">' +
          '<div class="am-det-title__row">' +
            '<input class="am-det-title__input" id="am-det-titulo" maxlength="60" size="56" ' +
              (tituloTravado ? 'readonly aria-readonly="true" ' : '') +
              'aria-label="Título do anúncio" value="' + escapeAttr(DET.rascunho.titulo) + '" />' +
            '<button type="button" class="am-det-revert" data-acao="reverter" data-campo="titulo" ' +
              'id="am-det-revert-titulo" title="Descartar alteração no título" ' +
              'aria-label="Descartar alteração no título">' + icDesfazer() + "</button>" +
          "</div>" +
          '<div class="am-det-title__meta">' +
            '<span class="am-det-dirty" id="am-det-dirty-titulo"><span class="am-det-dot"></span>Alteração não salva</span>' +
            '<span class="am-det-title__count" id="am-det-count-titulo"></span>' +
            (tituloTravado
              ? '<span class="am-det-title__locknote">Gerenciado pelo Mercado Livre</span>'
              : "") +
          "</div>" +
        "</div>" +
        '<div class="am-det-head__meta">' +
          '<span class="vf-mono">' + escapeHtml(a.item_id) + "</span>" +
          '<span class="am-det-head__dot">·</span>' +
          '<span class="vf-mono">SKU ' + escapeHtml(a.sku || "—") + "</span>" +
          '<span class="am-det-head__dot">·</span>' +
          '<span class="vf-status ' + st.classe + '">' + escapeHtml(st.label) + "</span>" + subStatus +
          (catalogoTag
            ? '<span class="am-det-head__dot">·</span><span class="vf-tag is-primary" title="Publicação de catálogo do Mercado Livre">Catálogo</span>'
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

  // ===========================================================================
  // COMPOSIÇÃO DA MARGEM — seção secundária do modal de detalhe.
  //
  // Transparência sobre como a margem do MLB foi calculada, sem recalcular
  // nada: todo número vem do Motor de Margem (GET /anuncios-meli/performance
  // ?incluirComposicao=1 — mesmo endpoint que a lista já usa para a coluna
  // Margem, ver carregarPerformance/garantirComposicaoDoItem). A ÚNICA conta
  // feita fora do Motor é "venda × imposto%" no BACKEND (o Motor guarda
  // imposto como percentual, nunca em R$) — só para a linha Imposto virar
  // moeda como as demais; a margem final exibida é sempre
  // item.margin.<origem>.margin/profit, o número pronto do Motor, nunca uma
  // soma das linhas desta tela.
  //
  // Nasce FECHADA (<details> nativo, sem `open`) e SEM nenhuma chamada de
  // rede — só busca ao ser aberta pela primeira vez (ver
  // bindMargemComposicao). Reabrir o MESMO MLB (mesma seção, ou reabrir o
  // modal do mesmo item_id) lê do cache; fechar o modal e abrir OUTRO MLB
  // nunca herda a composição do anterior — a seção nasce muda de novo,
  // porque o cache é indexado por item_id, não por sessão de modal.
  // ===========================================================================

  function margemComposicaoDicaHtml() {
    return '<p class="am-margem-comp__dica">Toque para ver como a margem foi calculada.</p>';
  }

  function margemComposicaoCarregandoHtml() {
    return '<p class="am-margem-comp__dica">Carregando composição…</p>';
  }

  // Uma linha SOMENTE LEITURA da "escada" — omitida por completo quando o
  // valor não existe (nunca um "—" no lugar dela): é a régua pedida
  // ("mostrar apenas o que existe"). Usada por Comissão/Frete/Imposto —
  // valores calculados/determinados pelo Motor ou pelo Mercado Livre, nunca
  // editáveis nesta tela.
  function margemComposicaoLinhaHtml(rotulo, valor, moeda, tooltip) {
    if (valor == null) return "";
    return '<div class="am-margem-comp__linha">' +
      '<span class="am-margem-comp__rotulo">' + escapeHtml(rotulo) +
        (tooltip ? infoDotHtml(tooltip) : "") + "</span>" +
      '<span class="am-margem-comp__valor">' + formatMoeda(valor, moeda) + "</span>" +
    "</div>";
  }

  function botaoMargemEditHtml(rotulo, tituloBotao) {
    return '<button type="button" class="am-margem-edit__btn" title="' + escapeAttr(tituloBotao) + '">' +
      escapeHtml(rotulo) + "</button>";
  }

  // Uma linha de SIMULAÇÃO (Custo do produto/Custos adicionais) — ao
  // contrário das somente-leitura, NUNCA some por valor ausente: é assim que
  // o operador simula um custo que a Base não tem. `campo` é o nome usado
  // pelo clique/teclado (bindMargemEditavel) e pelo contrato de POST
  // .../simular-margem ("custoProduto" | "custosAdicionais"). Nunca chama o
  // Mercado Livre — Preço tem seu próprio HTML/fluxo, ver
  // margemComposicaoLinhaPrecoHtml.
  function margemComposicaoLinhaEditavelHtml(rotulo, campo, valor, moeda, itemId, tituloBotao) {
    return '<div class="am-margem-comp__linha am-margem-comp__linha--editavel">' +
      '<span class="am-margem-comp__rotulo">' + escapeHtml(rotulo) + "</span>" +
      '<span class="am-margem-comp__valor am-margem-edit" data-margem-item="' + escapeAttr(itemId) +
        '" data-margem-campo="' + escapeAttr(campo) + '" data-margem-valor="' + escapeAttr(valor == null ? "" : valor) + '">' +
        botaoMargemEditHtml(formatMoeda(valor, moeda), tituloBotao) +
      "</span>" +
    "</div>";
  }

  // Linha de PREÇO — a única que grava de verdade no Mercado Livre. Por isso
  // tem HTML e fluxo próprios (nunca dividido com a simulação de
  // custo/custos adicionais):
  //  - sempre carrega a tag "Altera no Mercado Livre" quando editável, pra
  //    deixar claro que não é simulação;
  //  - quando `bloqueado` (promoção ativa no ML — o valor exibido é o
  //    promocional, e não existe hoje endpoint de escrita pra ele, ver
  //    meliPrecoService), a tag some, o valor vira texto puro (sem botão) e
  //    o motivo aparece num ⓘ ao lado do rótulo — mesmo padrão do título
  //    travado por catálogo, adaptado pra tooltip por causa do espaço da
  //    "escada".
  function margemComposicaoLinhaPrecoHtml(valor, moeda, itemId, bloqueado, motivoBloqueio) {
    var rotulo = '<span class="am-margem-comp__rotulo">Preço' +
      (bloqueado
        ? infoDotHtml(motivoBloqueio)
        : ' <span class="vf-tag is-warning am-margem-comp__ml-tag" title="Uma alteração aqui grava direto no Mercado Livre">Altera no Mercado Livre</span>') +
      "</span>";

    var valorHtml;
    if (bloqueado) {
      valorHtml = '<span class="am-margem-comp__valor am-margem-comp__valor--bloqueado" title="' +
        escapeAttr(motivoBloqueio) + '">' + formatMoeda(valor, moeda) + "</span>";
    } else {
      valorHtml = '<span class="am-margem-comp__valor am-margem-preco" data-margem-item="' + escapeAttr(itemId) +
        '" data-margem-valor="' + escapeAttr(valor == null ? "" : valor) + '">' +
        botaoMargemEditHtml(formatMoeda(valor, moeda), "Alterar grava direto no Mercado Livre") +
      "</span>";
    }

    return '<div class="am-margem-comp__linha am-margem-comp__linha--editavel">' + rotulo + valorHtml + "</div>";
  }

  function margemComposicaoLadderHtml(comp, cacheMargem, moeda, itemId) {
    var sim = (DET && DET.itemId === itemId) ? DET.simulacaoMargem : null;
    var simulando = !!(sim && (sim.custoProduto != null || sim.custosAdicionais != null));

    // Custo do produto e Custos adicionais mostram o OVERRIDE de simulação
    // quando ativo — nunca o valor real por baixo dele, para não sugerir que
    // o número simulado foi gravado em algum lugar.
    var custoExibido = sim && sim.custoProduto != null ? sim.custoProduto : comp.custoProduto;
    var custosAdicionaisExibido = sim && sim.custosAdicionais != null ? sim.custosAdicionais : comp.taxaFixa;

    var linhas =
      margemComposicaoLinhaPrecoHtml(comp.venda, moeda, itemId, !!comp.precoPromocionalAtivo,
        "Este anúncio está com uma promoção ativa no Mercado Livre — o valor mostrado é o preço promocional vigente, " +
        "que esta tela ainda não edita. Ajuste a promoção diretamente no Mercado Livre.") +
      margemComposicaoLinhaEditavelHtml("Custo do produto", "custoProduto", custoExibido, moeda, itemId,
        "Simular outro custo — não altera a Base de Custos") +
      margemComposicaoLinhaHtml("Comissão Mercado Livre", comp.comissaoMl, moeda) +
      margemComposicaoLinhaHtml("Frete", comp.frete, moeda) +
      margemComposicaoLinhaEditavelHtml("Custos adicionais", "custosAdicionais", custosAdicionaisExibido, moeda, itemId,
        "Simular embalagem, operação ou outro custo extra — não é cobrado pelo Mercado Livre");

    if (comp.impostoValor != null) {
      var rotuloImposto = "Imposto" +
        (comp.impostoPercentual != null ? " (" + formatarPercentualCompacto(comp.impostoPercentual * 100) + ")" : "");
      linhas += margemComposicaoLinhaHtml(rotuloImposto, comp.impostoValor, moeda,
        "Guardado como percentual pelo Motor de Margem — este valor em R$ é só para exibição.");
    }

    // "= Margem": o valor REAL do Motor por padrão — nunca a soma das linhas
    // acima. Só vira "Margem simulada" enquanto Custo do produto ou Custos
    // adicionais tiverem um override ativo — e aí o número é sempre o que
    // veio de POST .../simular-margem, nunca recalculado aqui no front.
    var totalHtml = "";
    if (simulando && sim.resultado) {
      var r = sim.resultado;
      totalHtml = '<div class="am-margem-comp__linha am-margem-comp__total am-margem-comp__total--simulada">' +
        '<span class="am-margem-comp__rotulo">Margem simulada' + infoDotHtml(
          "Projeção com os valores digitados acima — nada foi gravado no Mercado Livre nem na Base de Custos."
        ) + "</span>" +
        '<span class="am-margem-comp__valor">' +
          (r.computable
            ? formatMoeda(r.profit, moeda) + (r.marginPercent != null ? " (" + formatarPercentualCompacto(r.marginPercent) + ")" : "")
            : "Sem dados suficientes para simular") +
          ' <button type="button" class="am-margem-comp__restaurar" data-acao="restaurar-simulacao-margem" ' +
            'title="Descartar a simulação e voltar para a margem real">↺ real</button>' +
        "</span>" +
      "</div>";
    } else if (cacheMargem && cacheMargem.profit != null) {
      totalHtml = '<div class="am-margem-comp__linha am-margem-comp__total">' +
        '<span class="am-margem-comp__rotulo">Margem</span>' +
        '<span class="am-margem-comp__valor">' + formatMoeda(cacheMargem.profit, moeda) +
          (cacheMargem.marginPercent != null ? " (" + formatarPercentualCompacto(cacheMargem.marginPercent) + ")" : "") +
        "</span>" +
      "</div>";
    }

    return '<div class="am-margem-comp__ladder">' + linhas + totalHtml + "</div>";
  }

  // Conteúdo pronto da seção — usado tanto no primeiro paint (quando o item
  // já estava em cache, ex.: reabrir o modal do mesmo MLB) quanto depois que
  // a busca sob demanda resolve (ver repintarComposicaoDoItem).
  function margemComposicaoConteudoHtml(itemId, moeda) {
    var cache = AM.state.performanceCache[itemId];
    if (!cache || !cache.temMargem) return margemComposicaoDicaHtml();

    // Badge de estado — a MESMA função que já pinta a célula de margem da
    // lista (mesmo rótulo, mesma cor, mesmo vocabulário real do Motor).
    // Cobre sozinha os dois casos de "sem número": contexto indisponível
    // (margemIndisponivel) e item não-computável (statusLabel/statusReasons)
    // — a composição segue exatamente a mesma disponibilidade da lista,
    // nunca um caminho alternativo.
    var badge = '<div class="am-margem-comp__badge">' +
      margemConteudoHtml(cache.margem, cache.margemIndisponivel) + "</div>";

    if (!cache.temComposicao) return badge + margemComposicaoCarregandoHtml();
    if (!cache.composicao) return badge; // contexto indisponível / item não-computável — sem ladder, sem número parcial

    return badge + margemComposicaoLadderHtml(cache.composicao, cache.margem, moeda, itemId);
  }

  // Resumo compacto no <summary>, à direita do título — só aparece quando a
  // composição JÁ foi carregada (a seção fica muda até ser aberta).
  function margemComposicaoResumoHtml(itemId) {
    var cache = AM.state.performanceCache[itemId];
    if (!cache || !cache.temComposicao || !cache.margem || cache.margem.marginPercent == null) return "";
    var origemRotulo = cache.margem.origem === "realized" ? "Realizada" : "Projetada";
    return escapeHtml(formatarPercentualCompacto(cache.margem.marginPercent) + " · " + origemRotulo);
  }

  // `aberta` preserva o estado do <details> entre re-renders do modal
  // inteiro (salvar, descartar, aprovar sugestão de IA todos chamam
  // renderDetalhe() de novo) — sem isso, o operador que tinha a seção
  // aberta a veria fechar sozinha a cada ação no resto do modal.
  function margemComposicaoSecaoHtml(a, aberta) {
    var itemId = a.item_id;
    var cache = AM.state.performanceCache[itemId];
    var corpo;
    if (cache && cache.temComposicao) corpo = margemComposicaoConteudoHtml(itemId, a.moeda);
    else if (aberta) corpo = margemComposicaoCarregandoHtml(); // reaberta enquanto a busca ainda estava em voo
    else corpo = margemComposicaoDicaHtml();

    return '<details class="am-det-section am-margem-comp" id="am-det-margem"' + (aberta ? " open" : "") +
      ' data-item="' + escapeAttr(itemId) + '">' +
      '<summary class="am-det-section__head am-margem-comp__summary">' +
        '<h3 class="am-det-section__title">' +
          '<span class="am-margem-comp__chevron" aria-hidden="true">' + iconeChevronSvg() + "</span>" +
          "Composição da margem" +
        "</h3>" +
        '<span class="am-det-section__meta" id="am-det-margem-resumo">' + margemComposicaoResumoHtml(itemId) + "</span>" +
      "</summary>" +
      '<div class="am-margem-comp__body" id="am-det-margem-body">' + corpo + "</div>" +
    "</details>";
  }

  // Busca a composição só na PRIMEIRA vez que a seção é aberta — nunca ao
  // abrir o modal. Guardado por DET.token, mesmo padrão de
  // carregarHistoricoOtimizacoes: uma resposta tardia depois de fechar o
  // modal (ou abrir o de outro MLB) nunca escreve na tela errada.
  function bindMargemComposicao() {
    var secao = el("am-det-margem");
    if (!secao) return;
    secao.addEventListener("toggle", function () {
      if (!secao.open) return;
      var itemId = secao.getAttribute("data-item");
      var cache = AM.state.performanceCache[itemId];
      if (cache && cache.temComposicao) return; // já pronta — nada a buscar

      var corpo = el("am-det-margem-body");
      if (corpo) corpo.innerHTML = margemComposicaoCarregandoHtml();

      var meuToken = DET.token;
      garantirComposicaoDoItem(itemId).then(function () {
        if (!DET || DET.token !== meuToken) return; // modal fechado, ou outro MLB aberto no meio do caminho
        repintarComposicaoDoItem(itemId);
      });
    });
  }

  function repintarComposicaoDoItem(itemId) {
    var corpo = el("am-det-margem-body");
    if (corpo) corpo.innerHTML = margemComposicaoConteudoHtml(itemId, DET.anuncio.moeda);
    var resumo = el("am-det-margem-resumo");
    if (resumo) resumo.innerHTML = margemComposicaoResumoHtml(itemId);
    bindMargemEditavel(corpo);
    bindPrecoEditavel(corpo);
    bindRestaurarSimulacaoMargem(corpo, itemId);
  }

  // ===========================================================================
  // Composição da margem — EDIÇÃO. Dois fluxos deliberadamente SEPARADOS,
  // nunca compartilhando código de confirmação:
  //
  //  - Preço: escrita REAL no Mercado Livre (PATCH .../preco). Editar exige
  //    um clique explícito em "Salvar no Mercado Livre" — Enter NUNCA
  //    submete aqui, só Esc/Cancelar descartam. Ver bindPrecoEditavel e
  //    confirmarPrecoMargem.
  //  - Custo do produto / Custos adicionais: simulação local (POST
  //    .../simular-margem) — Enter confirma, Esc cancela, igual aos outros
  //    campos editáveis desta tela (estoque, título). Ver bindMargemEditavel
  //    e confirmarSimulacaoMargem.
  // ===========================================================================

  var CAMPOS_MARGEM_ROTULO = {
    custoProduto: "Custo do produto", custosAdicionais: "Custos adicionais",
  };

  function bindMargemEditavel(raiz) {
    (raiz || document).querySelectorAll(".am-margem-edit").forEach(function (cel) {
      cel.addEventListener("click", function (e) {
        e.stopPropagation();
        if (e.target.closest(".am-margem-edit__btn")) abrirEditorMargemCampo(cel);
      });
    });
  }

  function bindRestaurarSimulacaoMargem(raiz, itemId) {
    var botao = (raiz || document).querySelector('[data-acao="restaurar-simulacao-margem"]');
    if (!botao) return;
    botao.addEventListener("click", function (e) {
      e.stopPropagation();
      if (!DET || DET.itemId !== itemId) return;
      DET.simulacaoMargem = { custoProduto: null, custosAdicionais: null, resultado: null };
      repintarComposicaoDoItem(itemId);
    });
  }

  // Valor de LEITURA de uma célula de simulação: o override quando existe,
  // senão o valor REAL do cache.
  function valorLeituraMargemCampo(campo, itemId) {
    var cache = AM.state.performanceCache[itemId];
    var comp = cache && cache.composicao;
    var sim = DET && DET.itemId === itemId ? DET.simulacaoMargem : null;
    if (campo === "custoProduto") {
      if (sim && sim.custoProduto != null) return sim.custoProduto;
      return comp ? comp.custoProduto : null;
    }
    if (campo === "custosAdicionais") {
      if (sim && sim.custosAdicionais != null) return sim.custosAdicionais;
      return comp ? comp.taxaFixa : null;
    }
    return null;
  }

  function pintarMargemCampoLeitura(cel) {
    var campo = cel.getAttribute("data-margem-campo");
    var itemId = cel.getAttribute("data-margem-item");
    var valor = valorLeituraMargemCampo(campo, itemId);
    cel.setAttribute("data-margem-valor", valor == null ? "" : valor);
    cel.classList.remove("is-editando", "is-salvando");
    cel.innerHTML = botaoMargemEditHtml(
      formatMoeda(valor, DET.anuncio.moeda),
      "Simular — não altera a Base de Custos nem o Mercado Livre"
    );
  }

  function abrirEditorMargemCampo(cel) {
    if (!DET) return;
    if (cel.classList.contains("is-editando") || cel.classList.contains("is-salvando")) return;

    var campo = cel.getAttribute("data-margem-campo");
    var atual = cel.getAttribute("data-margem-valor") || "";
    cel.classList.add("is-editando");
    var dica = "Enter simula a margem, Esc cancela";
    cel.innerHTML = '<input type="number" step="0.01" min="0" class="am-margem-edit__input" ' +
      'value="' + escapeAttr(atual) + '" title="' + escapeAttr(dica) + '" aria-label="' +
      escapeAttr((CAMPOS_MARGEM_ROTULO[campo] || campo) + ". " + dica) + '" />';
    var input = cel.querySelector(".am-margem-edit__input");
    if (!input) return;
    input.focus();
    input.select();

    // Mesma regra dos outros campos de simulação desta tela: Enter confirma,
    // Esc cancela, sair do campo CANCELA — nunca confirma por acidente (um
    // clique fora, um Tab).
    input.addEventListener("keydown", function (e) {
      e.stopPropagation();
      if (e.key === "Enter") {
        e.preventDefault();
        confirmarSimulacaoMargem(cel, campo, input.value);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        pintarMargemCampoLeitura(cel);
      }
    });
    input.addEventListener("blur", function () {
      if (cel.classList.contains("is-salvando")) return;
      pintarMargemCampoLeitura(cel);
    });
  }

  // Custo do produto / Custos adicionais: só SIMULA. Nunca chama o Mercado
  // Livre, nunca grava na Base de Custos — só alimenta POST .../simular-margem
  // com o núcleo do Motor (marginEngine.computeMargin), o mesmo de sempre.
  function confirmarSimulacaoMargem(cel, campo, bruto) {
    var itemId = cel.getAttribute("data-margem-item");
    var anterior = cel.getAttribute("data-margem-valor") || "";
    var texto = String(bruto == null ? "" : bruto).trim();

    if (texto === anterior) { pintarMargemCampoLeitura(cel); return; }

    if (texto === "") {
      // Campo esvaziado: o override some — volta a valer o número real do Motor.
      DET.simulacaoMargem[campo] = null;
      pintarMargemCampoLeitura(cel);
      dispararSimulacaoMargem(itemId);
      return;
    }

    var n = Number(texto);
    if (!isFinite(n) || n < 0) {
      toast("Informe um número maior ou igual a zero.", "is-danger");
      pintarMargemCampoLeitura(cel);
      return;
    }

    DET.simulacaoMargem[campo] = Math.round((n + Number.EPSILON) * 100) / 100;
    pintarMargemCampoLeitura(cel);
    dispararSimulacaoMargem(itemId);
  }

  function dispararSimulacaoMargem(itemId) {
    if (!DET || DET.itemId !== itemId) return;
    var sim = DET.simulacaoMargem;
    if (sim.custoProduto == null && sim.custosAdicionais == null) {
      // Nenhum override ativo: some a projeção e volta para a margem real,
      // sem gastar chamada nenhuma.
      sim.resultado = null;
      repintarComposicaoDoItem(itemId);
      return;
    }

    var cache = AM.state.performanceCache[itemId];
    var origem = cache && cache.margem ? cache.margem.origem : "projected";
    var corpo = { clienteSlug: AM.clienteAtual.slug, origem: origem };
    if (AM.contaMlId) corpo.clienteContaId = AM.contaMlId;
    if (sim.custoProduto != null) corpo.custoProduto = sim.custoProduto;
    if (sim.custosAdicionais != null) corpo.custosAdicionais = sim.custosAdicionais;

    var meuToken = DET.token;
    api("/anuncios-meli/" + encodeURIComponent(itemId) + "/simular-margem", { method: "POST", body: corpo })
      .then(function (r) {
        if (!DET || DET.token !== meuToken) return; // modal fechado, ou outro MLB no meio do caminho
        var d = r.data || {};
        if (!d.ok) {
          toast(d.motivo || "Não foi possível simular a margem.", "is-danger");
          return;
        }
        DET.simulacaoMargem.resultado = d.resultado;
        repintarComposicaoDoItem(itemId);
      });
  }

  // ===========================================================================
  // Preço — fluxo próprio, sem Enter-submit. Editar → digitar → clicar em
  // "Salvar no Mercado Livre" (ou Esc/"Cancelar" pra descartar). O valor
  // exibido depois do sucesso NUNCA é o digitado — vem da resposta do PUT
  // que o próprio Mercado Livre confirma (ver meliPrecoService no backend),
  // repintada a partir de reconsultar a composição do zero.
  // ===========================================================================

  function bindPrecoEditavel(raiz) {
    (raiz || document).querySelectorAll(".am-margem-preco").forEach(function (cel) {
      cel.addEventListener("click", function (e) {
        e.stopPropagation();
        if (e.target.closest(".am-margem-edit__btn")) abrirEditorPreco(cel);
        else if (e.target.closest('[data-acao="salvar-preco"]')) confirmarPrecoMargem(cel);
        else if (e.target.closest('[data-acao="cancelar-preco"]')) pintarPrecoLeitura(cel);
      });
    });
  }

  function pintarPrecoLeitura(cel) {
    var cache = AM.state.performanceCache[cel.getAttribute("data-margem-item")];
    var comp = cache && cache.composicao;
    var valor = comp ? comp.venda : null;
    cel.setAttribute("data-margem-valor", valor == null ? "" : valor);
    cel.classList.remove("is-editando", "is-salvando");
    cel.innerHTML = botaoMargemEditHtml(formatMoeda(valor, DET.anuncio.moeda), "Alterar grava direto no Mercado Livre");
  }

  function abrirEditorPreco(cel) {
    if (!DET) return;
    if (cel.classList.contains("is-editando") || cel.classList.contains("is-salvando")) return;
    if (DET.precoMargem.salvando) return; // um PUT de preço em voo trava a seção até resolver

    var atual = cel.getAttribute("data-margem-valor") || "";
    cel.classList.add("is-editando");
    cel.innerHTML = '<span class="am-margem-preco__editor">' +
      '<input type="number" step="0.01" min="0" class="am-margem-edit__input" value="' + escapeAttr(atual) + '" ' +
        'aria-label="Novo preço no Mercado Livre" />' +
      '<span class="am-margem-comp__acoes">' +
        '<button type="button" class="vf-btn vf-btn--primary vf-btn--sm" data-acao="salvar-preco">Salvar no Mercado Livre</button>' +
        '<button type="button" class="vf-btn vf-btn--ghost vf-btn--sm" data-acao="cancelar-preco">Cancelar</button>' +
      "</span>" +
    "</span>";
    var input = cel.querySelector(".am-margem-edit__input");
    if (!input) return;
    input.focus();
    input.select();

    // Preço não faz auto-submit no Enter — o fluxo principal é clicar em
    // "Salvar no Mercado Livre" (é uma escrita real, não uma simulação).
    // Diferente dos outros campos editáveis desta tela, sair do campo (blur)
    // NÃO cancela mais sozinho: o editor tem botões próprios ("Salvar
    // no Mercado Livre"/"Cancelar") dentro da célula, e blur dispara antes
    // do click do botão ser processado — cancelar no blur fecharia o editor
    // antes do clique em "Salvar" chegar a acontecer. Só Esc ou o clique
    // explícito em "Cancelar" descartam.
    input.addEventListener("keydown", function (e) {
      e.stopPropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        pintarPrecoLeitura(cel);
      }
    });
  }

  // Preço: escrita REAL no Mercado Livre (PATCH .../preco). O valor exibido
  // depois do sucesso NUNCA é o digitado — vem de reconsultar a composição
  // (que por sua vez lê o preço confirmado pela resposta do PUT, ver
  // meliPrecoService no backend), então esta função nunca escreve um número
  // "confiado" na tela.
  function confirmarPrecoMargem(cel) {
    if (!DET || DET.precoMargem.salvando) return;
    var itemId = cel.getAttribute("data-margem-item");
    var input = cel.querySelector(".am-margem-edit__input");
    var anterior = cel.getAttribute("data-margem-valor") || "";
    var texto = String((input && input.value) == null ? "" : input.value).trim();

    if (texto === anterior) { pintarPrecoLeitura(cel); return; }

    var n = Number(texto);
    if (!isFinite(n) || n <= 0) {
      toast("O preço precisa ser um número maior que zero.", "is-danger");
      return;
    }

    DET.precoMargem.salvando = true;
    cel.classList.remove("is-editando");
    cel.classList.add("is-salvando");
    cel.innerHTML = '<span class="am-margem-edit__salvando" aria-live="polite">gravando no Mercado Livre…</span>';

    var corpo = { clienteSlug: AM.clienteAtual.slug, preco: n };
    if (AM.contaMlId) corpo.clienteContaId = AM.contaMlId;

    var meuToken = DET.token;
    api("/anuncios-meli/" + encodeURIComponent(itemId) + "/preco", { method: "PATCH", body: corpo })
      .then(function (r) {
        if (!DET || DET.token !== meuToken) return; // modal fechado, ou outro MLB no meio do caminho
        DET.precoMargem.salvando = false;
        var d = r.data || {};
        if (!d.ok) {
          cel.classList.remove("is-salvando");
          pintarPrecoLeitura(cel);
          toast(d.motivo || "Não foi possível atualizar o preço.", "is-danger");
          return;
        }

        // Preço real mudou: qualquer simulação de custo/custos adicionais em
        // cima do preço antigo deixa de fazer sentido — some, e a composição
        // é reconsultada do zero (nunca assume o valor enviado).
        DET.simulacaoMargem = { custoProduto: null, custosAdicionais: null, resultado: null };
        var cache = AM.state.performanceCache[itemId];
        if (cache) { cache.temComposicao = false; cache.temMargem = false; }

        garantirComposicaoDoItem(itemId).then(function () {
          if (!DET || DET.token !== meuToken) return;
          repintarComposicaoDoItem(itemId);
        });
        toast("Preço atualizado no Mercado Livre.");
      });
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
