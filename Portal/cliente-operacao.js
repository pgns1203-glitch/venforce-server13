(function () {
  "use strict";

  const STORAGE_KEY = "vf-token";
  const API_BASE = "https://venforce-server.onrender.com";
  const FALLBACK_CLIENTE = {
    id: null,
    nome: "Extra Maquinas",
    slug: "extra-maquinas",
    ativo: true,
    marketplace: "Mercado Livre",
    __mock: true,
  };

  const state = {
    loading: false,
    selectedCliente: null,
    clientes: [],
    bases: [],
    vinculos: [],
    vinculoClientes: [],
    tokens: [],
    relatorios: [],
    ads: null,
    clickup: null,
    cobertura: null,
    sources: {},
    failures: [],
    loadedAt: null,
  };

  document.addEventListener("DOMContentLoaded", initClienteOperacao);

  function initClienteOperacao() {
    if (typeof window.initLayout === "function") window.initLayout();
    syncControlCenterLink();

    const refresh = document.getElementById("vfop-refresh");
    if (refresh) refresh.addEventListener("click", loadClienteOperacao);

    loadClienteOperacao();
  }

  function getToken() {
    const token = localStorage.getItem(STORAGE_KEY);
    if (!token) {
      window.location.replace("index.html");
      return null;
    }
    return token;
  }

  function syncControlCenterLink() {
    const link = document.getElementById("vfop-control-center-link");
    if (!link) return;
    const params = new URLSearchParams(window.location.search || "");
    link.href = params.get("vf_debug") ? "control-center.html?vf_debug=1" : "control-center.html";
  }

  async function loadClienteOperacao() {
    const token = getToken();
    if (!token || state.loading) return;

    setLoading(true);
    state.sources = {};
    state.failures = [];
    state.loadedAt = new Date();

    // TODO backend futuro: preferir GET /clientes/:id/operacao ou
    // GET /clientes/:id/workspace quando esse contrato existir.
    const clientes = await loadClientes();
    state.clientes = clientes;
    state.selectedCliente = chooseCliente(clientes);

    renderHeaderSkeleton(state.selectedCliente);

    const results = await Promise.all([
      loadBases(),
      loadVinculos(),
      loadVinculoClientes(),
      loadTokens(),
      loadRelatorios(),
      loadAds(state.selectedCliente),
      loadClickup(),
      loadBaseCobertura(),
    ]);

    state.bases = results[0];
    state.vinculos = results[1];
    state.vinculoClientes = results[2];
    state.tokens = results[3];
    state.relatorios = results[4];
    state.ads = results[5];
    state.clickup = results[6];
    state.cobertura = results[7];

    const workspace = normalizeClienteWorkspace();
    renderClienteOperacao(workspace);
    setLoading(false);
  }

  async function loadClientes() {
    const result = await apiGet("/clientes", "clientes", "GET /clientes");
    if (!result.ok) return [FALLBACK_CLIENTE];

    const clientes = extractArray(result.data, ["clientes", "items", "data"])
      .filter(isPlainObject)
      .map((cliente) => ({ ...cliente }));

    return clientes.length ? clientes : [FALLBACK_CLIENTE];
  }

  async function loadBases() {
    const result = await apiGet("/bases", "bases", "GET /bases");
    if (!result.ok) return [];
    return extractArray(result.data, ["bases", "items", "data"]).filter(isPlainObject);
  }

  async function loadVinculos() {
    const result = await apiGet("/base-vinculos", "vinculos", "GET /base-vinculos");
    if (!result.ok) return [];
    return extractArray(result.data, ["bases", "vinculos", "items", "data"]).filter(isPlainObject);
  }

  async function loadVinculoClientes() {
    const result = await apiGet("/base-vinculos/clientes", "vinculoClientes", "GET /base-vinculos/clientes");
    if (!result.ok) return [];
    return extractArray(result.data, ["clientes", "items", "data"]).filter(isPlainObject);
  }

  async function loadTokens() {
    const result = await apiGet("/admin/ml-tokens", "tokens", "GET /admin/ml-tokens");
    if (!result.ok) return [];
    return extractArray(result.data, ["tokens", "items", "data"]).filter(isPlainObject);
  }

  async function loadRelatorios() {
    const result = await apiGet("/automacoes/relatorios", "relatorios", "GET /automacoes/relatorios");
    if (!result.ok) return [];
    return extractArray(result.data, ["relatorios", "items", "data"]).filter(isPlainObject);
  }

  async function loadAds(cliente) {
    const slug = getClienteSlug(cliente);
    const mes = getCurrentMonthRef();
    const params = new URLSearchParams({
      clienteSlug: slug || FALLBACK_CLIENTE.slug,
      mes,
      lojaCampanha: "todas",
    });
    const result = await apiGet(`/ads/acompanhamento?${params.toString()}`, "ads", "GET /ads/acompanhamento");
    if (!result.ok) return null;
    return result.data?.acompanhamento || result.data || null;
  }

  async function loadClickup() {
    const today = new Date();
    const from = new Date(today.getFullYear(), today.getMonth(), 1);
    const params = new URLSearchParams({
      date_from: toISODate(from),
      date_to: toISODate(today),
      include_comments: "false",
      page_limit: "10",
    });
    const result = await apiGet(`/api/clickup/executivo/resumo?${params.toString()}`, "clickup", "GET /api/clickup/executivo/resumo");
    if (!result.ok) return null;
    return result.data || null;
  }

  async function loadBaseCobertura() {
    const result = await apiGet("/operacao/base-cobertura", "cobertura", "GET /operacao/base-cobertura");
    if (!result.ok) return null;
    return result.data || null;
  }

  async function apiGet(path, key, label) {
    const token = getToken();
    if (!token) return { ok: false, status: 0, data: null };

    try {
      const response = await fetch(`${API_BASE}${path}`, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await response.json().catch(() => ({}));
      const safeData = sanitizeSensitiveData(data);

      if (!response.ok || safeData?.ok === false) {
        const message = safeData?.erro || safeData?.error || safeData?.motivo || `HTTP ${response.status}`;
        recordSource(key, label, response.status, false, message);
        return { ok: false, status: response.status, data: safeData, error: message };
      }

      recordSource(key, label, response.status, true, "");
      return { ok: true, status: response.status, data: safeData };
    } catch (error) {
      const message = error?.message || "Falha de rede";
      recordSource(key, label, 0, false, message);
      return { ok: false, status: 0, data: null, error: message };
    }
  }

  function recordSource(key, label, status, ok, message) {
    const tone = ok ? "success" : (status === 403 || status === 401 ? "warning" : "danger");
    state.sources[key] = {
      label,
      status,
      ok,
      tone,
      message: message || "",
    };
    if (!ok) {
      state.failures.push({
        key,
        label,
        status,
        message: message || "Indisponivel",
      });
    }
  }

  function chooseCliente(clientes) {
    const ativos = (Array.isArray(clientes) ? clientes : []).filter((cliente) => {
      if (!isPlainObject(cliente)) return false;
      const status = String(cliente.status || cliente.situacao || "").toLowerCase();
      return cliente.ativo !== false && status !== "inativo" && status !== "inactive";
    });
    return sanitizeSensitiveData(ativos[0] || clientes?.[0] || FALLBACK_CLIENTE);
  }

  function normalizeClienteWorkspace() {
    const cliente = state.selectedCliente || FALLBACK_CLIENTE;
    const allBases = uniqueBy([...state.bases, ...state.vinculos], getBaseStableKey);
    const clienteKeys = getClienteKeys(cliente);
    const basesDoCliente = allBases.filter((base) => matchesCliente(base, cliente));
    const vinculoClientes = state.vinculoClientes.filter((item) => matchesCliente(item, cliente));
    const tokenRows = state.tokens.filter((token) => matchesCliente(token, cliente));
    const baseKeys = basesDoCliente.map(getBaseSlug).filter(Boolean).map(slugKey);
    const relatorios = state.relatorios
      .filter((relatorio) => matchesCliente(relatorio, cliente) || baseKeys.includes(slugKey(relatorio.base_slug || relatorio.baseSlug || "")))
      .sort(sortByRecent);

    const basePrincipal = basesDoCliente[0] || buildBaseFromCliente(cliente, vinculoClientes[0]);
    const tokenPrincipal = tokenRows[0] || null;
    const relatorioPrincipal = relatorios[0] || null;
    const tokenState = getTokenState(tokenPrincipal, state.sources.tokens);
    const channel = inferMarketplace(cliente, basePrincipal, tokenPrincipal);
    const adsLoaded = Boolean(state.ads);
    const coverage = normalizeCoverage(state.cobertura);

    const workspace = {
      cliente,
      clienteKeys,
      nome: getClienteName(cliente),
      slug: getClienteSlug(cliente),
      channel,
      basePrincipal,
      basesDoCliente,
      vinculoClientes,
      tokenPrincipal,
      tokenRows,
      tokenState,
      relatorioPrincipal,
      relatorios,
      ads: state.ads,
      clickup: state.clickup,
      coverage,
      hasBase: Boolean(basePrincipal),
      hasGrant: Boolean(tokenPrincipal),
      hasDiagnosis: Boolean(relatorioPrincipal),
      hasAds: adsLoaded,
      loadedAt: state.loadedAt,
      isFallback: Boolean(cliente.__mock),
    };

    workspace.frete = buildFretePreviewMock(workspace);
    workspace.setup = buildSetupScore(workspace);
    workspace.quality = buildDataQuality(workspace);
    workspace.pricing = buildPricingPreviewMock(workspace);
    workspace.channels = buildChannels(workspace);
    workspace.metrics = buildMetrics(workspace);
    workspace.actions = buildActions(workspace);
    workspace.history = buildHistory(workspace);

    return workspace;
  }

  function buildSetupScore(workspace) {
    const tokenTone = workspace.tokenState.tone;
    const reportAge = getAgeDays(workspace.relatorioPrincipal?.created_at || workspace.relatorioPrincipal?.createdAt);
    const recentReport = workspace.hasDiagnosis && (reportAge == null || reportAge <= 30);
    const adsSourceOk = Boolean(state.sources.ads?.ok);
    const clickupOk = Boolean(state.sources.clickup?.ok);

    const checks = [
      {
        key: "base",
        label: "Base vinculada",
        detail: workspace.hasBase ? getBaseName(workspace.basePrincipal) : "Aguardando vinculo",
        tone: workspace.hasBase ? "success" : "danger",
        source: state.sources.bases?.ok || state.sources.vinculos?.ok ? "real" : "parcial",
        points: workspace.hasBase ? 20 : 0,
      },
      {
        key: "grant",
        label: "Grant Mercado Livre",
        detail: workspace.tokenState.detail,
        tone: tokenTone,
        source: state.sources.tokens?.ok ? "real" : "parcial",
        points: tokenTone === "success" ? 20 : (tokenTone === "warning" ? 9 : 0),
      },
      {
        key: "diagnostico",
        label: "Diagnostico",
        detail: recentReport ? `Rodado ${formatAgo(workspace.relatorioPrincipal?.created_at || workspace.relatorioPrincipal?.createdAt)}` : "Sem diagnostico recente",
        tone: recentReport ? "success" : (workspace.hasDiagnosis ? "warning" : "danger"),
        source: state.sources.relatorios?.ok ? "real" : "parcial",
        points: recentReport ? 18 : (workspace.hasDiagnosis ? 8 : 0),
      },
      {
        key: "fechamento",
        label: "Fechamento",
        detail: "Aguardando contrato por cliente",
        tone: "warning",
        source: "TODO",
        points: 5,
      },
      {
        key: "ads",
        label: "Ads",
        detail: adsSourceOk ? "Acompanhamento localizado" : "Sem acompanhamento do periodo",
        tone: adsSourceOk ? "success" : "warning",
        source: adsSourceOk ? "real" : "preview",
        points: adsSourceOk ? 12 : 5,
      },
      {
        key: "frete",
        label: "Frete historico",
        detail: "Preview ate existir workspace dedicado",
        tone: workspace.hasBase ? "warning" : "danger",
        source: "TODO",
        points: workspace.hasBase ? 7 : 2,
      },
      {
        key: "gestao",
        label: "Fila operacional",
        detail: clickupOk ? "Resumo ClickUp sincronizado" : "ClickUp indisponivel",
        tone: clickupOk ? "success" : "warning",
        source: clickupOk ? "real" : "parcial",
        points: clickupOk ? 8 : 3,
      },
    ];

    const score = clamp(checks.reduce((sum, item) => sum + item.points, 0), 0, 100);
    const label = score >= 80 ? "Pronto para operar"
      : score >= 60 ? "Operacao com pendencias"
      : "Setup incompleto";
    const tone = score >= 80 ? "success" : (score >= 60 ? "warning" : "danger");

    return { score, label, tone, checks };
  }

  function buildDataQuality(workspace) {
    const relatorio = workspace.relatorioPrincipal || {};
    const semCusto = firstFiniteNumber([
      relatorio.itens_sem_base,
      relatorio.itensSemBase,
      relatorio.sem_custo,
      relatorio.anuncios_sem_custo,
      relatorio.produtos_sem_custo,
    ]);
    const reportAge = getAgeDays(relatorio.created_at || relatorio.createdAt);
    const missingCostValue = semCusto == null ? 18 : semCusto;
    const tokenProblem = workspace.tokenState.tone !== "success";
    const coberturaBase = workspace.coverage
      ? `${workspace.coverage.clientesSemBase} clientes sem base na operacao`
      : "Bloqueia custo e margem confiavel";

    return [
      {
        label: "Produtos/anuncios sem custo",
        value: semCusto == null ? `${missingCostValue} prev.` : String(missingCostValue),
        detail: semCusto == null ? "Preview ate o relatorio expor esse total" : "Vem do diagnostico mais recente",
        tone: missingCostValue > 20 ? "danger" : (missingCostValue > 0 ? "warning" : "success"),
      },
      {
        label: "Sem frete confiavel",
        value: workspace.frete.confidence === "alta" ? "0" : "Amostra parcial",
        detail: "TODO contrato de frete historico por cliente",
        tone: workspace.frete.confidence === "alta" ? "success" : "warning",
      },
      {
        label: "Sem base vinculada",
        value: workspace.hasBase ? "0" : "1",
        detail: workspace.hasBase ? getBaseName(workspace.basePrincipal) : coberturaBase,
        tone: workspace.hasBase ? "success" : "danger",
      },
      {
        label: "Sem marketplace identificado",
        value: workspace.channel ? "0" : "1",
        detail: workspace.channel ? marketplaceLabel(workspace.channel) : "Canal principal nao veio nos dados",
        tone: workspace.channel ? "success" : "warning",
      },
      {
        label: "Token vencendo ou ausente",
        value: tokenProblem ? "Sim" : "Nao",
        detail: workspace.tokenState.detail,
        tone: tokenProblem ? workspace.tokenState.tone : "success",
      },
      {
        label: "Relatorios antigos",
        value: !workspace.hasDiagnosis ? "Sem relatorio" : (reportAge != null && reportAge > 30 ? `${reportAge} dias` : "Atual"),
        detail: workspace.hasDiagnosis ? "Diagnostico mais recente" : "Rode o primeiro diagnostico",
        tone: !workspace.hasDiagnosis || (reportAge != null && reportAge > 30) ? "warning" : "success",
      },
    ];
  }

  function buildPricingPreviewMock(workspace) {
    const relatorio = workspace.relatorioPrincipal || {};
    const mcMedia = firstFiniteNumber([relatorio.mc_media, relatorio.margem_media, relatorio.margemAtual]);
    const currentMargin = mcMedia == null ? 16.8 : normalizePercent(mcMedia);
    const correctedMargin = Math.min(currentMargin + (workspace.hasBase ? 3.4 : 1.2), 32.5);
    const blockers = [];

    if (!workspace.hasBase) blockers.push("vincular base de custo");
    if (workspace.tokenState.tone !== "success") blockers.push("regularizar grant Mercado Livre");
    if (!workspace.hasDiagnosis) blockers.push("rodar diagnostico completo");
    if (workspace.frete.confidence !== "alta") blockers.push("validar frete historico");

    return {
      isMock: true,
      confidence: blockers.length >= 3 ? "baixa" : (blockers.length ? "media" : "alta"),
      blockers,
      rows: [
        {
          label: "Margem atual",
          value: formatPercent(currentMargin),
          detail: mcMedia == null ? "Preview realista; aguarda contrato por cliente" : "Estimativa do ultimo relatorio",
          source: mcMedia == null ? "TODO" : "real",
        },
        {
          label: "Margem corrigida estimada",
          value: formatPercent(correctedMargin),
          detail: "Simulacao operacional para o piloto",
          source: "TODO",
        },
        {
          label: "Preco sugerido",
          value: formatBRL(workspace.hasBase ? 129.9 : 119.9),
          detail: "Aguardando GET /clientes/:id/operacao",
          source: "TODO",
        },
        {
          label: "Confianca do calculo",
          value: capitalize(blockers.length >= 3 ? "baixa" : (blockers.length ? "media" : "alta")),
          detail: blockers.length ? blockers.join(", ") : "Sem bloqueios criticos no piloto",
          source: "preview",
        },
      ],
    };
  }

  function buildFretePreviewMock(workspace) {
    const sampleSize = workspace.hasDiagnosis ? 42 : 18;
    const diff = workspace.hasBase ? 3.7 : 8.9;
    const confidence = workspace.hasBase && workspace.hasDiagnosis ? "media" : "baixa";

    return {
      isMock: true,
      confidence,
      rows: [
        {
          label: "Frete usado hoje",
          value: formatBRL(workspace.hasBase ? 28.4 : 31.2),
          detail: "Preview ate existir historico consolidado",
          source: "TODO",
        },
        {
          label: "Frete historico real",
          value: formatBRL(workspace.hasBase ? 27.35 : 0),
          detail: workspace.hasBase ? "Amostra simulada para validar layout" : "Depende da base vinculada",
          source: "TODO",
        },
        {
          label: "Amostra de vendas",
          value: `${sampleSize} pedidos`,
          detail: "Contrato futuro deve trazer vendas por periodo",
          source: "TODO",
        },
        {
          label: "Diferenca estimado x real",
          value: `${formatPercent(diff)} pts`,
          detail: "Pode indicar vazamento de margem",
          source: "TODO",
        },
        {
          label: "Confianca da amostra",
          value: capitalize(confidence),
          detail: "Sobe quando houver frete historico por SKU/canal",
          source: "preview",
        },
      ],
    };
  }

  function buildChannels(workspace) {
    const tokenTone = workspace.tokenState.tone;
    const diagnosisTone = workspace.hasDiagnosis ? "success" : "warning";
    const baseTone = workspace.hasBase ? "success" : "danger";
    const pending = [];

    if (!workspace.hasBase) pending.push("base");
    if (tokenTone !== "success") pending.push("grant");
    if (!workspace.hasDiagnosis) pending.push("diagnostico");

    return [
      {
        name: "Mercado Livre principal",
        meta: workspace.slug || "cliente selecionado",
        base: statusSpec(workspace.hasBase ? "Vinculada" : "Pendente", baseTone),
        grant: statusSpec(workspace.tokenState.label, tokenTone),
        diagnostico: statusSpec(workspace.hasDiagnosis ? "Recente" : "Pendente", diagnosisTone),
        fechamento: statusSpec("TODO", "warning"),
        pendencias: pending.length ? pending.join(", ") : "sem bloqueio critico",
        source: "real",
      },
      {
        name: "Mercado Livre loja 2",
        meta: "canal preparado",
        base: statusSpec("Preview", "warning"),
        grant: statusSpec("Preview", "warning"),
        diagnostico: statusSpec("TODO", "warning"),
        fechamento: statusSpec("TODO", "warning"),
        pendencias: "confirmar existencia da loja",
        source: "preview",
      },
      {
        name: "Shopee",
        meta: "canal preparado",
        base: statusSpec("Preview", "warning"),
        grant: statusSpec("TODO", "warning"),
        diagnostico: statusSpec("TODO", "warning"),
        fechamento: statusSpec("TODO", "warning"),
        pendencias: "aguarda contrato de canal",
        source: "preview",
      },
    ];
  }

  function buildMetrics(workspace) {
    const resumo = workspace.clickup?.resumo || {};
    const pendencias = firstFiniteNumber([resumo.abertas, resumo.atrasadas_abertas, resumo.sem_prazo]);
    const abertas = Number(resumo.abertas || 0);
    const atrasadas = Number(resumo.atrasadas_abertas || 0);
    const adsValue = firstFiniteNumber([
      workspace.ads?.investimentoAds,
      workspace.ads?.investimento_ads,
      workspace.ads?.adsSpend,
      workspace.ads?.spend,
    ]);

    return [
      {
        label: "Pedidos",
        value: "--",
        foot: "TODO GET /clientes/:id/operacao",
        tone: "warning",
      },
      {
        label: "Faturamento",
        value: "--",
        foot: "TODO contrato financeiro por cliente",
        tone: "warning",
      },
      {
        label: "Cancelados",
        value: "--",
        foot: "TODO fechamento do periodo",
        tone: "warning",
      },
      {
        label: "Investimento Ads",
        value: adsValue == null ? formatBRL(1840) : formatBRL(adsValue),
        foot: adsValue == null ? "Preview; /ads/acompanhamento consultado" : "GET /ads/acompanhamento",
        tone: adsValue == null ? "warning" : "success",
      },
      {
        label: "Ultimo fechamento",
        value: "--",
        foot: "TODO fechamento por cliente",
        tone: "warning",
      },
      {
        label: "Pendencias periodo",
        value: state.sources.clickup?.ok ? String(abertas + atrasadas) : (pendencias == null ? "--" : String(pendencias)),
        foot: state.sources.clickup?.ok ? "Resumo ClickUp real" : "ClickUp parcial/indisponivel",
        tone: state.sources.clickup?.ok ? (abertas + atrasadas > 0 ? "warning" : "success") : "warning",
      },
    ];
  }

  function buildActions(workspace) {
    const semCusto = workspace.quality.find((item) => item.label === "Produtos/anuncios sem custo");
    const needsReport = !workspace.hasDiagnosis || getAgeDays(workspace.relatorioPrincipal?.created_at || workspace.relatorioPrincipal?.createdAt) > 30;

    return [
      {
        title: "Vincular base",
        detail: workspace.hasBase ? `Base ativa: ${getBaseName(workspace.basePrincipal)}` : "Necessario para calcular custo e margem",
        priority: workspace.hasBase ? "OK" : "Alta",
        tone: workspace.hasBase ? "success" : "danger",
      },
      {
        title: "Conectar grant",
        detail: workspace.tokenState.detail,
        priority: workspace.tokenState.tone === "success" ? "OK" : "Alta",
        tone: workspace.tokenState.tone,
      },
      {
        title: "Rodar diagnostico",
        detail: workspace.hasDiagnosis ? "Usar relatorio mais recente como base" : "Primeira leitura operacional do cliente",
        priority: needsReport ? "Alta" : "OK",
        tone: needsReport ? "warning" : "success",
      },
      {
        title: "Revisar anuncios sem custo",
        detail: semCusto ? `${semCusto.value} itens em atencao` : "Aguardando diagnostico",
        priority: semCusto && semCusto.tone !== "success" ? "Media" : "OK",
        tone: semCusto ? semCusto.tone : "warning",
      },
      {
        title: "Atualizar frete historico",
        detail: "TODO: consolidar frete real por SKU/canal",
        priority: "Media",
        tone: "warning",
      },
      {
        title: "Gerar relatorio",
        detail: needsReport ? "Relatorio recente aumenta confianca do setup" : "Relatorio ja localizado",
        priority: needsReport ? "Media" : "OK",
        tone: needsReport ? "warning" : "success",
      },
      {
        title: "Abrir tarefa ClickUp",
        detail: state.sources.clickup?.ok ? "Usar fila executiva para acompanhamento" : "ClickUp indisponivel nesta sessao",
        priority: "Baixa",
        tone: state.sources.clickup?.ok ? "info" : "warning",
      },
    ];
  }

  function buildHistory(workspace) {
    const baseDate = workspace.basePrincipal?.updated_at || workspace.basePrincipal?.created_at || workspace.basePrincipal?.createdAt;
    const tokenDate = workspace.tokenPrincipal?.updated_at || workspace.tokenPrincipal?.created_at || workspace.tokenPrincipal?.createdAt;
    const reportDate = workspace.relatorioPrincipal?.created_at || workspace.relatorioPrincipal?.createdAt;
    const adsDate = workspace.ads?.updatedAt || workspace.ads?.updated_at;

    return [
      {
        title: "Base importada",
        detail: workspace.hasBase ? getBaseName(workspace.basePrincipal) : "pendente",
        date: baseDate,
        tone: workspace.hasBase ? "success" : "warning",
      },
      {
        title: "Grant conectado",
        detail: workspace.tokenState.detail,
        date: tokenDate,
        tone: workspace.tokenState.tone,
      },
      {
        title: "Diagnostico rodado",
        detail: workspace.hasDiagnosis ? getReportName(workspace.relatorioPrincipal) : "pendente",
        date: reportDate,
        tone: workspace.hasDiagnosis ? "success" : "warning",
      },
      {
        title: "Relatorio salvo",
        detail: workspace.hasDiagnosis ? "Disponivel em relatorios" : "aguarda diagnostico",
        date: reportDate,
        tone: workspace.hasDiagnosis ? "success" : "warning",
      },
      {
        title: "Fechamento processado",
        detail: "TODO contrato por cliente",
        date: null,
        tone: "warning",
      },
      {
        title: "Tarefa criada",
        detail: state.sources.clickup?.ok ? "Resumo ClickUp sincronizado" : "TODO abrir tarefa no fluxo",
        date: adsDate,
        tone: state.sources.clickup?.ok ? "info" : "warning",
      },
    ];
  }

  function renderClienteOperacao(workspace) {
    renderHeader(workspace);
    renderPilotNote();
    renderReadiness(workspace);
    renderChannels(workspace);
    renderQuality(workspace);
    renderMetricRows("vfop-pricing-preview", workspace.pricing.rows);
    renderMetricRows("vfop-frete-preview", workspace.frete.rows);
    renderMetrics(workspace);
    renderActions(workspace);
    renderHistory(workspace);
    renderSources();
  }

  function renderHeaderSkeleton(cliente) {
    setText("vfop-client-name", getClienteName(cliente));
    setText("vfop-client-channel", "Canal principal: carregando");
    setText("vfop-last-update", "Atualizacao: carregando");
  }

  function renderHeader(workspace) {
    setText("vfop-title", workspace.nome);
    setText("vfop-client-name", workspace.nome);
    setText("vfop-client-channel", `Canal principal: ${marketplaceLabel(workspace.channel)}`);
    setText("vfop-last-update", `Atualizado: ${formatDateTime(workspace.loadedAt)}`);
    setStatus("vfop-operational-status", workspace.setup.label, workspace.setup.tone);
  }

  function renderPilotNote() {
    const alert = document.getElementById("vfop-source-alert");
    if (!alert) return;

    if (!state.failures.length) {
      alert.textContent = "Tela piloto: dados reais carregados onde ja existe contrato de API; previews/TODO ficam marcados.";
      return;
    }

    const labels = state.failures.slice(0, 3).map((item) => item.label.replace("GET ", "")).join(", ");
    const more = state.failures.length > 3 ? ` +${state.failures.length - 3}` : "";
    alert.textContent = `Estado parcial: ${labels}${more} indisponivel(is). A tela piloto continua com dados reais parciais e previews marcados.`;
  }

  function renderReadiness(workspace) {
    setText("vfop-score-value", `${workspace.setup.score}`);
    setText("vfop-score-label", workspace.setup.label);
    setStatus("vfop-score-source", state.failures.length ? "Parcial" : "Real", state.failures.length ? "warning" : "success");

    const bar = document.getElementById("vfop-score-bar");
    if (bar) bar.style.width = `${workspace.setup.score}%`;

    const list = document.getElementById("vfop-setup-list");
    if (!list) return;
    list.innerHTML = workspace.setup.checks.map((item) => `
      <div class="vfop-readiness-item">
        <div class="vfop-readiness-item__label">
          <strong>${escapeHTML(item.label)}</strong>
          <span>${escapeHTML(item.detail)} · ${escapeHTML(item.source)}</span>
        </div>
        ${statusBadge(statusLabelFromTone(item.tone), item.tone)}
      </div>
    `).join("");
  }

  function renderChannels(workspace) {
    const tbody = document.getElementById("vfop-channels-body");
    if (!tbody) return;

    tbody.innerHTML = workspace.channels.map((channel) => `
      <tr>
        <td>
          <div class="vfop-channel-name">
            <strong>${escapeHTML(channel.name)}</strong>
            <span>${escapeHTML(channel.meta)} · ${escapeHTML(channel.source)}</span>
          </div>
        </td>
        <td>${statusBadge(channel.base.label, channel.base.tone)}</td>
        <td>${statusBadge(channel.grant.label, channel.grant.tone)}</td>
        <td>${statusBadge(channel.diagnostico.label, channel.diagnostico.tone)}</td>
        <td>${statusBadge(channel.fechamento.label, channel.fechamento.tone)}</td>
        <td>${escapeHTML(channel.pendencias)}</td>
      </tr>
    `).join("");
  }

  function renderQuality(workspace) {
    const target = document.getElementById("vfop-quality-list");
    if (!target) return;

    target.innerHTML = workspace.quality.map((item) => `
      <div class="vfop-quality-item">
        <div class="vfop-quality-main">
          <strong>${escapeHTML(item.label)}</strong>
          <span>${escapeHTML(item.detail)}</span>
        </div>
        <div class="vfop-quality-value">${escapeHTML(item.value)}</div>
        ${statusBadge(statusLabelFromTone(item.tone), item.tone)}
      </div>
    `).join("");
  }

  function renderMetricRows(targetId, rows) {
    const target = document.getElementById(targetId);
    if (!target) return;
    target.innerHTML = rows.map((row) => `
      <div class="vfop-metric-row">
        <div class="vfop-metric-main">
          <strong>${escapeHTML(row.label)}</strong>
          <span>${escapeHTML(row.detail)}</span>
        </div>
        <div class="vfop-metric-value">${escapeHTML(row.value)}</div>
        ${statusBadge(row.source === "real" ? "Real" : row.source === "TODO" ? "TODO" : "Preview", row.source === "real" ? "success" : "warning")}
      </div>
    `).join("");
  }

  function renderMetrics(workspace) {
    const target = document.getElementById("vfop-metrics-grid");
    if (!target) return;
    target.innerHTML = workspace.metrics.map((item) => `
      <div class="vfop-metric-tile">
        <div class="vfop-metric-tile__label">${escapeHTML(item.label)}</div>
        <div class="vfop-metric-tile__value">${escapeHTML(item.value)}</div>
        <div class="vfop-metric-tile__foot">${escapeHTML(item.foot)}</div>
      </div>
    `).join("");
  }

  function renderActions(workspace) {
    const target = document.getElementById("vfop-action-queue");
    if (!target) return;
    target.innerHTML = workspace.actions.map((item) => `
      <div class="vfop-action-item">
        <div class="vfop-action-main">
          <strong>${escapeHTML(item.title)}</strong>
          <span>${escapeHTML(item.detail)}</span>
        </div>
        <div class="vfop-action-priority">${statusBadge(item.priority, item.tone)}</div>
      </div>
    `).join("");
  }

  function renderHistory(workspace) {
    const target = document.getElementById("vfop-history");
    if (!target) return;
    target.innerHTML = workspace.history.map((item) => `
      <div class="vfop-timeline-item">
        <div class="vfop-timeline-main">
          <strong>${escapeHTML(item.title)}</strong>
          <span>${escapeHTML(item.detail)} · ${escapeHTML(item.date ? formatDateTime(item.date) : "TODO")}</span>
        </div>
        ${statusBadge(statusLabelFromTone(item.tone), item.tone)}
      </div>
    `).join("");
  }

  function renderSources() {
    const target = document.getElementById("vfop-source-list");
    if (!target) return;

    const ordered = [
      "clientes",
      "bases",
      "vinculos",
      "vinculoClientes",
      "cobertura",
      "relatorios",
      "tokens",
      "ads",
      "clickup",
    ];
    const rows = ordered
      .map((key) => state.sources[key])
      .filter(Boolean);

    rows.push({
      label: "GET /clientes/:id/operacao ou GET /clientes/:id/workspace",
      status: "futuro",
      ok: false,
      tone: "warning",
      message: "TODO backend futuro",
    });

    target.innerHTML = rows.map((source) => `
      <div class="vfop-source-item">
        <div class="vfop-source-main">
          <strong>${escapeHTML(source.label)}</strong>
          <span>${escapeHTML(source.message || (source.ok ? "Contrato consultado com sucesso" : "Sem dados nesta sessao"))}</span>
        </div>
        ${statusBadge(source.ok ? `HTTP ${source.status}` : String(source.status || "TODO"), source.tone)}
      </div>
    `).join("");
  }

  function setLoading(isLoading) {
    state.loading = isLoading;
    const btn = document.getElementById("vfop-refresh");
    if (btn) {
      btn.disabled = isLoading;
      const label = btn.querySelector("span");
      if (label) label.textContent = isLoading ? "Atualizando" : "Atualizar dados";
    }
  }

  function setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value == null || value === "" ? "--" : String(value);
  }

  function setStatus(id, label, tone) {
    const element = document.getElementById(id);
    if (!element) return;
    element.className = `vfop-status vfop-status--${tone || "neutral"}`;
    element.textContent = label || "--";
  }

  function statusBadge(label, tone) {
    const safeTone = ["success", "warning", "danger", "info", "muted", "neutral"].includes(tone) ? tone : "neutral";
    return `<span class="vfop-status vfop-status--${safeTone}">${escapeHTML(label || "--")}</span>`;
  }

  function statusSpec(label, tone) {
    return { label, tone };
  }

  function statusLabelFromTone(tone) {
    if (tone === "success") return "OK";
    if (tone === "danger") return "Critico";
    if (tone === "info") return "Info";
    return "Atencao";
  }

  function getTokenState(token, source) {
    if (!source?.ok) {
      return {
        label: source?.status === 403 ? "Sem permissao" : "Parcial",
        tone: "warning",
        detail: source?.status === 403 ? "Rota admin indisponivel para este usuario" : "Nao foi possivel validar tokens",
      };
    }
    if (!token) {
      return { label: "Ausente", tone: "danger", detail: "Nenhum grant localizado para o cliente" };
    }

    const expiresRaw = token.expires_at || token.expiresAt || token.expira_em || token.expiration;
    const expires = expiresRaw ? new Date(expiresRaw) : null;
    const activeFlag = token.ativo !== false && String(token.status || "").toLowerCase() !== "revogado";

    if (!activeFlag) return { label: "Inativo", tone: "danger", detail: "Grant existe, mas esta inativo" };
    if (!expires || Number.isNaN(expires.getTime())) return { label: "Conectado", tone: "success", detail: "Grant localizado sem vencimento no payload" };

    const days = Math.ceil((expires.getTime() - Date.now()) / 86400000);
    if (days < 0) return { label: "Vencido", tone: "danger", detail: `Token venceu ha ${Math.abs(days)} dias` };
    if (days <= 7) return { label: "Expira breve", tone: "warning", detail: `Token vence em ${days} dias` };
    return { label: "Conectado", tone: "success", detail: `Token valido por ${days} dias` };
  }

  function inferMarketplace(cliente, base, token) {
    const raw = cliente?.marketplace || cliente?.canal || cliente?.canal_principal
      || base?.marketplace || base?.canal || token?.marketplace || token?.canal;
    const text = String(raw || "").toLowerCase();
    if (text.includes("shopee")) return "shopee";
    if (text.includes("meli") || text.includes("mercado") || token) return "meli";
    return raw ? String(raw) : "meli";
  }

  function marketplaceLabel(value) {
    const text = String(value || "").toLowerCase();
    if (text === "meli" || text.includes("mercado")) return "Mercado Livre";
    if (text.includes("shopee")) return "Shopee";
    if (!value) return "Nao identificado";
    return String(value);
  }

  function normalizeCoverage(payload) {
    if (!payload) return null;
    return {
      clientesAtivos: Number(payload.clientes_ativos || payload.clientesAtivos || 0),
      clientesComBase: Number(payload.clientes_com_base || payload.clientesComBase || 0),
      clientesSemBase: Number(payload.clientes_sem_base || payload.clientesSemBase || 0),
      basesSemVinculo: Number(payload.bases_sem_vinculo || payload.basesSemVinculo || 0),
      porMarketplace: payload.por_marketplace || payload.porMarketplace || {},
    };
  }

  function buildBaseFromCliente(cliente, vinculoCliente) {
    const baseSlug = cliente?.base_slug || cliente?.baseSlug || vinculoCliente?.base_slug || vinculoCliente?.baseSlug;
    if (!baseSlug) return null;
    return {
      slug: baseSlug,
      nome: cliente?.base_nome || cliente?.baseNome || baseSlug,
      marketplace: cliente?.marketplace || vinculoCliente?.marketplace,
      vinculo: vinculoCliente || null,
    };
  }

  function matchesCliente(item, cliente) {
    if (!item || !cliente) return false;
    const clienteKeys = getClienteKeys(cliente);
    if (!clienteKeys.length) return false;
    return getItemClienteKeys(item).some((key) => clienteKeys.includes(key));
  }

  function getClienteKeys(cliente) {
    const values = [
      cliente?.id,
      cliente?.cliente_id,
      cliente?.clienteId,
      cliente?.slug,
      cliente?.cliente_slug,
      cliente?.clienteSlug,
      cliente?.nome,
      cliente?.name,
      cliente?.razao_social,
    ];
    return unique(values.map(slugKey).filter(Boolean));
  }

  function getItemClienteKeys(item) {
    const values = [
      item?.cliente_id,
      item?.clienteId,
      item?.cliente_slug,
      item?.clienteSlug,
      item?.cliente,
      item?.cliente_nome,
      item?.clienteNome,
      item?.nome_cliente,
      item?.nomeCliente,
      item?.client_slug,
      item?.clientSlug,
      item?.slug_cliente,
      item?.slugCliente,
      item?.conta,
      item?.seller_nickname,
      item?.sellerNickname,
      item?.vinculo?.cliente_id,
      item?.vinculo?.clienteId,
      item?.vinculo?.cliente_slug,
      item?.vinculo?.clienteSlug,
      item?.vinculo?.cliente_nome,
      item?.vinculo?.clienteNome,
      item?.cliente?.id,
      item?.cliente?.slug,
      item?.cliente?.nome,
    ];
    return unique(values.map(slugKey).filter(Boolean));
  }

  function getClienteName(cliente) {
    return String(cliente?.nome || cliente?.name || cliente?.razao_social || cliente?.slug || "Extra Maquinas");
  }

  function getClienteSlug(cliente) {
    return String(cliente?.slug || cliente?.cliente_slug || cliente?.clienteSlug || slugify(getClienteName(cliente)));
  }

  function getBaseName(base) {
    return String(base?.nome || base?.name || base?.slug || base?.base_slug || "Base vinculada");
  }

  function getBaseSlug(base) {
    return String(base?.slug || base?.base_slug || base?.baseSlug || "");
  }

  function getBaseStableKey(base) {
    return String(base?.id || base?.base_id || base?.slug || base?.base_slug || JSON.stringify(base || {}));
  }

  function getReportName(relatorio) {
    return String(relatorio?.nome || relatorio?.titulo || relatorio?.base_slug || relatorio?.cliente_slug || `Relatorio ${relatorio?.id || ""}`).trim();
  }

  function extractArray(data, keys) {
    if (Array.isArray(data)) return data;
    if (!isPlainObject(data)) return [];
    for (const key of keys) {
      if (Array.isArray(data[key])) return data[key];
    }
    for (const value of Object.values(data)) {
      if (Array.isArray(value)) return value;
    }
    return [];
  }

  function sanitizeSensitiveData(value, seen) {
    if (value == null) return value;
    if (typeof value !== "object") return value;

    const visited = seen || new WeakSet();
    if (visited.has(value)) return null;
    visited.add(value);

    if (Array.isArray(value)) {
      return value.map((item) => sanitizeSensitiveData(item, visited));
    }

    const output = {};
    Object.keys(value).forEach((key) => {
      if (isSensitiveKey(key)) {
        output[key] = "[removido]";
        return;
      }
      output[key] = sanitizeSensitiveData(value[key], visited);
    });
    return output;
  }

  function isSensitiveKey(key) {
    const normalized = String(key || "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
    if (!normalized || normalized === "tokens") return false;
    return normalized === "authorization"
      || normalized === "token"
      || normalized === "accesstoken"
      || normalized === "refreshtoken"
      || normalized === "apikey"
      || normalized === "xapikey"
      || normalized === "password"
      || normalized === "senha"
      || normalized === "clientsecret"
      || normalized.endsWith("accesstoken")
      || normalized.endsWith("refreshtoken")
      || normalized.includes("authorization")
      || normalized.includes("secret");
  }

  function isPlainObject(value) {
    return value != null && typeof value === "object" && !Array.isArray(value);
  }

  function unique(items) {
    return [...new Set(items)];
  }

  function uniqueBy(items, getKey) {
    const seen = new Set();
    const out = [];
    items.forEach((item) => {
      const key = getKey(item);
      if (!key || seen.has(key)) return;
      seen.add(key);
      out.push(item);
    });
    return out;
  }

  function slugKey(value) {
    const str = String(value ?? "").trim().toLowerCase();
    if (!str) return "";
    return str
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function slugify(value) {
    return slugKey(value) || "cliente";
  }

  function sortByRecent(a, b) {
    const dateA = getDateMs(a?.created_at || a?.createdAt || a?.updated_at || a?.updatedAt);
    const dateB = getDateMs(b?.created_at || b?.createdAt || b?.updated_at || b?.updatedAt);
    if (dateA !== dateB) return dateB - dateA;
    return Number(b?.id || 0) - Number(a?.id || 0);
  }

  function getDateMs(value) {
    const date = value ? new Date(value) : null;
    const ms = date ? date.getTime() : 0;
    return Number.isFinite(ms) ? ms : 0;
  }

  function getAgeDays(value) {
    const ms = getDateMs(value);
    if (!ms) return null;
    return Math.max(0, Math.floor((Date.now() - ms) / 86400000));
  }

  function firstFiniteNumber(values) {
    for (const value of values) {
      const n = Number(value);
      if (Number.isFinite(n)) return n;
    }
    return null;
  }

  function normalizePercent(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.abs(n) <= 1 ? n * 100 : n;
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function formatBRL(value) {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value) || 0);
  }

  function formatPercent(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "--";
    return `${n.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
  }

  function formatDateTime(value) {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return "--";
    return date.toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function formatAgo(value) {
    const days = getAgeDays(value);
    if (days == null) return "recentemente";
    if (days === 0) return "hoje";
    if (days === 1) return "ha 1 dia";
    return `ha ${days} dias`;
  }

  function getCurrentMonthRef() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }

  function toISODate(date) {
    return date.toISOString().slice(0, 10);
  }

  function capitalize(value) {
    const text = String(value || "");
    return text ? text[0].toUpperCase() + text.slice(1) : text;
  }

  function escapeHTML(value) {
    const div = document.createElement("div");
    div.textContent = value == null ? "" : String(value);
    return div.innerHTML;
  }
})();
