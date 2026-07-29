/*
 * Control Center — renderers.
 *
 * Funções puras de (state) → HTML. Todo valor que veio de request, log ou
 * usuário passa por escapeHtml antes de virar markup.
 */
(function () {
  "use strict";

  var S = window.VFCStore;
  var E = S.escapeHtml;

  var ROTULOS_VIEW = {
    overview: "Visão geral",
    requests: "Requests",
    errors: "Erros",
    browser: "Navegador",
    health: "Saúde",
    routes: "Rotas",
    tools: "Ferramentas"
  };

  var ROTULOS_JANELA = {
    "15m": "15 min",
    "1h": "1 hora",
    "6h": "6 horas",
    "24h": "24 horas",
    "7d": "7 dias"
  };

  /* ============================================================
   * BLOCOS DE ESTADO
   * ============================================================ */

  function carregando(mensagem) {
    return '<div class="vf-loading-state" role="status">' +
      '<span class="vf-spinner" aria-hidden="true"></span>' +
      '<p>' + E(mensagem || "Carregando…") + '</p></div>';
  }

  function vazio(titulo, descricao, acoes) {
    return '<div class="vf-empty">' +
      '<div class="vf-empty__icon" aria-hidden="true">∅</div>' +
      '<h3 class="vf-empty__title">' + E(titulo) + '</h3>' +
      '<p class="vf-empty__description">' + E(descricao) + '</p>' +
      (acoes ? '<div class="vf-empty__actions">' + acoes + '</div>' : "") +
      '</div>';
  }

  function falha(erro, contexto) {
    if (!erro) return "";
    var titulo = "Não foi possível carregar";
    var descricao = erro.erro || "erro desconhecido";
    var acao = '<button class="vf-btn vf-btn--secondary vf-btn--sm" type="button" data-cc-action="reload">Tentar novamente</button>';

    if (erro.tipo === "sem-permissao") {
      titulo = "Sem permissão";
      descricao = "A API recusou o acesso a esta área. O Control Center é admin-only e quem valida isso é o servidor, não o menu.";
      acao = "";
    } else if (erro.tipo === "banco-indisponivel") {
      titulo = "Banco indisponível";
      descricao = "O PostgreSQL não respondeu ou as tabelas de observabilidade ainda não foram criadas. Os eventos locais do navegador continuam disponíveis na visão Navegador.";
    } else if (erro.tipo === "endpoint-ausente" || erro.tipo === "nao-encontrado") {
      titulo = "Endpoint ausente";
      descricao = "Este servidor ainda não expõe /admin/observability. Atualize o backend ou use somente os dados locais do navegador.";
    } else if (erro.tipo === "offline") {
      titulo = "Servidor inacessível";
      descricao = "Falha de rede ao falar com a API (" + descricao + "). Verifique conexão, CORS ou cold start do servidor.";
    } else if (erro.tipo === "sem-token") {
      titulo = "Sessão sem token";
      descricao = "Faça login novamente para consultar o histórico do servidor.";
      acao = '<a class="vf-btn vf-btn--primary vf-btn--sm" href="index.html">Ir para o login</a>';
    }

    return '<div class="vf-banner is-danger vfc-falha" role="alert">' +
      '<div class="vf-banner__content">' +
      '<p class="vf-banner__title">' + E(titulo) + (contexto ? ' · ' + E(contexto) : "") + '</p>' +
      '<p class="vf-banner__description">' + E(descricao) + '</p>' +
      '</div>' + (acao ? '<div class="vf-banner__actions">' + acao + '</div>' : "") + '</div>';
  }

  function kpi(rotulo, valor, rodape, modificador) {
    return '<div class="vf-kpi ' + (modificador || "") + '">' +
      '<span class="vf-kpi__label">' + E(rotulo) + '</span>' +
      '<span class="vf-kpi__value">' + E(valor) + '</span>' +
      (rodape ? '<span class="vf-kpi__foot">' + E(rodape) + '</span>' : "") +
      '</div>';
  }

  function tag(texto, classe) {
    return '<span class="vf-tag ' + (classe || "") + '">' + E(texto) + '</span>';
  }

  function status(texto, classe) {
    return '<span class="vf-status ' + (classe || "") + '">' + E(texto) + '</span>';
  }

  /* ============================================================
   * BARRA DE CONTEXTO
   * ============================================================ */

  function statusBar(state) {
    var usuario = window.VFCApi.user();
    var runtime = state.local.runtime || {};
    var backend = state.backendOk === null
      ? { texto: "verificando", classe: "" }
      : state.backendOk
        ? { texto: "online", classe: "is-success" }
        : { texto: "offline", classe: "is-danger" };

    var debug = runtime.ativo
      ? { texto: "ligado", classe: "is-success" }
      : runtime.habilitado
        ? { texto: "ligado sem permissão", classe: "is-warning" }
        : { texto: "desligado", classe: "is-neutral" };

    var sincronizacao;
    if (!runtime.ativo) {
      sincronizacao = { texto: "coletor desligado", classe: "is-neutral" };
    } else if (runtime.ultimoSyncErro) {
      sincronizacao = { texto: "somente local · " + runtime.ultimoSyncErro, classe: "is-warning" };
    } else if (runtime.pendentes) {
      sincronizacao = { texto: runtime.pendentes + " na fila", classe: "is-warning" };
    } else {
      sincronizacao = { texto: "sincronizado", classe: "is-success" };
    }

    var itens = [
      { rotulo: "ambiente", valor: (state.saude && state.saude.api ? state.saude.api.ambiente : "—") },
      { rotulo: "backend", html: status(backend.texto, backend.classe) },
      { rotulo: "debug navegador", html: status(debug.texto, debug.classe) },
      { rotulo: "sincronização", html: status(sincronizacao.texto, sincronizacao.classe) },
      { rotulo: "usuário", valor: usuario.nome || usuario.email || "—" },
      { rotulo: "role", valor: usuario.role || "—" },
      { rotulo: "API base", valor: window.VFCApi.apiBase(), mono: true },
      { rotulo: "atualizado", valor: state.ultimaAtualizacao ? S.formatarHora(state.ultimaAtualizacao) : "—" },
      {
        rotulo: "auto refresh",
        html: status(
          state.autoRefresh ? (state.pausadoPorAba ? "pausado (aba oculta)" : "a cada " + Math.round(state.refreshMs / 1000) + "s") : "pausado",
          state.autoRefresh && !state.pausadoPorAba ? "is-success" : "is-neutral"
        )
      }
    ];

    return '<section class="vfc-statusbar" aria-label="Contexto técnico">' +
      itens.map(function (item) {
        return '<div class="vfc-statusbar__item">' +
          '<span class="vfc-statusbar__label">' + E(item.rotulo) + '</span>' +
          (item.html
            ? '<span class="vfc-statusbar__value">' + item.html + '</span>'
            : '<span class="vfc-statusbar__value' + (item.mono ? " vf-mono vf-truncate" : "") + '" title="' + E(item.valor) + '">' + E(item.valor) + '</span>') +
          '</div>';
      }).join("") +
      '</section>';
  }

  function abas(state) {
    return '<nav class="vf-tabs vfc-tabs" role="tablist" aria-label="Visões do Control Center">' +
      S.VIEWS.map(function (view) {
        var ativo = state.view === view;
        return '<button class="vf-tab' + (ativo ? " is-active" : "") + '" type="button" role="tab"' +
          ' aria-selected="' + (ativo ? "true" : "false") + '" data-cc-view="' + view + '">' +
          E(ROTULOS_VIEW[view]) + '</button>';
      }).join("") +
      '</nav>';
  }

  function seletorJanela(state) {
    return '<div class="vf-segmented" role="group" aria-label="Janela de tempo">' +
      S.WINDOWS.map(function (janela) {
        return '<button class="vf-segmented__item' + (state.window === janela ? " is-active" : "") + '"' +
          ' type="button" data-cc-window="' + janela + '">' + E(ROTULOS_JANELA[janela]) + '</button>';
      }).join("") +
      '</div>';
  }

  /* ============================================================
   * OVERVIEW
   * ============================================================ */

  function overview(state) {
    if (state.falhas.resumo) {
      return falha(state.falhas.resumo, "visão geral") + (state.local.eventos.length ? avisoSomenteLocal(state) : "");
    }
    if (!state.resumo && state.carregando.resumo) return carregando("Consultando o histórico do servidor…");
    if (!state.resumo) {
      return vazio("Sem resumo", "O servidor ainda não devolveu dados para esta janela.");
    }

    var r = state.resumo;
    var semDados = r.total === 0 && r.eventosNavegador === 0;

    var kpis = '<div class="vf-kpi-grid">' +
      kpi("requests", S.formatarNumero(r.total), r.porMinuto + "/min") +
      kpi("taxa de erro", r.total ? (100 - (r.percentualSucesso || 0)).toFixed(1) + "%" : "—",
        r.total ? r.percentualSucesso + "% de sucesso" : "sem requests",
        r.total && (100 - r.percentualSucesso) > 5 ? "vf-kpi--danger" : "") +
      kpi("4xx", S.formatarNumero(r.erros4xx), "cliente/autorização", r.erros4xx ? "vf-kpi--warning" : "") +
      kpi("5xx", S.formatarNumero(r.erros5xx), "servidor", r.erros5xx ? "vf-kpi--danger" : "") +
      kpi("lentas", S.formatarNumero(r.lentas), "≥ " + r.slowMs + "ms") +
      kpi("duração média", S.formatarDuracao(r.duracaoMedia), "p50 " + S.formatarDuracao(r.p50)) +
      kpi("p95", S.formatarDuracao(r.p95), "p99 " + S.formatarDuracao(r.p99)) +
      kpi("erros do navegador", S.formatarNumero(r.errosNavegador),
        r.errosJs + " JS · " + r.rejeicoesNaoTratadas + " promises", r.errosNavegador ? "vf-kpi--warning" : "") +
      kpi("falhas de rede", S.formatarNumero(r.falhasRede), "reportadas pelo navegador") +
      kpi("não sincronizados", S.formatarNumero((state.local.stats && state.local.stats.naoSincronizados) || 0),
        "eventos locais nesta máquina") +
      '</div>';

    if (semDados) {
      return kpis + vazio(
        "Nenhum registro nesta janela",
        "O servidor está respondendo, mas não há requests nem eventos no período. Amplie a janela ou ligue o debug do navegador e use o Portal para gerar tráfego.",
        '<button class="vf-btn vf-btn--primary vf-btn--sm" type="button" data-cc-action="toggle-debug">Ligar debug do navegador</button>'
      );
    }

    return kpis +
      '<div class="vfc-grid-2">' +
      cardSerie(r) +
      cardDistribuicaoStatus(r) +
      '</div>' +
      '<div class="vfc-grid-2">' +
      cardDestaques(r) +
      cardSaudeResumo(state) +
      '</div>' +
      cardErrosRecentes(state);
  }

  function cardSerie(r) {
    var serie = r.porMinutoSerie || [];
    if (!serie.length) {
      return card("Requests por minuto", vazio("Sem série", "Nenhuma request no período."));
    }
    var maximo = serie.reduce(function (max, ponto) { return Math.max(max, Number(ponto.total) || 0); }, 1);
    var barras = serie.map(function (ponto) {
      var total = Number(ponto.total) || 0;
      var erros = Number(ponto.erros) || 0;
      var altura = Math.max(2, Math.round((total / maximo) * 100));
      var alturaErro = total ? Math.round((erros / total) * altura) : 0;
      var rotulo = S.formatarHora(ponto.minuto) + " · " + total + " requests, " + erros + " com erro";
      return '<div class="vfc-bar" style="height:' + altura + '%" title="' + E(rotulo) + '">' +
        (alturaErro ? '<span class="vfc-bar__erro" style="height:' + Math.round((erros / total) * 100) + '%"></span>' : "") +
        '</div>';
    }).join("");

    return card("Requests por minuto",
      '<div class="vfc-chart" role="img" aria-label="Requests por minuto no período. Pico de ' + E(maximo) + ' requests.">' + barras + '</div>' +
      '<p class="vfc-chart__legenda">pico ' + E(maximo) + ' req/min · barra escura = requests com erro</p>');
  }

  function cardDistribuicaoStatus(r) {
    var faixas = r.porStatus || [];
    if (!faixas.length) return card("Distribuição por status", vazio("Sem dados", "Nenhuma request no período."));
    var total = faixas.reduce(function (soma, faixa) { return soma + Number(faixa.total || 0); }, 0) || 1;

    return card("Distribuição por status",
      '<div class="vfc-stack-bar" role="img" aria-label="Distribuição de requests por faixa de status">' +
      faixas.map(function (faixa) {
        var pct = (Number(faixa.total) / total) * 100;
        return '<span class="vfc-stack-bar__parte ' + S.classeStatus(faixa.faixa || 0) + '"' +
          ' style="width:' + pct.toFixed(2) + '%" title="' + E((faixa.faixa || "sem status") + ": " + faixa.total) + '"></span>';
      }).join("") + '</div>' +
      '<ul class="vfc-legenda">' +
      faixas.map(function (faixa) {
        return '<li><span class="vfc-legenda__ponto ' + S.classeStatus(faixa.faixa || 0) + '"></span>' +
          E(faixa.faixa ? faixa.faixa + "x" : "sem status") + ' · ' + E(S.formatarNumero(faixa.total)) +
          ' (' + ((Number(faixa.total) / total) * 100).toFixed(1) + '%)</li>';
      }).join("") + '</ul>');
  }

  function cardDestaques(r) {
    var linhas = [];
    if (r.rotaComMaisErros) {
      linhas.push(['endpoint com mais erros',
        '<button class="vfc-link vf-mono" type="button" data-cc-action="filter-route" data-cc-value="' + E(r.rotaComMaisErros.rota) + '">' +
        E(r.rotaComMaisErros.rota) + '</button> · ' + E(r.rotaComMaisErros.total) + ' erros']);
    }
    if (r.rotaMaisLenta) {
      linhas.push(['endpoint mais lento',
        '<button class="vfc-link vf-mono" type="button" data-cc-action="filter-route" data-cc-value="' + E(r.rotaMaisLenta.rota) + '">' +
        E(r.rotaMaisLenta.rota) + '</button> · ' + E(S.formatarDuracao(r.rotaMaisLenta.media)) + ' em média']);
    }
    if (r.ultimoErro) {
      linhas.push(['último erro',
        '<button class="vfc-link vf-mono" type="button" data-cc-request="' + E(r.ultimoErro.request_id) + '">' +
        E(r.ultimoErro.method + " " + r.ultimoErro.rota + " → " + (r.ultimoErro.status_code || "?")) + '</button>' +
        '<br><span class="vfc-muted">' + E(r.ultimoErro.error_message || "sem mensagem") + ' · ' + E(S.formatarRelativo(r.ultimoErro.created_at)) + '</span>']);
    }
    linhas.push(['eventos descartados pela fila', E(S.formatarNumero(r.fila ? r.fila.descartados : 0)) +
      ' <span class="vfc-muted">(' + E(S.formatarNumero(r.fila ? r.fila.pendentes : 0)) + ' pendentes no servidor)</span>']);
    linhas.push(['sessões de navegador', E(S.formatarNumero(r.sessoes))]);

    if (!linhas.length) return card("Destaques", vazio("Sem destaques", "Nenhum erro nem lentidão no período."));

    return card("Destaques do período",
      '<dl class="vfc-kv">' + linhas.map(function (par) {
        return '<dt>' + E(par[0]) + '</dt><dd>' + par[1] + '</dd>';
      }).join("") + '</dl>');
  }

  function cardSaudeResumo(state) {
    if (state.falhas.saude) return card("Saúde", falha(state.falhas.saude, "health"));
    if (!state.saude) return card("Saúde", carregando("Consultando saúde…"));

    var s = state.saude;
    var itens = [
      ["API", s.api.status === "saudavel" ? "is-success" : "is-danger", s.api.status + " · uptime " + Math.round(s.api.uptimeSegundos / 60) + "min"],
      ["PostgreSQL", s.banco.status === "saudavel" ? "is-success" : "is-danger",
        s.banco.status === "saudavel" ? "latência " + s.banco.latenciaMs + "ms" : (s.banco.erro || "sem resposta")],
      ["Observabilidade", s.observabilidade.habilitada ? "is-success" : "is-warning",
        s.observabilidade.habilitada ? "retenção " + s.observabilidade.retencaoDias + "d" : "desligada por configuração"],
      ["Fila de logs", (s.observabilidade.fila.falhasConsecutivas ? "is-danger" : "is-success"),
        s.observabilidade.fila.pendentes + " pendentes · " + s.observabilidade.fila.descartados + " descartados"],
      ["Memória", s.api.memoria.heapUsadoMb > 400 ? "is-warning" : "is-success",
        s.api.memoria.heapUsadoMb + "MB heap / " + s.api.memoria.rssMb + "MB RSS"]
    ];

    return card("Saúde dos componentes",
      '<ul class="vfc-lista-saude">' + itens.map(function (item) {
        return '<li><span class="vfc-lista-saude__nome">' + E(item[0]) + '</span>' +
          status(item[2], item[1]) + '</li>';
      }).join("") + '</ul>',
      '<button class="vf-btn vf-btn--ghost vf-btn--sm" type="button" data-cc-view="health">Abrir Saúde</button>');
  }

  function cardErrosRecentes(state) {
    var grupos = (state.erros.grupos || []).slice(0, 6);
    if (!grupos.length) {
      return card("Erros recentes", vazio("Nenhum erro na janela", "Nem no servidor nem no navegador."));
    }
    return card("Erros recentes",
      '<div class="vf-table-wrap"><table class="vf-table vf-table--compact">' +
      '<thead><tr><th>origem</th><th>tipo</th><th>rota / tela</th><th class="num">total</th><th>última</th><th></th></tr></thead>' +
      '<tbody>' + grupos.map(function (grupo) {
        return '<tr>' +
          '<td>' + tag(grupo.origem === "server" ? "servidor" : "navegador", grupo.origem === "server" ? "is-info" : "is-primary") + '</td>' +
          '<td class="vf-mono vf-truncate" title="' + E(grupo.mensagem) + '">' + E(grupo.tipo) + '</td>' +
          '<td class="vf-mono vf-truncate" title="' + E(grupo.rota) + '">' + E(grupo.rota) + '</td>' +
          '<td class="num">' + E(grupo.total) + '</td>' +
          '<td>' + E(S.formatarRelativo(grupo.ultima)) + '</td>' +
          '<td class="vf-table__actions">' + (grupo.ultimoRequestId
            ? '<button class="vf-btn vf-btn--ghost vf-btn--sm" type="button" data-cc-request="' + E(grupo.ultimoRequestId) + '">inspecionar</button>'
            : '<span class="vfc-muted">sem request id</span>') + '</td>' +
          '</tr>';
      }).join("") + '</tbody></table></div>',
      '<button class="vf-btn vf-btn--ghost vf-btn--sm" type="button" data-cc-view="errors">Abrir Erros</button>');
  }

  function avisoSomenteLocal(state) {
    return '<div class="vf-banner is-warning" role="status"><div class="vf-banner__content">' +
      '<p class="vf-banner__title">Somente dados locais</p>' +
      '<p class="vf-banner__description">O histórico do servidor não respondeu, mas ' +
      E(state.local.eventos.length) + ' eventos capturados neste navegador continuam disponíveis na visão Navegador.</p>' +
      '</div><div class="vf-banner__actions">' +
      '<button class="vf-btn vf-btn--secondary vf-btn--sm" type="button" data-cc-view="browser">Ver eventos locais</button>' +
      '</div></div>';
  }

  function card(titulo, corpo, acoes) {
    return '<section class="vf-card vfc-card">' +
      '<header class="vf-card__header"><h2 class="vf-card__title">' + E(titulo) + '</h2>' +
      (acoes ? '<div class="vf-section__actions">' + acoes + '</div>' : "") + '</header>' +
      '<div class="vf-card__body">' + corpo + '</div></section>';
  }

  /* ============================================================
   * REQUESTS
   * ============================================================ */

  function requests(state) {
    return toolbarRequests(state) +
      (state.falhas.requests ? falha(state.falhas.requests, "requests") : "") +
      tabelaRequests(state) +
      paginacao(state);
  }

  function toolbarRequests(state) {
    var f = state.filtros;
    var chips = [
      ["", "Todas"],
      ["success", "Sucesso"],
      ["4xx", "4xx"],
      ["5xx", "5xx"],
      ["network", "Rede"]
    ].map(function (par) {
      return '<button class="vf-filter-chip' + (f.status === par[0] ? " is-active" : "") + '"' +
        ' type="button" data-cc-status="' + par[0] + '">' + E(par[1]) + '</button>';
    }).join("");

    var telas = telasConhecidas(state);

    return '<div class="vf-toolbar vfc-toolbar">' +
      '<div class="vf-toolbar__filters">' +
      '<label class="vf-visually-hidden" for="cc-busca">Buscar em requests</label>' +
      '<input class="vf-input vf-input--sm vfc-busca" id="cc-busca" type="search" placeholder="rota, request id, e-mail, erro…" value="' + E(f.search) + '" data-cc-input="search">' +
      chips +
      '<button class="vf-filter-chip' + (f.onlySlow ? " is-active" : "") + '" type="button" data-cc-toggle="onlySlow">Lentas</button>' +
      '<button class="vf-filter-chip' + (f.onlyErrors ? " is-active" : "") + '" type="button" data-cc-toggle="onlyErrors">Só erros</button>' +
      '<select class="vf-select vf-select--sm" data-cc-input="source" aria-label="Origem">' +
      opcoes([["", "Origem: todas"], ["server", "Servidor"], ["browser", "Navegador"]], f.source) +
      '</select>' +
      '<select class="vf-select vf-select--sm" data-cc-input="method" aria-label="Método">' +
      opcoes([["", "Método: todos"], ["GET", "GET"], ["POST", "POST"], ["PUT", "PUT"], ["PATCH", "PATCH"], ["DELETE", "DELETE"]], f.method) +
      '</select>' +
      '<select class="vf-select vf-select--sm" data-cc-input="screen" aria-label="Tela">' +
      opcoes([["", "Tela: todas"]].concat(telas.map(function (t) { return [t, t]; })), f.screen) +
      '</select>' +
      '<input class="vf-input vf-input--sm vfc-filtro-curto" type="text" placeholder="rota contém…" value="' + E(f.route) + '" data-cc-input="route" aria-label="Filtrar por rota">' +
      '<input class="vf-input vf-input--sm vfc-filtro-curto" type="text" placeholder="usuário…" value="' + E(f.user) + '" data-cc-input="user" aria-label="Filtrar por usuário">' +
      (temFiltroAtivo(f) ? '<button class="vf-clear-filters" type="button" data-cc-action="clear-filters">limpar filtros</button>' : "") +
      '</div>' +
      '<div class="vf-toolbar__actions">' +
      '<span class="vfc-muted" aria-live="polite">' + E(S.formatarNumero(state.requests.total)) + ' registros</span>' +
      '<select class="vf-select vf-select--sm" data-cc-input="limit" aria-label="Itens por página">' +
      opcoes([[25, "25/pág"], [50, "50/pág"], [100, "100/pág"], [200, "200/pág"]], String(f.limit)) +
      '</select>' +
      '</div></div>';
  }

  function temFiltroAtivo(f) {
    return !!(f.search || f.method || f.status || f.source || f.route || f.screen || f.user || f.sessionId || f.onlyErrors || f.onlySlow);
  }

  function telasConhecidas(state) {
    var vistas = {};
    (state.requests.linhas || []).forEach(function (linha) { if (linha.page) vistas[linha.page] = true; });
    (state.local.eventos || []).forEach(function (evento) { if (evento.page) vistas[evento.page] = true; });
    if (state.filtros.screen) vistas[state.filtros.screen] = true;
    return Object.keys(vistas).sort();
  }

  function opcoes(pares, selecionado) {
    return pares.map(function (par) {
      var valor = String(par[0]);
      return '<option value="' + E(valor) + '"' + (String(selecionado) === valor ? " selected" : "") + '>' + E(par[1]) + '</option>';
    }).join("");
  }

  function cabecalhoOrdenavel(state, coluna, rotulo, extraClasse) {
    var ativo = state.filtros.sortBy === coluna;
    var classe = ativo ? (state.filtros.sortDir === "asc" ? " is-asc" : " is-desc") : "";
    return '<th class="' + (extraClasse || "") + '"' + (ativo ? ' aria-sort="' + (state.filtros.sortDir === "asc" ? "ascending" : "descending") + '"' : "") + '>' +
      '<button class="vf-table__sort' + classe + '" type="button" data-cc-sort="' + coluna + '">' + E(rotulo) + '</button></th>';
  }

  function tabelaRequests(state) {
    if (state.carregando.requests && !state.requests.linhas.length) {
      return '<div class="vf-table-wrap">' + carregando("Consultando requests…") + '</div>';
    }
    if (!state.requests.linhas.length) {
      if (state.falhas.requests) return "";
      return '<div class="vf-table-wrap">' + vazio(
        temFiltroAtivo(state.filtros) ? "Nenhuma request para estes filtros" : "Nenhuma request na janela",
        temFiltroAtivo(state.filtros)
          ? "Nada corresponde aos filtros atuais. Limpe os filtros ou amplie a janela de tempo."
          : "Nenhuma request do servidor nem do navegador foi registrada neste período.",
        temFiltroAtivo(state.filtros)
          ? '<button class="vf-btn vf-btn--secondary vf-btn--sm" type="button" data-cc-action="clear-filters">Limpar filtros</button>'
          : ""
      ) + '</div>';
    }

    var eventosLocais = {};
    (state.local.eventos || []).forEach(function (evento) {
      if (evento.requestId) eventosLocais[evento.requestId] = true;
    });

    return '<div class="vf-table-wrap vfc-table-wrap">' +
      '<table class="vf-table vf-table--compact vfc-tabela-requests">' +
      '<caption class="vf-visually-hidden">Requests do servidor e do navegador na janela selecionada</caption>' +
      '<thead><tr>' +
      cabecalhoOrdenavel(state, "created_at", "hora") +
      '<th>origem</th><th>tela</th><th>método</th>' +
      cabecalhoOrdenavel(state, "route", "endpoint") +
      cabecalhoOrdenavel(state, "status_code", "status", "num") +
      cabecalhoOrdenavel(state, "duration_ms", "tempo", "num") +
      '<th>usuário</th><th>request id</th><th></th>' +
      '</tr></thead><tbody>' +
      state.requests.linhas.map(function (linha) {
        var lenta = Number(linha.duration_ms) >= state.requests.slowMs;
        var selecionada = state.selecionado && state.selecionado.requestId === linha.request_id;
        var correlacionada = eventosLocais[linha.request_id];
        return '<tr class="' + (selecionada ? "row--selected " : "") +
          (Number(linha.status_code) >= 500 ? "row--danger" : Number(linha.status_code) >= 400 ? "row--warning" : "") + '"' +
          ' tabindex="0" data-cc-request="' + E(linha.request_id) + '">' +
          '<td class="vf-mono">' + E(S.formatarHora(linha.created_at)) + '</td>' +
          '<td>' + tag(linha.source === "server" ? "servidor" : "navegador", linha.source === "server" ? "is-info" : "is-primary") + '</td>' +
          '<td class="vf-truncate" title="' + E(linha.page || "") + '">' + E(linha.page || "—") + '</td>' +
          '<td><span class="vfc-metodo">' + E(linha.method) + '</span></td>' +
          '<td class="vf-mono vf-truncate" title="' + E(linha.route) + '">' + E(linha.route) + '</td>' +
          '<td class="num"><span class="vfc-status-pill ' + S.classeStatus(linha.status_code) + '">' + E(S.rotuloStatus(linha.status_code)) + '</span></td>' +
          '<td class="num' + (lenta ? " vfc-lenta" : "") + '">' + E(S.formatarDuracao(linha.duration_ms)) + '</td>' +
          '<td class="vf-truncate" title="' + E(linha.user_email || "") + '">' + E(linha.user_email || "—") + '</td>' +
          '<td class="vf-mono vfc-request-id" title="' + E(linha.request_id) + '">' + E(String(linha.request_id || "").slice(0, 8)) + '</td>' +
          '<td>' + (correlacionada ? '<span class="vfc-elo" title="Existem eventos deste navegador correlacionados">⇄</span>' : "") + '</td>' +
          '</tr>';
      }).join("") +
      '</tbody></table></div>';
  }

  function paginacao(state) {
    var r = state.requests;
    if (!r.total) return "";
    var inicio = (r.page - 1) * state.filtros.limit + 1;
    var fim = Math.min(r.page * state.filtros.limit, r.total);
    return '<div class="vf-pagination">' +
      '<span class="vf-pagination__info">' + E(inicio) + '–' + E(fim) + ' de ' + E(S.formatarNumero(r.total)) + '</span>' +
      '<div class="vf-pagination__actions">' +
      '<button class="vf-btn vf-btn--secondary vf-btn--sm" type="button" data-cc-page="' + (r.page - 1) + '"' + (r.page <= 1 ? " disabled" : "") + '>← anterior</button>' +
      '<span class="vf-pagination__info">página ' + E(r.page) + ' de ' + E(r.totalPages) + '</span>' +
      '<button class="vf-btn vf-btn--secondary vf-btn--sm" type="button" data-cc-page="' + (r.page + 1) + '"' + (r.page >= r.totalPages ? " disabled" : "") + '>próxima →</button>' +
      '</div></div>';
  }

  /* ============================================================
   * ERRORS
   * ============================================================ */

  function errors(state) {
    if (state.falhas.erros) return falha(state.falhas.erros, "erros");
    if (state.carregando.erros && !state.erros.grupos.length) return carregando("Agrupando erros…");
    if (!state.erros.grupos.length) {
      return vazio("Nenhum erro agrupado", "Nem o servidor nem o navegador registraram erro nesta janela.");
    }

    var marcas = S.lerMarcacoes();

    return '<p class="vfc-nota">Erros do servidor, HTTP, JavaScript, promises rejeitadas e falhas de rede, agrupados por assinatura. As marcações abaixo são locais deste navegador — não viram workflow no servidor nem issue no GitHub.</p>' +
      '<div class="vfc-erros">' +
      state.erros.grupos.map(function (grupo) {
        var marca = marcas[grupo.assinatura];
        return '<article class="vf-card vfc-erro' + (marca ? " is-" + E(marca.situacao) : "") + '">' +
          '<header class="vfc-erro__topo">' +
          '<div class="vfc-erro__titulo">' +
          tag(grupo.origem === "server" ? "servidor" : "navegador", grupo.origem === "server" ? "is-info" : "is-primary") +
          tag(grupo.tipo, grupo.severidade === "alta" ? "is-danger" : "is-warning") +
          (grupo.status ? tag("HTTP " + grupo.status, S.classeStatus(grupo.status)) : "") +
          (marca ? tag(marca.situacao, "is-neutral") : "") +
          '</div>' +
          '<div class="vfc-erro__contagem"><strong>' + E(S.formatarNumero(grupo.total)) + '</strong><span>ocorrências</span></div>' +
          '</header>' +
          '<p class="vfc-erro__mensagem">' + E(grupo.mensagem) + '</p>' +
          '<dl class="vfc-kv vfc-kv--inline">' +
          '<dt>rota / tela</dt><dd class="vf-mono">' + E(grupo.rota) + '</dd>' +
          '<dt>método</dt><dd>' + E(grupo.metodo || "—") + '</dd>' +
          '<dt>afetados</dt><dd>' + E(grupo.usuarios) + (grupo.origem === "server" ? " usuários" : " sessões") + '</dd>' +
          '<dt>primeira</dt><dd>' + E(S.formatarDataHora(grupo.primeira)) + '</dd>' +
          '<dt>última</dt><dd>' + E(S.formatarDataHora(grupo.ultima)) + ' (' + E(S.formatarRelativo(grupo.ultima)) + ')</dd>' +
          '</dl>' +
          (grupo.stack ? '<details class="vfc-detalhes"><summary>stack sanitizada</summary><pre class="vfc-code">' + E(grupo.stack) + '</pre></details>' : "") +
          '<footer class="vfc-erro__acoes">' +
          (grupo.ultimoRequestId
            ? '<button class="vf-btn vf-btn--secondary vf-btn--sm" type="button" data-cc-request="' + E(grupo.ultimoRequestId) + '">inspecionar última</button>'
            : "") +
          '<button class="vf-btn vf-btn--ghost vf-btn--sm" type="button" data-cc-action="filter-route" data-cc-value="' + E(grupo.rota) + '">ver requests da rota</button>' +
          '<span class="vfc-erro__marcas">' +
          ["investigando", "ignorado", "resolvido"].map(function (situacao) {
            var ativo = marca && marca.situacao === situacao;
            return '<button class="vf-filter-chip' + (ativo ? " is-active" : "") + '" type="button"' +
              ' data-cc-mark="' + E(grupo.assinatura) + '" data-cc-mark-state="' + situacao + '">' + E(situacao) + '</button>';
          }).join("") +
          '</span></footer></article>';
      }).join("") +
      '</div>';
  }

  /* ============================================================
   * BROWSER
   * ============================================================ */

  function browser(state) {
    var runtime = state.local.runtime;
    if (!runtime) {
      return falha({ erro: "O coletor não está carregado nesta página.", tipo: "erro" }, "navegador");
    }

    var stats = state.local.stats || { total: 0, naoSincronizados: 0, porTipo: {}, sessoes: {}, abas: {}, paginas: {} };

    var estadoIdb = runtime.indexedDb === "ok"
      ? status("IndexedDB ok", "is-success")
      : status("IndexedDB " + runtime.indexedDb + " — usando memória volátil", "is-warning");

    var cabecalho = '<div class="vf-kpi-grid">' +
      kpi("eventos locais", S.formatarNumero(stats.total), "limite " + runtime.limiteEventos) +
      kpi("não sincronizados", S.formatarNumero(stats.naoSincronizados),
        runtime.ultimoSyncErro ? "último erro: " + runtime.ultimoSyncErro : "fila para o servidor",
        stats.naoSincronizados ? "vf-kpi--warning" : "") +
      kpi("sessões", S.formatarNumero(Object.keys(stats.sessoes || {}).length), "nesta origem") +
      kpi("abas", S.formatarNumero(Object.keys(stats.abas || {}).length), "com eventos gravados") +
      kpi("páginas", S.formatarNumero(Object.keys(stats.paginas || {}).length), "telas capturadas") +
      kpi("armazenamento", stats.armazenamento && stats.armazenamento.usadoMb !== null
        ? stats.armazenamento.usadoMb + " MB" : "—",
        stats.armazenamento && stats.armazenamento.cotaMb ? "cota " + stats.armazenamento.cotaMb + " MB" : "estimativa indisponível") +
      '</div>';

    var runtimeCard = card("Estado do coletor",
      '<dl class="vfc-kv">' +
      '<dt>coletor</dt><dd>' + (runtime.ativo ? status("ativo", "is-success") : status("inativo", "is-neutral")) + '</dd>' +
      '<dt>armazenamento</dt><dd>' + estadoIdb + '</dd>' +
      '<dt>BroadcastChannel</dt><dd>' + (runtime.broadcastChannel
        ? status("disponível — abas em tempo real", "is-success")
        : status("indisponível — usando sinal por localStorage", "is-warning")) + '</dd>' +
      '<dt>interceptadores</dt><dd>' +
      (runtime.fetchInterceptado ? tag("fetch", "is-success") : tag("fetch off", "is-neutral")) + " " +
      (runtime.xhrInterceptado ? tag("XHR", "is-success") : tag("XHR off", "is-neutral")) + " " +
      (runtime.errosInterceptados ? tag("erros JS", "is-success") : tag("erros JS off", "is-neutral")) +
      '</dd>' +
      '<dt>session id</dt><dd class="vf-mono">' + E(runtime.sessionId) + '</dd>' +
      '<dt>tab id</dt><dd class="vf-mono">' + E(runtime.tabId) + '</dd>' +
      '<dt>page load id</dt><dd class="vf-mono">' + E(runtime.pageLoadId) + '</dd>' +
      '<dt>último sync</dt><dd>' + E(runtime.ultimoSync ? S.formatarDataHora(runtime.ultimoSync) : "nunca") + '</dd>' +
      '<dt>último erro de sync</dt><dd>' + E(runtime.ultimoSyncErro || "nenhum") + '</dd>' +
      '<dt>console.error</dt><dd>' + (runtime.config.captureConsole
        ? status("capturado", "is-success") : status("não capturado", "is-neutral")) +
      ' <button class="vfc-link" type="button" data-cc-action="toggle-console">alternar</button></dd>' +
      '</dl>',
      '<button class="vf-btn vf-btn--secondary vf-btn--sm" type="button" data-cc-action="force-sync">forçar sincronização</button>' +
      '<button class="vf-btn vf-btn--ghost vf-btn--sm" type="button" data-cc-action="export-local">exportar eventos locais</button>' +
      '<button class="vf-btn vf-btn--danger vf-btn--sm" type="button" data-cc-action="clear-local">limpar cache local</button>');

    var testes = card("Testes controlados",
      '<p class="vfc-nota">Estes botões geram eventos marcados como <strong>teste</strong>. Nenhum erro real é provocado no backend e nada é alterado no banco.</p>' +
      (state.ferramentas.testes && state.ferramentas.testes.browser
        ? '<pre class="vfc-code">' + E(S.formatarJson(state.ferramentas.testes.browser)) + '</pre>' : ""),
      '<button class="vf-btn vf-btn--secondary vf-btn--sm" type="button" data-cc-action="test-error">disparar erro de teste</button>' +
      '<button class="vf-btn vf-btn--secondary vf-btn--sm" type="button" data-cc-action="test-request">testar GET /health</button>');

    var sessoesServidor = card("Sessões vistas pelo servidor",
      state.sessoes.length
        ? '<div class="vf-table-wrap"><table class="vf-table vf-table--compact">' +
        '<thead><tr><th>sessão</th><th>usuário</th><th class="num">eventos</th><th class="num">abas</th><th class="num">erros</th><th>última página</th><th>fim</th><th></th></tr></thead><tbody>' +
        state.sessoes.map(function (sessao) {
          return '<tr>' +
            '<td class="vf-mono vf-truncate" title="' + E(sessao.session_id) + '">' + E(String(sessao.session_id).slice(0, 12)) + '</td>' +
            '<td class="vf-truncate">' + E(sessao.user_email || "—") + '</td>' +
            '<td class="num">' + E(sessao.eventos) + '</td>' +
            '<td class="num">' + E(sessao.abas) + '</td>' +
            '<td class="num">' + E(sessao.erros) + '</td>' +
            '<td class="vf-truncate">' + E(sessao.ultima_pagina || "—") + '</td>' +
            '<td>' + E(S.formatarRelativo(sessao.fim)) + '</td>' +
            '<td class="vf-table__actions"><button class="vf-btn vf-btn--ghost vf-btn--sm" type="button" data-cc-action="filter-session" data-cc-value="' + E(sessao.session_id) + '">ver requests</button></td>' +
            '</tr>';
        }).join("") + '</tbody></table></div>'
        : vazio("Nenhuma sessão persistida", "Nenhum evento de navegador chegou ao servidor nesta janela."));

    var eventos = card("Eventos locais recentes",
      state.local.eventos.length
        ? '<div class="vf-table-wrap vfc-table-wrap"><table class="vf-table vf-table--compact">' +
        '<thead><tr><th>hora</th><th>tipo</th><th>sev.</th><th>página</th><th>mensagem</th><th>request id</th><th>sync</th></tr></thead><tbody>' +
        state.local.eventos.slice(0, 150).map(function (evento) {
          return '<tr' + (evento.requestId ? ' tabindex="0" data-cc-request="' + E(evento.requestId) + '"' : "") + '>' +
            '<td class="vf-mono">' + E(S.formatarHora(evento.timestamp)) + '</td>' +
            '<td>' + tag(evento.eventType, evento.severity === "error" ? "is-danger" : evento.severity === "warn" ? "is-warning" : "is-neutral") + '</td>' +
            '<td>' + E(evento.severity) + '</td>' +
            '<td class="vf-truncate">' + E(evento.page || "—") + '</td>' +
            '<td class="vf-truncate" title="' + E(evento.message || "") + '">' + E(evento.message || "—") + '</td>' +
            '<td class="vf-mono vfc-request-id" title="' + E(evento.requestId || "") + '">' + E(String(evento.requestId || "—").slice(0, 8)) + '</td>' +
            '<td>' + (evento.synced === 1 ? status("ok", "is-success") : status("pendente", "is-warning")) + '</td>' +
            '</tr>';
        }).join("") + '</tbody></table></div>'
        : vazio("Nenhum evento local",
          runtime.ativo
            ? "O coletor está ligado mas ainda não capturou nada nesta origem. Navegue pelo Portal para gerar eventos."
            : "O coletor está desligado. Ligue o debug do navegador para começar a capturar.",
          runtime.ativo ? "" : '<button class="vf-btn vf-btn--primary vf-btn--sm" type="button" data-cc-action="toggle-debug">Ligar debug</button>'));

    return cabecalho + '<div class="vfc-grid-2">' + runtimeCard + testes + '</div>' + eventos + sessoesServidor;
  }

  /* ============================================================
   * HEALTH
   * ============================================================ */

  function health(state) {
    if (state.falhas.saude) return falha(state.falhas.saude, "health");
    if (!state.saude) return carregando("Consultando saúde do servidor…");

    var s = state.saude;
    var testes = (state.testesSaude && state.testesSaude.resultados) || {};

    function cardSaude(titulo, estado, linhas, alvoTeste) {
      var classes = {
        saudavel: "is-success", atencao: "is-warning", falha: "is-danger",
        nao_configurado: "is-neutral", nao_testado: "is-neutral", indisponivel: "is-danger"
      };
      return '<article class="vf-card vfc-card-saude">' +
        '<header class="vf-card__header">' +
        '<h3 class="vf-card__title">' + E(titulo) + '</h3>' +
        status(estado.replace(/_/g, " "), classes[estado] || "is-neutral") +
        '</header>' +
        '<div class="vf-card__body"><dl class="vfc-kv">' +
        linhas.map(function (par) { return '<dt>' + E(par[0]) + '</dt><dd>' + (par[2] ? par[1] : E(par[1])) + '</dd>'; }).join("") +
        '</dl></div>' +
        (alvoTeste ? '<footer class="vf-card__footer">' +
          '<button class="vf-btn vf-btn--secondary vf-btn--sm" type="button" data-cc-health-check="' + E(alvoTeste) + '"' +
          (state.carregando["teste-" + alvoTeste] ? " disabled" : "") + '>' +
          (state.carregando["teste-" + alvoTeste] ? "testando…" : "testar agora") + '</button>' +
          '</footer>' : "") +
        '</article>';
    }

    function resultadoTeste(alvo) {
      var teste = testes[alvo];
      if (!teste) return "não testado nesta sessão";
      return teste.resultado + " · " + (teste.detalhe || "") +
        (teste.latenciaMs !== undefined && teste.latenciaMs !== null ? " · " + teste.latenciaMs + "ms" : "") +
        " · " + S.formatarRelativo(teste.executadoEm);
    }

    var cards = [];

    cards.push(cardSaude("API", s.api.status, [
      ["ambiente", s.api.ambiente],
      ["node", s.api.node],
      ["plataforma", s.api.plataforma],
      ["uptime", Math.floor(s.api.uptimeSegundos / 3600) + "h " + Math.floor((s.api.uptimeSegundos % 3600) / 60) + "min"],
      ["hora do servidor", S.formatarDataHora(s.api.horaServidor)],
      ["versão/commit", s.api.versao || "não informada"]
    ]));

    cards.push(cardSaude("PostgreSQL", s.banco.status, [
      ["latência (SELECT 1)", s.banco.latenciaMs !== null ? s.banco.latenciaMs + "ms" : "—"],
      ["erro", s.banco.erro || "nenhum"],
      ["último teste", resultadoTeste("postgres")]
    ], "postgres"));

    cards.push(cardSaude("Pool de conexões", s.banco.pool ? "saudavel" : "indisponivel", [
      ["total", s.banco.pool ? s.banco.pool.total : "—"],
      ["ociosas", s.banco.pool ? s.banco.pool.ociosas : "—"],
      ["aguardando", s.banco.pool ? s.banco.pool.aguardando : "—"]
    ]));

    cards.push(cardSaude("Memória", s.api.memoria.heapUsadoMb > 400 ? "atencao" : "saudavel", [
      ["heap usado", s.api.memoria.heapUsadoMb + " MB"],
      ["heap total", s.api.memoria.heapTotalMb + " MB"],
      ["RSS", s.api.memoria.rssMb + " MB"],
      ["livre no sistema", s.api.memoria.sistemaLivreMb + " MB"]
    ]));

    var obs = s.observabilidade;
    cards.push(cardSaude("Observabilidade", obs.habilitada ? "saudavel" : "nao_configurado", [
      ["ingestão do navegador", obs.eventosNavegador ? "ligada" : "desligada"],
      ["captura de stack", obs.capturaStack ? "ligada" : "desligada"],
      ["retenção", obs.retencaoDias + " dias / máx " + S.formatarNumero(obs.maxLinhas) + " linhas"],
      ["limite de lentidão", obs.slowMs + "ms"],
      ["requests persistidas", obs.armazenamento ? S.formatarNumero(obs.armazenamento.requests) : "—"],
      ["eventos persistidos", obs.armazenamento ? S.formatarNumero(obs.armazenamento.client_events) : "—"],
      ["mais antigo", obs.armazenamento && obs.armazenamento.request_mais_antiga ? S.formatarDataHora(obs.armazenamento.request_mais_antiga) : "—"],
      ["último teste", resultadoTeste("observabilidade")]
    ], "observabilidade"));

    cards.push(cardSaude("Fila de logs", obs.fila.falhasConsecutivas ? "atencao" : "saudavel", [
      ["pendentes", obs.fila.pendentes],
      ["gravados (requests)", S.formatarNumero(obs.fila.gravados.requests)],
      ["gravados (eventos)", S.formatarNumero(obs.fila.gravados.clientEvents)],
      ["descartados", S.formatarNumero(obs.fila.descartados) + " (" + obs.fila.descartadosPorFila + " por fila cheia, " + obs.fila.descartadosPorErro + " por erro)"],
      ["falhas consecutivas", obs.fila.falhasConsecutivas],
      ["último erro", obs.fila.ultimoErro || "nenhum"],
      ["último flush", obs.fila.ultimoFlushEm ? S.formatarRelativo(obs.fila.ultimoFlushEm) : "—"]
    ]));

    (s.integracoes || []).forEach(function (integracao) {
      if (integracao.id === "postgres") return;
      var teste = testes[integracao.id];
      var estado = teste
        ? (teste.resultado === "ok" ? "saudavel" : teste.resultado === "nao_configurado" ? "nao_configurado" : "falha")
        : (integracao.configuracao === "configurado" ? "nao_testado"
          : integracao.configuracao === "parcial" ? "atencao" : "nao_configurado");

      cards.push(cardSaude(integracao.nome, estado, [
        ["configuração", integracao.configuracao.replace(/_/g, " ")],
        ["variáveis", integracao.variaveis.map(function (v) {
          return '<span class="vf-tag ' + (v.presente ? "is-success" : "is-neutral") + '">' + E(v.nome) + ': ' + (v.presente ? "presente" : "ausente") + '</span>';
        }).join(" "), true],
        ["último teste", resultadoTeste(integracao.id)],
        ["observação", integracao.nota || (integracao.testavel ? "teste ativo disponível" : "sem teste ativo — só verificação de configuração")]
      ], integracao.testavel ? integracao.id : null));
    });

    return '<div class="vf-banner is-info"><div class="vf-banner__content">' +
      '<p class="vf-banner__title">Configuração presente ≠ integração saudável</p>' +
      '<p class="vf-banner__description">A leitura automática só verifica se as variáveis existem — nenhum valor de token é lido nem exibido. Chamadas externas só acontecem quando você clica em “testar agora”.</p>' +
      '</div><div class="vf-banner__actions">' +
      '<button class="vf-btn vf-btn--secondary vf-btn--sm" type="button" data-cc-health-check="todos"' +
      (state.carregando["teste-todos"] ? " disabled" : "") + '>' +
      (state.carregando["teste-todos"] ? "testando…" : "testar todas") + '</button></div></div>' +
      '<div class="vfc-grid-saude">' + cards.join("") + '</div>';
  }

  /* ============================================================
   * ROUTES
   * ============================================================ */

  function routes(state) {
    if (state.falhas.rotas) return falha(state.falhas.rotas, "rotas");
    if (!state.rotas) return carregando("Lendo o inventário de rotas…");

    if (!state.rotas.ok) {
      return '<div class="vf-banner is-warning"><div class="vf-banner__content">' +
        '<p class="vf-banner__title">Inventário indisponível</p>' +
        '<p class="vf-banner__description">' + E(state.rotas.motivo || "a introspecção do Express não pôde ser concluída") + '. Nada é inventado aqui: preferimos não exibir a exibir rota errada.</p>' +
        '</div></div>';
    }

    var estatisticas = {};
    (state.rotasStats || []).forEach(function (linha) {
      var chave = linha.method + " " + linha.rota;
      estatisticas[chave] = linha;
    });

    var filtro = state.filtros.route.toLowerCase();
    var rotas = state.rotas.rotas.filter(function (rota) {
      if (!filtro) return true;
      return (rota.caminho + " " + rota.metodo + " " + rota.area).toLowerCase().indexOf(filtro) !== -1;
    });

    var areas = {};
    state.rotas.rotas.forEach(function (rota) { areas[rota.area] = true; });

    return '<div class="vf-toolbar vfc-toolbar">' +
      '<div class="vf-toolbar__filters">' +
      '<input class="vf-input vf-input--sm" type="search" placeholder="filtrar rota, método ou área…" value="' + E(state.filtros.route) + '" data-cc-input="route" aria-label="Filtrar rotas">' +
      '<select class="vf-select vf-select--sm" data-cc-input="route" aria-label="Área">' +
      opcoes([["", "Área: todas"]].concat(Object.keys(areas).sort().map(function (a) { return [a, a]; })), state.filtros.route) +
      '</select>' +
      '</div>' +
      '<div class="vf-toolbar__actions"><span class="vfc-muted">' + E(rotas.length) + ' de ' + E(state.rotas.total) + ' rotas</span></div>' +
      '</div>' +
      '<p class="vfc-nota">Autenticação e admin-only são inferidos dos middlewares registrados na rota. Quando a introspecção não é confiável, a rota aparece como <strong>desconhecido</strong> em vez de um palpite.</p>' +
      '<div class="vf-table-wrap vfc-table-wrap"><table class="vf-table vf-table--compact">' +
      '<thead><tr><th>método</th><th>caminho</th><th>área</th><th>auth</th><th>admin</th>' +
      '<th class="num">chamadas</th><th class="num">erros</th><th class="num">média</th><th class="num">p95</th><th>última</th><th></th></tr></thead><tbody>' +
      (rotas.length ? rotas.map(function (rota) {
        var stat = estatisticas[rota.metodo + " " + rota.caminho] || null;
        var taxaErro = stat && stat.total ? (stat.erros / stat.total) * 100 : 0;
        return '<tr class="' + (taxaErro > 20 ? "row--danger" : taxaErro > 5 ? "row--warning" : "") + '">' +
          '<td><span class="vfc-metodo">' + E(rota.metodo) + '</span></td>' +
          '<td class="vf-mono vf-truncate" title="' + E(rota.caminho) + '">' + E(rota.caminho) + '</td>' +
          '<td>' + E(rota.area) + '</td>' +
          '<td>' + E(rota.autenticacao) + '</td>' +
          '<td>' + E(rota.adminOnly) + '</td>' +
          '<td class="num">' + (stat ? E(S.formatarNumero(stat.total)) : "—") + '</td>' +
          '<td class="num">' + (stat ? E(stat.erros) + " (" + taxaErro.toFixed(0) + "%)" : "—") + '</td>' +
          '<td class="num">' + (stat ? E(S.formatarDuracao(stat.media)) : "—") + '</td>' +
          '<td class="num">' + (stat ? E(S.formatarDuracao(stat.p95)) : "—") + '</td>' +
          '<td>' + (stat ? E(S.formatarRelativo(stat.ultima)) : "—") + '</td>' +
          '<td class="vf-table__actions">' +
          '<button class="vf-btn vf-btn--ghost vf-btn--sm" type="button" data-cc-action="filter-route" data-cc-value="' + E(rota.caminho) + '">requests</button>' +
          (rota.metodo === "GET" && rota.caminho.indexOf(":") === -1
            ? '<button class="vf-btn vf-btn--ghost vf-btn--sm" type="button" data-cc-action="test-get" data-cc-value="' + E(rota.caminho) + '">testar GET</button>'
            : "") +
          '</td></tr>';
      }).join("") : '<tr class="vf-table__empty"><td colspan="11">Nenhuma rota corresponde ao filtro.</td></tr>') +
      '</tbody></table></div>' +
      (state.ferramentas.testes && state.ferramentas.testes.rota
        ? card("Resultado do último teste GET", '<pre class="vfc-code">' + E(S.formatarJson(state.ferramentas.testes.rota)) + '</pre>')
        : "");
  }

  /* ============================================================
   * TOOLS
   * ============================================================ */

  function tools(state) {
    var jwt = S.decodificarJwt();
    var usuario = window.VFCApi.user();
    var runtime = state.local.runtime || {};
    var saude = state.saude;

    var difRelogio = "—";
    if (saude && saude.api && saude.api.horaServidor) {
      var diff = Date.now() - new Date(saude.api.horaServidor).getTime();
      difRelogio = (diff >= 0 ? "+" : "") + Math.round(diff / 1000) + "s (cliente − servidor, inclui latência)";
    }

    var sessao = card("Diagnóstico de sessão",
      '<dl class="vfc-kv">' +
      '<dt>token</dt><dd>' + (jwt.presente ? status("presente (nunca exibido)", "is-success") : status("ausente", "is-danger")) + '</dd>' +
      '<dt>usuário</dt><dd>' + E(usuario.nome || usuario.email || "—") + '</dd>' +
      '<dt>role</dt><dd>' + E(usuario.role || "—") + '</dd>' +
      '<dt>expiração do JWT</dt><dd>' + E(jwt.decodificavel
        ? (jwt.expiraEm ? S.formatarDataHora(jwt.expiraEm) + (jwt.expirado ? " — EXPIRADO" : "") : "sem claim exp")
        : "não decodificável localmente") + '</dd>' +
      '<dt>API base</dt><dd class="vf-mono">' + E(window.VFCApi.apiBase()) + '</dd>' +
      '<dt>ambiente do servidor</dt><dd>' + E(saude && saude.api ? saude.api.ambiente : "—") + '</dd>' +
      '<dt>hora do cliente</dt><dd>' + E(S.formatarDataHora(new Date().toISOString())) + '</dd>' +
      '<dt>hora do servidor</dt><dd>' + E(saude && saude.api ? S.formatarDataHora(saude.api.horaServidor) : "—") + '</dd>' +
      '<dt>diferença de relógio</dt><dd>' + E(difRelogio) + '</dd>' +
      '<dt>navegador</dt><dd class="vf-truncate" title="' + E(navigator.userAgent) + '">' + E(navigator.userAgent) + '</dd>' +
      '</dl>');

    var testes = card("Testes rápidos",
      '<p class="vfc-nota">Todos são somente leitura (GET) contra a API configurada. Nenhum dado é alterado.</p>' +
      (state.ferramentas.testes && state.ferramentas.testes.rapidos
        ? '<div class="vf-table-wrap"><table class="vf-table vf-table--compact"><thead><tr><th>teste</th><th>resultado</th><th class="num">status</th><th class="num">tempo</th><th>correlação</th></tr></thead><tbody>' +
        state.ferramentas.testes.rapidos.map(function (teste) {
          return '<tr><td class="vf-mono">' + E(teste.nome) + '</td>' +
            '<td>' + status(teste.ok ? "ok" : (teste.erro || "falhou"), teste.ok ? "is-success" : "is-danger") + '</td>' +
            '<td class="num">' + E(teste.status || 0) + '</td>' +
            '<td class="num">' + E(S.formatarDuracao(teste.duracaoMs)) + '</td>' +
            '<td>' + (teste.correlacao === undefined ? "—" : teste.correlacao
              ? status("X-Request-Id recebido", "is-success")
              : status("header não exposto pelo CORS", "is-warning")) + '</td></tr>';
        }).join("") + '</tbody></table></div>'
        : '<p class="vfc-muted">Nenhum teste executado nesta sessão.</p>'),
      '<button class="vf-btn vf-btn--primary vf-btn--sm" type="button" data-cc-action="run-tests"' +
      (state.carregando.testes ? " disabled" : "") + '>' +
      (state.carregando.testes ? "executando…" : "executar testes") + '</button>');

    var relatorio = card("Relatório de bug",
      '<p class="vfc-nota">Gera um bloco copiável com o contexto técnico. Token, senha e payload sensível nunca entram.</p>' +
      (state.ferramentas.relatorio
        ? '<pre class="vfc-code vfc-code--alto" id="cc-relatorio">' + E(state.ferramentas.relatorio) + '</pre>'
        : '<p class="vfc-muted">Selecione uma request (visão Requests) para incluí-la no relatório, ou gere sem request.</p>'),
      '<button class="vf-btn vf-btn--primary vf-btn--sm" type="button" data-cc-action="build-report">gerar relatório</button>' +
      (state.ferramentas.relatorio
        ? '<button class="vf-btn vf-btn--secondary vf-btn--sm" type="button" data-cc-action="copy-report">copiar</button>'
        : ""));

    var playground = card("Reexecução segura",
      '<p class="vfc-nota">Só <strong>GET</strong> em rotas internas da API configurada. POST, PUT, PATCH e DELETE estão desabilitados nesta entrega — reexecutar escrita a partir de um painel de debug é caminho fácil para corromper dados de produção.</p>' +
      '<div class="vfc-playground">' +
      '<span class="vfc-playground__metodo">GET</span>' +
      '<input class="vf-input vf-input--sm" type="text" id="cc-playground-path" placeholder="/health" value="' + E(state.ferramentas.caminhoTeste || "/health") + '" aria-label="Caminho para reexecutar">' +
      '<button class="vf-btn vf-btn--secondary vf-btn--sm" type="button" data-cc-action="playground-run">executar</button>' +
      '</div>' +
      '<div class="vfc-playground__desabilitados" aria-hidden="true">' +
      ["POST", "PUT", "PATCH", "DELETE"].map(function (m) {
        return '<button class="vf-btn vf-btn--sm" type="button" disabled title="Desabilitado nesta entrega por segurança">' + m + '</button>';
      }).join("") + '</div>' +
      (state.ferramentas.testes && state.ferramentas.testes.playground
        ? '<pre class="vfc-code">' + E(S.formatarJson(state.ferramentas.testes.playground)) + '</pre>' : ""));

    var manutencao = card("Retenção e limpeza",
      '<dl class="vfc-kv">' +
      '<dt>retenção do servidor</dt><dd>' + E(saude ? saude.observabilidade.retencaoDias + " dias" : "—") + ' <span class="vfc-muted">(OBSERVABILITY_RETENTION_DAYS)</span></dd>' +
      '<dt>limite de linhas</dt><dd>' + E(saude ? S.formatarNumero(saude.observabilidade.maxLinhas) : "—") + ' <span class="vfc-muted">(OBSERVABILITY_MAX_ROWS)</span></dd>' +
      '<dt>eventos locais</dt><dd>' + E(runtime.limiteEventos || "—") + ' no IndexedDB deste navegador</dd>' +
      '</dl>' +
      '<div class="vf-banner is-warning"><div class="vf-banner__content">' +
      '<p class="vf-banner__title">Duas limpezas diferentes</p>' +
      '<p class="vf-banner__description"><strong>Limpar cache local</strong> apaga apenas os eventos deste navegador. ' +
      '<strong>Excluir histórico do servidor</strong> apaga registros do PostgreSQL para todos os admins e não tem desfazer.</p>' +
      '</div></div>',
      '<button class="vf-btn vf-btn--secondary vf-btn--sm" type="button" data-cc-action="clear-local">limpar cache local do navegador</button>' +
      '<button class="vf-btn vf-btn--danger vf-btn--sm" type="button" data-cc-action="purge-server">excluir histórico do servidor…</button>');

    return '<div class="vfc-grid-2">' + sessao + testes + '</div>' +
      '<div class="vfc-grid-2">' + relatorio + playground + '</div>' + manutencao;
  }

  /* ============================================================
   * DRAWER DE DETALHE
   * ============================================================ */

  var ABAS_DETALHE = ["resumo", "request", "response", "erro", "timeline", "contexto"];

  function drawer(state) {
    var sel = state.selecionado;
    if (!sel) return "";

    var cabecalho = '<header class="vf-drawer__header">' +
      '<div class="vfc-drawer__titulo">' +
      '<h2 class="vf-drawer__title vf-mono vf-truncate">' + E(sel.requestId) + '</h2>' +
      '<p class="vfc-muted">' + E(sel.detalhe && sel.detalhe.servidor
        ? sel.detalhe.servidor.method + " " + (sel.detalhe.servidor.route || sel.detalhe.servidor.path)
        : "detalhe da request") + '</p>' +
      '</div>' +
      '<button class="vf-btn vf-btn--ghost vf-btn--icon" type="button" data-cc-action="close-drawer" aria-label="Fechar detalhe">✕</button>' +
      '</header>';

    if (state.detalheCarregando && !sel.detalhe) {
      return cabecalho + '<div class="vf-drawer__body">' + carregando("Buscando correlação…") + '</div>';
    }

    if (state.detalheErro) {
      return cabecalho + '<div class="vf-drawer__body">' +
        falha(state.detalheErro, "detalhe") +
        (state.local.eventos.some(function (e) { return e.requestId === sel.requestId; })
          ? '<p class="vfc-nota">Existem eventos locais para este request id. Abra a visão Navegador para vê-los.</p>' : "") +
        '</div>';
    }

    if (!sel.detalhe) {
      return cabecalho + '<div class="vf-drawer__body">' + vazio("Sem detalhe", "Nada foi encontrado para este request id.") + '</div>';
    }

    var abasHtml = '<div class="vf-tabs vfc-tabs-drawer" role="tablist">' +
      ABAS_DETALHE.map(function (aba) {
        var ativo = state.abaDetalhe === aba;
        return '<button class="vf-tab' + (ativo ? " is-active" : "") + '" type="button" role="tab"' +
          ' aria-selected="' + (ativo ? "true" : "false") + '" data-cc-detail-tab="' + aba + '">' + E(aba) + '</button>';
      }).join("") + '</div>';

    return cabecalho +
      '<div class="vf-drawer__body">' + abasHtml + conteudoAbaDetalhe(state) + '</div>' +
      rodapeDrawer(state);
  }

  function rodapeDrawer(state) {
    var d = state.selecionado.detalhe;
    var servidor = d.servidor || {};
    var evento = d.eventoPrincipal || {};
    var rota = servidor.route || servidor.path || evento.endpoint || "";
    var pagina = evento.page || "";
    var podeReexecutar = String(servidor.method || evento.method || "").toUpperCase() === "GET" && rota && rota.indexOf(":") === -1;

    return '<footer class="vf-drawer__footer vfc-drawer__footer">' +
      '<button class="vf-btn vf-btn--ghost vf-btn--sm" type="button" data-cc-action="copy-request-id">copiar request id</button>' +
      '<button class="vf-btn vf-btn--ghost vf-btn--sm" type="button" data-cc-action="copy-endpoint">copiar endpoint</button>' +
      '<button class="vf-btn vf-btn--ghost vf-btn--sm" type="button" data-cc-action="copy-json">copiar JSON</button>' +
      '<button class="vf-btn vf-btn--ghost vf-btn--sm" type="button" data-cc-action="copy-curl">copiar curl</button>' +
      (pagina ? '<a class="vf-btn vf-btn--ghost vf-btn--sm" href="' + E(pagina) + '">abrir tela</a>' : "") +
      '<button class="vf-btn vf-btn--ghost vf-btn--sm" type="button" data-cc-action="filter-route" data-cc-value="' + E(rota) + '">mesma rota</button>' +
      (servidor.user_email ? '<button class="vf-btn vf-btn--ghost vf-btn--sm" type="button" data-cc-action="filter-user" data-cc-value="' + E(servidor.user_email) + '">mesmo usuário</button>' : "") +
      (evento.session_id ? '<button class="vf-btn vf-btn--ghost vf-btn--sm" type="button" data-cc-action="filter-session" data-cc-value="' + E(evento.session_id) + '">mesma sessão</button>' : "") +
      (podeReexecutar
        ? '<button class="vf-btn vf-btn--secondary vf-btn--sm" type="button" data-cc-action="test-get" data-cc-value="' + E(rota) + '">testar novamente (GET)</button>'
        : '<button class="vf-btn vf-btn--sm" type="button" disabled title="Reexecução só é liberada para GET sem parâmetro de rota">testar novamente</button>') +
      '</footer>';
  }

  function avisos(d) {
    var lista = [];
    var evento = d.eventoPrincipal;
    var servidor = d.servidor;

    if (!d.correlacao.completa) lista.push(["correlação incompleta", d.correlacao.motivo]);
    if (!servidor) lista.push(["log somente local", "esta request não tem registro persistido no servidor"]);
    else lista.push(["log persistido", "gravado no PostgreSQL em " + S.formatarDataHora(servidor.created_at)]);

    if (evento && evento.data) {
      var dados = evento.data;
      if (dados.response && dados.response.capturado === false) {
        lista.push(["response não capturada", dados.response.motivo || "não textual"]);
      }
      if (dados.response && dados.response.truncado) lista.push(["response truncada", "o corpo excedeu o limite de captura"]);
      if (dados.request && dados.request.capturado === false) {
        lista.push(["body não capturado", dados.request.motivo || "corpo binário ou stream"]);
      }
      if (dados.cancelada) lista.push(["request cancelada", "AbortController na própria tela"]);
    }
    if (evento && evento.event_type === "network-error") lista.push(["erro de rede", evento.message || "sem resposta HTTP"]);
    if (evento && evento.event_type === "slow-request") lista.push(["timeout/lentidão", "a request passou do limite antes de responder"]);

    if (!lista.length) return "";
    return '<ul class="vfc-avisos">' + lista.map(function (par) {
      return '<li><strong>' + E(par[0]) + '</strong><span>' + E(par[1] || "") + '</span></li>';
    }).join("") + '</ul>';
  }

  function conteudoAbaDetalhe(state) {
    var d = state.selecionado.detalhe;
    var aba = state.abaDetalhe;
    var servidor = d.servidor || null;
    var evento = d.eventoPrincipal || null;
    var dados = (evento && evento.data) || {};

    if (aba === "resumo") {
      return '<dl class="vfc-kv">' +
        '<dt>request id</dt><dd class="vf-mono">' + E(d.requestId) + '</dd>' +
        '<dt>método</dt><dd>' + E((servidor && servidor.method) || (evento && evento.method) || "—") + '</dd>' +
        '<dt>rota (padrão Express)</dt><dd class="vf-mono">' + E((servidor && servidor.route) || "—") + '</dd>' +
        '<dt>caminho</dt><dd class="vf-mono">' + E((servidor && servidor.path) || (evento && evento.endpoint) || "—") + '</dd>' +
        '<dt>status</dt><dd>' + E(S.rotuloStatus((servidor && servidor.status_code) || (evento && evento.status_code))) + '</dd>' +
        '<dt>duração (servidor)</dt><dd>' + E(servidor ? S.formatarDuracao(servidor.duration_ms) : "—") + '</dd>' +
        '<dt>duração (navegador)</dt><dd>' + E(evento ? S.formatarDuracao(evento.duration_ms) : "—") + '</dd>' +
        '<dt>usuário</dt><dd>' + E((servidor && (servidor.user_nome || servidor.user_email)) || (evento && evento.user_email) || "—") + '</dd>' +
        '<dt>tela de origem</dt><dd>' + E((evento && evento.page) || "—") + '</dd>' +
        '<dt>tamanho da response</dt><dd>' + E(servidor ? S.formatarBytes(servidor.response_size) : "—") + '</dd>' +
        '<dt>content-type</dt><dd class="vf-mono">' + E((servidor && servidor.content_type) || dados.contentType || "—") + '</dd>' +
        '<dt>user agent</dt><dd>' + E((servidor && servidor.user_agent) || "—") + '</dd>' +
        '</dl>' + avisos(d);
    }

    if (aba === "request") {
      return '<dl class="vfc-kv">' +
        '<dt>URL sanitizada</dt><dd class="vf-mono">' + E((servidor && servidor.metadata && servidor.metadata.url) || dados.url || "—") + '</dd>' +
        '<dt>origem</dt><dd>' + E((servidor && servidor.metadata && servidor.metadata.origem) || "—") + '</dd>' +
        '<dt>referer</dt><dd class="vf-mono">' + E((servidor && servidor.metadata && servidor.metadata.referer) || "—") + '</dd>' +
        '<dt>IP</dt><dd class="vf-mono">' + E((servidor && servidor.metadata && servidor.metadata.ip) || "—") + '</dd>' +
        '</dl>' +
        '<h4 class="vfc-subtitulo">query (servidor, sanitizada)</h4>' +
        '<pre class="vfc-code">' + E(S.formatarJson((servidor && servidor.metadata && servidor.metadata.query) || {})) + '</pre>' +
        '<h4 class="vfc-subtitulo">headers enviados (navegador, sanitizados)</h4>' +
        '<pre class="vfc-code">' + E(S.formatarJson(dados.headers || { info: "sem eventos do navegador para esta request" })) + '</pre>' +
        '<h4 class="vfc-subtitulo">corpo enviado</h4>' +
        '<pre class="vfc-code">' + E(S.formatarJson(dados.request === undefined ? { info: "body não capturado" } : dados.request)) + '</pre>';
    }

    if (aba === "response") {
      var response = dados.response || null;
      return '<dl class="vfc-kv">' +
        '<dt>status</dt><dd>' + E(S.rotuloStatus((servidor && servidor.status_code) || (evento && evento.status_code))) + '</dd>' +
        '<dt>content-type</dt><dd class="vf-mono">' + E((servidor && servidor.content_type) || dados.contentType || "—") + '</dd>' +
        '<dt>tamanho</dt><dd>' + E(servidor ? S.formatarBytes(servidor.response_size) : "—") + '</dd>' +
        '<dt>captura</dt><dd>' + E(response
          ? (response.capturado ? (response.truncado ? "capturada e truncada" : "capturada") : "não capturada: " + (response.motivo || "—"))
          : "sem evento de navegador") + '</dd>' +
        '</dl>' +
        '<pre class="vfc-code vfc-code--alto">' + E(S.formatarJson(
          response ? (response.corpo !== undefined ? response.corpo : response) : { info: "nenhum corpo de response foi capturado para esta request" }
        )) + '</pre>';
    }

    if (aba === "erro") {
      var temErro = (servidor && (servidor.error_name || servidor.error_message)) ||
        (evento && evento.severity === "error");
      if (!temErro) return vazio("Sem erro", "Esta request terminou sem erro registrado.");
      return '<dl class="vfc-kv">' +
        '<dt>tipo</dt><dd>' + E((servidor && servidor.error_name) || (evento && evento.event_type) || "—") + '</dd>' +
        '<dt>mensagem</dt><dd>' + E((servidor && servidor.error_message) || (evento && evento.message) || "—") + '</dd>' +
        '<dt>origem provável</dt><dd>' + E(
          servidor && servidor.error_name ? "backend (exceção capturada pelo error handler)"
            : servidor && servidor.status_code >= 500 ? "backend (5xx sem exceção)"
              : servidor && servidor.status_code >= 400 ? "cliente/autorização (4xx)"
                : evento && evento.event_type === "network-error" ? "rede, CORS ou servidor fora"
                  : "navegador") + '</dd>' +
        '</dl>' +
        (servidor && servidor.error_stack
          ? '<h4 class="vfc-subtitulo">stack do servidor</h4><pre class="vfc-code vfc-code--alto">' + E(servidor.error_stack) + '</pre>'
          : "") +
        (evento && evento.stack
          ? '<h4 class="vfc-subtitulo">stack do navegador</h4><pre class="vfc-code vfc-code--alto">' + E(evento.stack) + '</pre>'
          : "");
    }

    if (aba === "timeline") {
      if (!d.timeline.length) return vazio("Sem timeline", "Nenhum evento correlacionado.");
      return '<ol class="vfc-timeline">' + d.timeline.map(function (item) {
        return '<li class="vfc-timeline__item is-' + E(item.severidade) + '">' +
          '<span class="vfc-timeline__hora vf-mono">' + E(S.formatarHora(item.em)) + '</span>' +
          '<span class="vfc-timeline__fonte">' + E(item.fonte === "server" ? "servidor" : "navegador") + '</span>' +
          '<span class="vfc-timeline__titulo">' + E(item.titulo) + '</span>' +
          '<span class="vfc-timeline__meta">' + E([
            item.tipo,
            item.duracao !== null && item.duracao !== undefined ? S.formatarDuracao(item.duracao) : null,
            item.pagina
          ].filter(Boolean).join(" · ")) + '</span>' +
          '</li>';
      }).join("") + '</ol>' +
        '<p class="vfc-nota">A ordem é cronológica pelo relógio de cada lado. Diferenças de poucos segundos entre navegador e servidor são normais.</p>';
    }

    return '<dl class="vfc-kv">' +
      '<dt>correlação</dt><dd>' + E(d.correlacao.completa ? "completa (navegador + servidor)"
        : d.correlacao.temServidor ? "só servidor" : "só navegador") + '</dd>' +
      '<dt>eventos do navegador</dt><dd>' + E(d.navegador.length) + '</dd>' +
      '<dt>sessão</dt><dd class="vf-mono">' + E((evento && evento.session_id) || "—") + '</dd>' +
      '<dt>aba</dt><dd class="vf-mono">' + E((evento && evento.tab_id) || "—") + '</dd>' +
      '<dt>page load</dt><dd class="vf-mono">' + E((evento && evento.page_load_id) || "—") + '</dd>' +
      '<dt>debug session (header)</dt><dd class="vf-mono">' + E((servidor && servidor.metadata && servidor.metadata.debugSession) || "—") + '</dd>' +
      '<dt>debug tab (header)</dt><dd class="vf-mono">' + E((servidor && servidor.metadata && servidor.metadata.debugTab) || "—") + '</dd>' +
      '</dl>' +
      '<h4 class="vfc-subtitulo">todos os eventos correlacionados</h4>' +
      '<pre class="vfc-code vfc-code--alto">' + E(S.formatarJson(d.navegador.map(function (e) {
        return { em: e.created_at, tipo: e.event_type, severidade: e.severity, mensagem: e.message, pagina: e.page };
      }))) + '</pre>';
  }

  window.VFCRenderers = {
    ROTULOS_VIEW: ROTULOS_VIEW,
    statusBar: statusBar,
    abas: abas,
    seletorJanela: seletorJanela,
    overview: overview,
    requests: requests,
    errors: errors,
    browser: browser,
    health: health,
    routes: routes,
    tools: tools,
    drawer: drawer,
    carregando: carregando,
    vazio: vazio,
    falha: falha,
    card: card
  };
})();
