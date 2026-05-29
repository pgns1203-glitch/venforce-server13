console.log("[VenForce Go] extensão premium iniciada v1.2.0");

(function () {
  // ==========================
  // CONFIG / CONSTANTES
  // ==========================
  const API_BASE_URL = "https://venforce-server.onrender.com";

  const OVERLAY_ID = "venforce-overlay-root";
  const BOX_CLASS = "vf-card-box";


  const BOX_WIDTH = 300;
  const CARD_GAP_FROM_ROW = 14;
  const VIEWPORT_RIGHT_GAP = 12;

  // Default thresholds (usuário pode customizar)
  const DEFAULT_PREFS = {
    thresholdSaudavel: 10, // MC >= 10% => saudável (verde)
    thresholdAtencao: 6,   // MC >= 6% e < 10% => atenção (amarelo)
                            // MC < 6% => crítico (vermelho)
    mostrarSaudavel: true,
    mostrarAtencao: true,
    mostrarCritico: true,
    mostrarSemCusto: true,
    cardsCompactos: true,
    hudPosicao: { x: null, y: 80 }, // null x = direita
    hudMinimizado: false,
    margemAlvo: 15, // % de margem alvo p/ sugestão de preço
    ordenacao: "natural", // natural | mc_asc | mc_desc | lc_desc
    filtroStatus: "todos", // todos | saudavel | atencao | critico | sem_custo
    filtroBusca: ""
  };

  let prefs = { ...DEFAULT_PREFS };
  let COST_DB = {};
  let scheduled = false;
  let currentBaseId = null;
  let expandAllOnNextRender = false;
  let collapseAllOnNextRender = false;
  let lastAnalysisData    = []; // dados da última análise para export/filtros
  const FRETE_EXTRACTOR_VERSION = "frete-v4-voce-paga-entre";
  const EARNINGS_TOOLTIP_VERSION = "earnings-tooltip-v1";
  const earningsTooltipCache   = new Map(); // id → parsed | null
  const earningsTooltipPending = new Map(); // id → Promise

  // ==========================
  // PLATAFORMA
  // ==========================
  function detectarPlataforma() {
    const hostname = (location?.hostname || "").toLowerCase();
    if (hostname.includes("mercadolivre")) return "ml";
    return null;
  }

  const PLATAFORMA = detectarPlataforma();

  // ==========================
  // PREFERENCIAS (storage)
  // ==========================
  async function carregarPrefs() {
    try {
      const stored = await chrome.storage.local.get(["vf_prefs"]);
      if (stored?.vf_prefs && typeof stored.vf_prefs === "object") {
        prefs = { ...DEFAULT_PREFS, ...stored.vf_prefs };
      }
    } catch { /* ignore */ }
  }

  async function salvarPrefs() {
    try {
      await chrome.storage.local.set({ vf_prefs: prefs });
    } catch { /* ignore */ }
  }

  // ==========================
  // FORMATAÇÃO
  // ==========================
  function moeda(valor) {
    return Number(valor || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  function porcentagem(valor, casas = 2) {
    return `${Number(valor || 0).toFixed(casas)}%`;
  }

  function numeroSeguro(valor) {
    if (valor === null || valor === undefined || valor === "") return 0;
    if (typeof valor === "number") return Number.isFinite(valor) ? valor : 0;

    let texto = String(valor).trim().replace(/\s/g, "").replace("%", "");
    if (!texto) return 0;

    if (texto.includes(",") && texto.includes(".")) {
      texto = texto.replace(/\./g, "").replace(",", ".");
    } else if (texto.includes(",")) {
      texto = texto.replace(",", ".");
    } else if (texto.includes(".") && /^\d{1,3}(\.\d{3})+$/.test(texto)) {
      texto = texto.replace(/\./g, "");
    }

    const n = Number(texto);
    return Number.isFinite(n) ? n : 0;
  }

  function extrairNumeroDeTexto(texto) {
    if (!texto) return 0;
    const match = String(texto).match(/R\$\s*([\d\.]+,\d{2}|[\d\.]+)/i);
    if (!match) return 0;

    let valor = match[1];
    if (valor.includes(",") && valor.includes(".")) {
      valor = valor.replace(/\./g, "").replace(",", ".");
    } else if (valor.includes(",")) {
      valor = valor.replace(",", ".");
    } else if (valor.includes(".") && /^\d{1,3}(\.\d{3})+$/.test(valor)) {
      valor = valor.replace(/\./g, "");
    }

    const n = Number(valor);
    return Number.isFinite(n) ? n : 0;
  }

  function extrairTodosOsPrecosDoTexto(texto) {
    if (!texto) return [];
    return [...String(texto).matchAll(/R\$\s*([\d\.]+,\d{2}|[\d\.]+)/gi)]
      .map(m => extrairNumeroDeTexto(m[0]))
      .filter(v => v > 0);
  }

  function normalizarPercentual(valor) {
    const n = numeroSeguro(valor);
    if (n > 0 && n <= 1) return n * 100;
    return n;
  }

  function classeNumero(valor) {
    if (valor > 0) return "vf-pos";
    if (valor < 0) return "vf-neg";
    return "vf-neu";
  }

  function getStatusByMc(mc) {
    if (mc < prefs.thresholdAtencao) return { tipo: "critico", texto: "Crítico", classe: "vf-status-critico" };
    if (mc < prefs.thresholdSaudavel) return { tipo: "atencao", texto: "Atenção", classe: "vf-status-atencao" };
    return { tipo: "saudavel", texto: "Saudável", classe: "vf-status-saudavel" };
  }

  function getCardColorClassByMc(mc) {
    const st = getStatusByMc(mc).tipo;
    if (st === "critico") return "vf-card-red";
    if (st === "atencao") return "vf-card-yellow";
    return "vf-card-green";
  }

  function getTextoLimpo(el) {
    return (el?.innerText || "").replace(/\u00a0/g, " ").trim();
  }

  function getLinhas(texto) {
    return String(texto || "")
      .replace(/\u00a0/g, " ")
      .split("\n")
      .map(s => s.trim())
      .filter(Boolean);
  }

  function normalizarMlId(valor) {
    const raw = String(valor || "").trim().toUpperCase();
    if (!raw) return "";

    const mMlbu = raw.match(/^MLBU(\d{8,})$/);
    if (mMlbu?.[1]) return `MLB${mMlbu[1]}`;

    const mMlb = raw.match(/^MLB(\d{8,})$/);
    if (mMlb?.[1]) return `MLB${mMlb[1]}`;

    const mNum = raw.match(/^(\d{8,})$/);
    if (mNum?.[1]) return `MLB${mNum[1]}`;

    return raw;
  }

  function buscarCustoPorId(id) {
    const raw = String(id || "").trim();
    if (!raw) return null;

    if (COST_DB[raw]) return COST_DB[raw];

    const normalizado = normalizarMlId(raw);
    if (COST_DB[normalizado]) return COST_DB[normalizado];

    const semPrefixo = normalizado.replace(/^MLB/i, "");
    if (semPrefixo && COST_DB[semPrefixo]) return COST_DB[semPrefixo];

    const soNumeros = raw.replace(/^MLB/i, "").trim();
    if (/^\d{8,}$/.test(soNumeros)) {
      const comMlb = `MLB${soNumeros}`;
      if (COST_DB[comMlb]) return COST_DB[comMlb];
    }

    return null;
  }

  function buscarValorAposBloco(texto, marcadorRegex, limite = 220) {
    const regex = new RegExp(
      `${marcadorRegex.source}[\\s\\S]{0,${limite}}?A pagar\\s*R\\$\\s*([\\d\\.]+,\\d{2}|[\\d\\.]+)`,
      "i"
    );
    const match = texto.match(regex);
    if (!match?.[1]) return 0;
    return extrairNumeroDeTexto(`R$ ${match[1]}`);
  }

  // ==========================
  // STORAGE / SESSÃO
  // ==========================
  async function getSessao() {
    try {
      const storage = await chrome.storage.local.get([
        "baseAtiva", "baseSelecionada", "token", "user", "venforce_user"
      ]);

      return {
        baseAtiva: storage.baseSelecionada || storage.baseAtiva || null,
        token: storage.token || null,
        user: storage.user || storage.venforce_user || null
      };
    } catch {
      return { baseAtiva: null, token: null, user: null };
    }
  }

  // ==========================
  // CARREGAMENTO DE CUSTOS
  // ==========================
  function clearLoadedBase() {
    COST_DB = {};
    currentBaseId = null;
  }

  async function loadCostsFromApi() {
    const sessao = await getSessao();

    if (!sessao.baseAtiva || !sessao.token) {
      clearLoadedBase();
      return false;
    }

    if (currentBaseId === sessao.baseAtiva && Object.keys(COST_DB).length > 0) {
      return true;
    }

    try {
      const response = await fetch(
        `${API_BASE_URL}/bases/${encodeURIComponent(sessao.baseAtiva)}`,
        { headers: { Authorization: `Bearer ${sessao.token}` } }
      );

      if (!response.ok) {
        const json = await response.json().catch(() => ({}));
        throw new Error(json?.erro || `HTTP ${response.status}`);
      }

      const json = await response.json();
      if (!json?.ok) throw new Error(json?.erro || "Resposta inválida");

      COST_DB = json.dados || {};
      currentBaseId = json.baseId || sessao.baseAtiva;

      console.log("[VenForce] base carregada:", currentBaseId, Object.keys(COST_DB).length, "IDs");
      return true;
    } catch (err) {
      console.warn("[VenForce] falha ao carregar base:", err.message);
      clearLoadedBase();
      return false;
    }
  }

  async function loadCostsLocalFallback() {
    try {
      const url = chrome.runtime.getURL("custos.json");
      const response = await fetch(url);
      if (!response.ok) return false;

      const json = await response.json();
      if (!json || !Object.keys(json).length) return false;

      COST_DB = json;
      currentBaseId = "fallback-local";
      console.log("[VenForce] fallback local carregado");
      return true;
    } catch {
      clearLoadedBase();
      return false;
    }
  }

  async function loadCosts() {
    const ok = await loadCostsFromApi();
    if (!ok) await loadCostsLocalFallback();
  }

  // ==========================
  // ESTILOS (CSS injetado no Shadow DOM)
  function injectStyles(root) {
    if (root.getElementById("venforce-style")) return;

    const style = document.createElement("style");
    style.id = "venforce-style";
    style.textContent = `
      :host, .vf-root {
        --vf-purple: #6b39ff;
        --vf-purple-deep: #5b2be0;
        --vf-purple-soft: #f0ecff;
        --vf-purple-line: #e0d9ff;
        --vf-green: #1a7a42;
        --vf-green-soft: #e8f8ee;
        --vf-green-line: #b4e0c5;
        --vf-yellow: #b45309;
        --vf-yellow-soft: #fff8e1;
        --vf-yellow-line: #fcd34d;
        --vf-red: #c62828;
        --vf-red-soft: #fef0f0;
        --vf-red-line: #f0bdbd;
        --vf-text: #1d1b29;
        --vf-text-m: #5b5670;
        --vf-text-l: #9b94ad;
        --vf-bg: #ffffff;
        --vf-bg-soft: #fefcf7;
        --vf-line: #ece8ff;
        --vf-shadow: 0 4px 16px rgba(91, 43, 224, 0.09), 0 2px 6px rgba(180, 83, 9, 0.07);
        --vf-shadow-lg: 0 14px 36px rgba(91, 43, 224, 0.15), 0 6px 16px rgba(180, 83, 9, 0.09);
      }

      .vf-font {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", Arial, sans-serif;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
      }

      /* ============ CARD POR ANÚNCIO ============ */
      .${BOX_CLASS} {
        position: absolute;
        width: 240px;
        max-width: calc(100vw - 24px);
        border-radius: 12px;
        padding: 8px 10px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", Arial, sans-serif;
        font-size: 11px;
        line-height: 1.3;
        box-sizing: border-box;
        pointer-events: auto;
        box-shadow: var(--vf-shadow);
        border: 1.5px solid transparent;
        transition: box-shadow 0.18s ease, transform 0.18s ease, border-color 0.18s;
        word-wrap: break-word;
        overflow-wrap: break-word;
        background: var(--vf-bg);
        color: var(--vf-text);
        cursor: pointer;
        -webkit-font-smoothing: antialiased;
      }
      .${BOX_CLASS}:hover {
        transform: translateY(-1px);
        box-shadow: var(--vf-shadow-lg);
      }
      .vf-compact {
        width: 110px !important;
        padding: 6px 8px;
      }

      .vf-card-green  {
        background: linear-gradient(160deg, var(--vf-green-soft), #fff 70%);
        border-color: var(--vf-green-line);
      }
      .vf-card-yellow {
        background: linear-gradient(160deg, var(--vf-yellow-soft), #fff 70%);
        border-color: var(--vf-yellow-line);
      }
      .vf-card-red    {
        background: linear-gradient(160deg, var(--vf-red-soft), #fff 70%);
        border-color: var(--vf-red-line);
      }
      .vf-card-gray   {
        background: linear-gradient(160deg, #f5f5f7, #fff 70%);
        border-color: #e5e3ec;
      }

      .vf-id {
        font-size: 9px;
        color: var(--vf-text-l);
        font-weight: 500;
        letter-spacing: 0.02em;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-family: ui-monospace, "SF Mono", Menlo, monospace;
      }

      .vf-mc-big {
        font-size: 15px;
        font-weight: 800;
        line-height: 1.1;
        margin-top: 2px;
        letter-spacing: -0.02em;
      }

      .vf-status-pill {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        font-size: 9px;
        font-weight: 700;
        padding: 1px 6px;
        border-radius: 99px;
        margin-top: 2px;
        letter-spacing: 0.02em;
      }
      .vf-status-saudavel { background: rgba(26, 122, 66, 0.12); color: var(--vf-green); }
      .vf-status-atencao  { background: rgba(138, 92, 0, 0.12); color: var(--vf-yellow); }
      .vf-status-critico  { background: rgba(198, 40, 40, 0.12); color: var(--vf-red); }
      .vf-status-sem-custo { background: rgba(91, 43, 224, 0.10); color: var(--vf-purple-deep); }

      .vf-arrow {
        font-size: 9px;
        opacity: 0.4;
        transition: transform 0.2s;
        display: inline-block;
        margin-left: 2px;
      }
      .vf-arrow.open { transform: rotate(90deg); }

      .vf-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 4px;
      }

      /* Barra de progresso visual */
      .vf-bar-wrap {
        position: relative;
        height: 6px;
        background: rgba(0,0,0,0.06);
        border-radius: 99px;
        overflow: hidden;
        margin-top: 6px;
      }
      .vf-bar-fill {
        position: absolute;
        top: 0;
        bottom: 0;
        left: 0;
        border-radius: 99px;
        transition: width 0.3s ease;
      }
      .vf-bar-fill.saudavel { background: linear-gradient(90deg, #2ea55e, #1a7a42); }
      .vf-bar-fill.atencao  { background: linear-gradient(90deg, #fbbf24, #d97706); }
      .vf-bar-fill.critico  { background: linear-gradient(90deg, #ee5050, #c62828); }
      .vf-bar-fill.neg       { background: linear-gradient(90deg, #ee5050, #c62828); }

      .vf-bar-tick {
        position: absolute;
        top: -1px;
        bottom: -1px;
        width: 1px;
        background: rgba(0,0,0,0.18);
      }

      /* Linha separadora */
      .vf-sep {
        border: none;
        border-top: 1px solid rgba(0,0,0,0.07);
        margin: 6px 0;
      }

      /* Grids de métricas */
      .vf-grid3 {
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        gap: 4px 6px;
        margin-top: 4px;
      }
      .vf-grid2 {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 4px 6px;
        margin-top: 4px;
      }
      .vf-cell {
        display: flex;
        flex-direction: column;
        padding: 3px 0;
      }
      .vf-lbl {
        font-size: 8.5px;
        color: var(--vf-text-l);
        line-height: 1.1;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        font-weight: 600;
      }
      .vf-val {
        font-size: 11px;
        font-weight: 700;
        line-height: 1.2;
        margin-top: 1px;
        color: var(--vf-text);
      }

      .vf-pos { color: var(--vf-green); }
      .vf-neg { color: var(--vf-red); }
      .vf-neu { color: var(--vf-yellow); }

      .vf-section-title {
        font-size: 9px;
        font-weight: 700;
        opacity: 0.55;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        margin-bottom: 2px;
      }

      .vf-hint-line {
        margin-top: 5px;
        padding: 4px 6px;
        background: rgba(245, 158, 11, 0.07);
        border-left: 2px solid #f59e0b;
        border-radius: 4px;
        font-size: 9.5px;
        color: var(--vf-text-m);
        line-height: 1.3;
      }
      .vf-hint-line b { color: #b45309; font-weight: 700; }

      .vf-mini-actions {
        display: flex;
        gap: 4px;
        margin-top: 6px;
        flex-wrap: wrap;
      }
      .vf-chip {
        font-size: 9px;
        padding: 3px 7px;
        border-radius: 99px;
        border: 1px solid var(--vf-purple-line);
        background: var(--vf-purple-soft);
        color: var(--vf-purple-deep);
        cursor: pointer;
        font-weight: 600;
        transition: background 0.15s, transform 0.1s;
        font-family: inherit;
      }
      .vf-chip:hover { background: #e6dfff; }
      .vf-chip:active { transform: scale(0.96); }
      .vf-chip.copied { background: var(--vf-green-soft); color: var(--vf-green); border-color: var(--vf-green-line); }

      /* ============ HUD FLUTUANTE ============ */
      .vf-hud {
        position: fixed;
        z-index: 2000000000;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", Arial, sans-serif;
        -webkit-font-smoothing: antialiased;
        pointer-events: auto;
        user-select: none;
      }

      .vf-hud-panel {
        width: 320px;
        background: var(--vf-bg);
        border-radius: 14px;
        box-shadow: var(--vf-shadow-lg);
        border: 1px solid var(--vf-line);
        overflow: hidden;
        display: flex;
        flex-direction: column;
        max-height: calc(100vh - 100px);
      }

      .vf-hud-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 12px;
        background: linear-gradient(135deg, #7d4dff, #5b2be0);
        color: #fff;
        cursor: grab;
        flex-shrink: 0;
      }
      .vf-hud-header:active { cursor: grabbing; }

      .vf-hud-brand {
        display: flex;
        align-items: center;
        gap: 7px;
        font-weight: 700;
        font-size: 13px;
        letter-spacing: -0.02em;
      }
      .vf-hud-brand-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #e9d5ff;
        box-shadow: 0 0 8px rgba(233, 213, 255, 0.85);
        animation: vf-pulse 2s ease-in-out infinite;
      }
      @keyframes vf-pulse {
        0%, 100% { opacity: 1; }
        50%      { opacity: 0.4; }
      }
      .vf-hud-base {
        font-size: 9.5px;
        opacity: 0.9;
        font-weight: 500;
        letter-spacing: 0.02em;
        font-family: ui-monospace, "SF Mono", Menlo, monospace;
        max-width: 120px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .vf-hud-actions {
        display: flex;
        gap: 4px;
      }
      .vf-icon-btn {
        background: rgba(255,255,255,0.18);
        border: none;
        color: #fff;
        width: 24px;
        height: 24px;
        border-radius: 7px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 13px;
        line-height: 1;
        padding: 0;
        transition: background 0.15s;
        font-family: inherit;
      }
      .vf-icon-btn:hover { background: rgba(255,255,255,0.32); }
      .vf-icon-btn:active { background: rgba(255,255,255,0.45); }

      .vf-hud-body {
        padding: 12px;
        overflow-y: auto;
        overflow-x: hidden;
        flex: 1;
      }
      .vf-hud-body::-webkit-scrollbar { width: 6px; }
      .vf-hud-body::-webkit-scrollbar-thumb { background: #d8d0ff; border-radius: 99px; }

      /* Cards de estatísticas */
      .vf-stats-grid {
        display: grid;
        grid-template-columns: 1fr 1fr 1fr 1fr;
        gap: 6px;
        margin-bottom: 10px;
      }
      .vf-stat-box {
        background: var(--vf-bg-soft);
        border: 1px solid var(--vf-line);
        border-radius: 9px;
        padding: 7px 4px;
        text-align: center;
        cursor: pointer;
        transition: transform 0.1s, box-shadow 0.15s, border-color 0.15s;
      }
      .vf-stat-box:hover {
        transform: translateY(-1px);
        box-shadow: 0 3px 10px rgba(91, 43, 224, 0.10);
      }
      .vf-stat-box.active-filter {
        border-color: var(--vf-purple);
        box-shadow: 0 0 0 2px rgba(107, 57, 255, 0.15);
        background: var(--vf-purple-soft);
      }
      .vf-stat-num {
        font-size: 16px;
        font-weight: 800;
        line-height: 1.1;
        letter-spacing: -0.02em;
      }
      .vf-stat-lbl {
        font-size: 8.5px;
        font-weight: 600;
        margin-top: 2px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        opacity: 0.7;
      }
      .vf-stat-box.tot   .vf-stat-num { color: var(--vf-purple-deep); }
      .vf-stat-box.tot   .vf-stat-lbl { color: var(--vf-purple-deep); }
      .vf-stat-box.sau   .vf-stat-num { color: var(--vf-green); }
      .vf-stat-box.sau   .vf-stat-lbl { color: var(--vf-green); }
      .vf-stat-box.ate   .vf-stat-num { color: var(--vf-yellow); }
      .vf-stat-box.ate   .vf-stat-lbl { color: var(--vf-yellow); }
      .vf-stat-box.cri   .vf-stat-num { color: var(--vf-red); }
      .vf-stat-box.cri   .vf-stat-lbl { color: var(--vf-red); }

      /* Linha de resumo */
      .vf-summary-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px;
        margin-bottom: 10px;
      }
      .vf-summary-box {
        background: linear-gradient(135deg, var(--vf-purple-soft), #fff);
        border: 1px solid var(--vf-purple-line);
        border-radius: 9px;
        padding: 7px 9px;
      }
      .vf-summary-lbl {
        font-size: 8.5px;
        color: var(--vf-purple-deep);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .vf-summary-val {
        font-size: 13px;
        font-weight: 800;
        color: var(--vf-text);
        line-height: 1.2;
        margin-top: 1px;
        letter-spacing: -0.02em;
      }

      /* Highlights melhor/pior */
      .vf-highlights {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px;
        margin-bottom: 10px;
      }
      .vf-highlight {
        border-radius: 9px;
        padding: 7px 9px;
        font-size: 10px;
        cursor: pointer;
        transition: transform 0.1s;
      }
      .vf-highlight:hover { transform: translateY(-1px); }
      .vf-highlight.best { background: var(--vf-green-soft); border: 1px solid var(--vf-green-line); }
      .vf-highlight.worst { background: var(--vf-red-soft); border: 1px solid var(--vf-red-line); }
      .vf-highlight-title {
        font-size: 8.5px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        margin-bottom: 1px;
      }
      .vf-highlight.best .vf-highlight-title { color: var(--vf-green); }
      .vf-highlight.worst .vf-highlight-title { color: var(--vf-red); }
      .vf-highlight-id {
        font-size: 9.5px;
        font-family: ui-monospace, "SF Mono", Menlo, monospace;
        font-weight: 600;
        color: var(--vf-text);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .vf-highlight-val {
        font-size: 12px;
        font-weight: 800;
        letter-spacing: -0.02em;
        margin-top: 1px;
      }
      .vf-highlight.best .vf-highlight-val { color: var(--vf-green); }
      .vf-highlight.worst .vf-highlight-val { color: var(--vf-red); }

      /* Controles */
      .vf-controls {
        display: flex;
        flex-direction: column;
        gap: 7px;
        margin-bottom: 10px;
      }
      .vf-input {
        width: 100%;
        padding: 7px 10px;
        border-radius: 8px;
        border: 1px solid var(--vf-line);
        font-size: 12px;
        font-family: inherit;
        background: var(--vf-bg-soft);
        color: var(--vf-text);
        box-sizing: border-box;
        transition: border-color 0.15s, box-shadow 0.15s;
      }
      .vf-input:focus {
        outline: none;
        border-color: var(--vf-purple);
        box-shadow: 0 0 0 3px rgba(107, 57, 255, 0.12);
      }
      .vf-select {
        width: 100%;
        padding: 7px 10px;
        border-radius: 8px;
        border: 1px solid var(--vf-line);
        font-size: 11px;
        background: var(--vf-bg-soft);
        cursor: pointer;
        font-family: inherit;
        color: var(--vf-text);
      }

      .vf-action-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px;
        margin-bottom: 8px;
      }

      .vf-btn {
        padding: 8px 10px;
        border-radius: 8px;
        border: none;
        font-weight: 600;
        font-size: 11px;
        cursor: pointer;
        transition: background 0.15s, transform 0.1s, box-shadow 0.15s;
        font-family: inherit;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        line-height: 1;
      }
      .vf-btn-primary {
        background: linear-gradient(135deg, #7d4dff, #5b2be0);
        color: #fff;
      }
      .vf-btn-primary:hover { box-shadow: 0 3px 10px rgba(91, 43, 224, 0.25); }
      .vf-btn-primary:active { transform: scale(0.98); }
      .vf-btn-secondary {
        background: var(--vf-purple-soft);
        color: var(--vf-purple-deep);
        border: 1px solid var(--vf-purple-line);
      }
      .vf-btn-secondary:hover { background: #e2dbff; }

      /* Status fixo no rodapé do HUD */
      .vf-hud-footer {
        padding: 8px 12px;
        border-top: 1px solid var(--vf-line);
        background: var(--vf-bg-soft);
        font-size: 9.5px;
        color: var(--vf-text-m);
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-shrink: 0;
      }
      .vf-hud-footer-info {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      /* HUD minimizado (pílula) */
      .vf-hud-pill {
        background: linear-gradient(135deg, #7d4dff, #5b2be0);
        color: #fff;
        padding: 9px 14px;
        border-radius: 99px;
        box-shadow: var(--vf-shadow-lg);
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 8px;
        font-weight: 700;
        font-size: 12px;
        transition: transform 0.15s, box-shadow 0.15s;
        border: 2px solid rgba(255,255,255,0.15);
      }
      .vf-hud-pill:hover {
        transform: translateY(-1px);
        box-shadow: 0 16px 36px rgba(91, 43, 224, 0.32);
      }
      .vf-hud-pill-mc {
        background: rgba(255,255,255,0.22);
        padding: 2px 8px;
        border-radius: 99px;
        font-size: 11px;
        font-weight: 700;
      }
      .vf-hud-pill-icon {
        font-size: 14px;
        line-height: 1;
      }

      /* Sem base / desativado */
      .vf-hud-empty {
        padding: 14px 12px;
        text-align: center;
        font-size: 11.5px;
        color: var(--vf-text-m);
        line-height: 1.45;
      }
      .vf-hud-empty strong { color: var(--vf-purple-deep); }

      /* Painel de configurações */
      .vf-settings {
        padding: 12px;
        border-top: 1px solid var(--vf-line);
        background: var(--vf-bg-soft);
      }
      .vf-settings-title {
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--vf-purple-deep);
        margin-bottom: 8px;
      }
      .vf-settings-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 7px;
        font-size: 11px;
        color: var(--vf-text);
      }
      .vf-settings-row label { flex: 1; cursor: pointer; }
      .vf-settings-row input[type="number"] {
        width: 56px;
        padding: 4px 6px;
        border-radius: 6px;
        border: 1px solid var(--vf-line);
        font-size: 11px;
        text-align: center;
        font-family: inherit;
        background: var(--vf-bg);
      }
      .vf-settings-row input[type="checkbox"] {
        width: 16px;
        height: 16px;
        accent-color: var(--vf-purple);
        cursor: pointer;
      }

      .vf-toast {
        position: fixed;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%) translateY(20px);
        background: var(--vf-text);
        color: #fff;
        padding: 10px 18px;
        border-radius: 12px;
        font-size: 12px;
        font-weight: 600;
        z-index: 2147483647;
        box-shadow: 0 8px 24px rgba(0,0,0,0.30);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", Arial, sans-serif;
        opacity: 0;
        transition: opacity 0.25s, transform 0.25s;
        pointer-events: none;
      }
      .vf-toast.show {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }
      .vf-toast.ok { background: #1e3a2b; border: 1px solid var(--vf-green); }
      .vf-toast.err { background: #3a1e1e; border: 1px solid var(--vf-red); }

      /* Linhas destacadas na página */
      .vf-row-highlight-critico {
        outline: 2px solid var(--vf-red) !important;
        outline-offset: -1px;
        border-radius: 8px;
      }
      .vf-row-highlight-saudavel {
        outline: 2px solid var(--vf-green) !important;
        outline-offset: -1px;
        border-radius: 8px;
      }


      /* ============ VENFORCE GO PREMIUM v1.2 ============ */
      .vf-root, :host {
        --vf-brand-grad: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 45%, #5b21b6 100%);
        --vf-surface-glass: rgba(255, 255, 255, 0.94);
        --vf-shadow-premium: 0 18px 55px rgba(17, 24, 39, 0.14), 0 8px 22px rgba(109, 40, 217, 0.12);
      }

      .vf-hud-panel {
        width: 350px;
        border-radius: 22px;
        border: 1px solid rgba(109, 40, 217, 0.16);
        background: var(--vf-surface-glass);
        backdrop-filter: blur(14px);
        box-shadow: var(--vf-shadow-premium);
      }

      .vf-hud-header {
        padding: 13px 14px;
        background: var(--vf-brand-grad);
        border-bottom: 1px solid rgba(255,255,255,0.16);
      }

      .vf-hud-brand {
        font-size: 14px;
        letter-spacing: -0.03em;
      }

      .vf-hud-base {
        max-width: 145px;
        padding: 2px 7px;
        border-radius: 999px;
        background: rgba(255,255,255,0.16);
        color: rgba(255,255,255,0.92);
      }

      .vf-hud-body {
        padding: 14px;
        background: linear-gradient(180deg, #ffffff 0%, #fdfaf4 100%);
      }

      .vf-stats-grid {
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 8px;
      }

      .vf-stat-box {
        border-radius: 14px;
        padding: 10px 5px;
        border-color: #eee9ff;
        background: #ffffff;
        box-shadow: 0 8px 20px rgba(17,24,39,0.04);
      }

      .vf-stat-num {
        font-size: 18px;
      }

      .vf-summary-box,
      .vf-highlight,
      .vf-input,
      .vf-select,
      .vf-settings {
        border-radius: 14px;
      }

      .vf-btn {
        border-radius: 12px;
        padding: 9px 11px;
        font-weight: 800;
      }

      .vf-btn-primary {
        background: var(--vf-brand-grad);
        box-shadow: 0 10px 20px rgba(109,40,217,0.18);
      }

      .vf-btn-secondary {
        background: #f6f3ff;
      }

      .vf-hud-footer {
        padding: 10px 14px;
        background: #fefcf7;
      }

      .${BOX_CLASS} {
        width: 270px;
        border-radius: 16px;
        border-width: 1px;
        box-shadow: 0 10px 28px rgba(17,24,39,0.10), 0 4px 12px rgba(109,40,217,0.08);
      }

      .vf-compact {
        width: 132px !important;
        padding: 8px 9px;
      }

      .vf-id {
        font-size: 9.5px;
      }

      .vf-mc-big {
        font-size: 17px;
      }

      .vf-compact .vf-mc-big {
        font-size: 16px;
      }

      .vf-compact-lc {
        margin-top: 4px;
        font-size: 9.5px;
        font-weight: 800;
        color: var(--vf-text-m);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .vf-status-pill {
        padding: 2px 7px;
        font-size: 9px;
      }

      .vf-card-green {
        border-color: rgba(22, 163, 74, 0.32);
        background: linear-gradient(160deg, #ecfdf5, #fffef9 70%);
      }
      .vf-card-yellow {
        border-color: rgba(217, 119, 6, 0.38);
        background: linear-gradient(160deg, #fffbeb, #fffef9 70%);
      }
      .vf-card-red {
        border-color: rgba(198, 40, 40, 0.34);
      }

      .vf-hint-line {
        border-radius: 10px;
        padding: 7px 8px;
      }

      .vf-toast {
        border-radius: 999px;
        padding: 11px 18px;
        font-weight: 800;
      }

      @media (max-width: 900px) {
        .vf-hud-panel { width: 320px; }
        .${BOX_CLASS} { width: 250px; }
        .vf-compact { width: 126px !important; }
      }
    `;

    root.appendChild(style);
  }

  // ==========================
  // DETECÇÃO DE LINHAS DO ML
  // ==========================
  function isRowCandidate(el) {
    const t = getTextoLimpo(el);
    if (!t) return false;

    const hasId = /#\d{8,}/.test(t) || /\b\d{8,}\b/.test(t);
    const hasPrice = /R\$\s*[\d\.]+,\d{2}/.test(t);
    const hasCommission = /Clássico|Classico|Premium|Tarifa de venda/i.test(t);
    const hasShipping = /Envio por conta do comprador|Você oferece frete grátis|Frete grátis|por usar o Flex|A pagar R\$/i.test(t);

    if (!hasId || !hasPrice || !hasCommission || !hasShipping) return false;

    const rect = el.getBoundingClientRect();
    if (rect.width < 700 || rect.height < 90 || rect.height > 700) return false;

    const hasCheckbox = !!el.querySelector('input[type="checkbox"]');
    if (!hasCheckbox && rect.width < 900) return false;

    return true;
  }

  function getPainelRows() {
    const candidates = Array.from(
      document.querySelectorAll("div, section, article, [role='row']")
    ).filter(isRowCandidate);

    return candidates
      .filter(el => !candidates.some(other => other !== el && el.contains(other)))
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
  }

  function extrairIdPainel(row) {
    const t = getTextoLimpo(row);
    const idCompleto = t.match(/\b(MLB|MLBU)\s*#?\s*(\d{8,})\b/i);
    if (idCompleto?.[1] && idCompleto?.[2]) {
      const merged = `${idCompleto[1].toUpperCase()}${idCompleto[2]}`;
      return PLATAFORMA === "ml" ? normalizarMlId(merged) : merged;
    }

    const idNumerico = (t.match(/#(\d{8,})/)?.[1]) || (t.match(/\b(\d{8,})\b/)?.[1]) || null;
    if (!idNumerico) return null;
    return PLATAFORMA === "ml" ? normalizarMlId(idNumerico) : idNumerico;
  }

  // ==========================
  // EXTRAÇÃO DE DADOS
  // ==========================
  function extrairPrecoVenda(row) {
    const textoRow = getTextoLimpo(row);
    const textoSemAtacado = textoRow.replace(
      /(?:com\s+\d+\s+preços?\s+de\s+atacado|preços?\s+de\s+atacado)[\s\S]{0,300}?(?=\n\n|\nClássico|\nPremium|\nTarifa|$)/gi,
      ""
    );
    const linhas = getLinhas(textoSemAtacado);

    let precoCheio = 0;
    let precoPromocional = 0;

    const matchVendePor = textoRow.match(
      /você vende por\s+R\$\s*([\d\.]+(?:,\d{1,2})?)\s+na\s+promo[çc][aã]o/i
    );

    if (matchVendePor?.[1]) {
      precoPromocional = extrairNumeroDeTexto(`R$ ${matchVendePor[1]}`);
      const idxVendePor = textoRow.toLowerCase().indexOf("você vende por");
      const textAntes = idxVendePor >= 0 ? textoRow.slice(0, idxVendePor) : "";
      const matchCheio = [...textAntes.matchAll(/R\$\s*([\d\.]+(?:,\d{1,2})?)/gi)];
      if (matchCheio.length) {
        const candidato = extrairNumeroDeTexto(`R$ ${matchCheio[matchCheio.length - 1][1]}`);
        if (candidato > precoPromocional) precoCheio = candidato;
      }
      if (!precoCheio) precoCheio = precoPromocional;
      return { precoVenda: precoPromocional, precoCheio, precoPromocional };
    }

    for (let i = 0; i < linhas.length; i++) {
      const linha = linhas[i];
      if (!precoCheio && /^R\$\s*[\d\.]+,\d{2}$/i.test(linha)) {
        const prox = `${linhas[i + 1] || ""} ${linhas[i + 2] || ""} ${linhas[i + 3] || ""}`;
        if (/em promoção|na promoção|promoção|promocao/i.test(prox)) {
          precoCheio = extrairNumeroDeTexto(linha);
          const promoMatch = prox.match(/R\$\s*([\d\.]+,\d{2}|[\d\.]+)/i);
          if (promoMatch?.[1]) precoPromocional = extrairNumeroDeTexto(`R$ ${promoMatch[1]}`);
          break;
        }
      }
    }

    if (!precoCheio) {
      const todos = extrairTodosOsPrecosDoTexto(textoSemAtacado);
      if (todos.length) precoCheio = todos[0];
    }

    if (!precoPromocional) {
      const m = textoSemAtacado.match(
        /(?:em promoção|na promoção)[\s\S]{0,40}?(?:a\s*)?R\$\s*([\d\.]+,\d{2}|[\d\.]+)/i
      );
      if (m?.[1]) precoPromocional = extrairNumeroDeTexto(`R$ ${m[1]}`);
    }

    const precoVenda = precoPromocional || precoCheio || 0;
    return { precoVenda, precoCheio: precoCheio || precoVenda, precoPromocional };
  }

  function extrairComissaoInfo(row, precoVenda) {
    const t = getTextoLimpo(row);
    let valor = buscarValorAposBloco(t, /(Clássico|Classico|Premium|Tarifa de venda)/i, 220);

    if (!valor) {
      const m = t.match(/(Clássico|Classico|Premium|Tarifa de venda)[\s\S]{0,220}?A pagar\s*R\$\s*([\d\.]+,\d{2}|[\d\.]+)/i);
      if (m?.[2]) valor = extrairNumeroDeTexto(`R$ ${m[2]}`);
    }

    const percentual = precoVenda > 0 && valor > 0 ? (valor / precoVenda) * 100 : 0;
    return { percentual, valor };
  }

  function extrairValorPorRotulo(texto, rotulos, janela = 100) {
    for (const rotulo of rotulos) {
      const re = new RegExp(
        `${rotulo}[\\s\\S]{0,${janela}}?-?R\\$\\s*([\\d\\.]+,\\d{2}|[\\d\\.]+)`,
        "i"
      );
      const m = texto.match(re);
      if (m?.[1]) return extrairNumeroDeTexto(`R$ ${m[1]}`);
    }
    return 0;
  }

  function normalizarTextoFrete(texto) {
    return String(texto || "")
      .replace(/\u00a0/g, " ")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  // ---------------------------------------------------------------------------
  // HELPERS de extração de valor monetário
  // ---------------------------------------------------------------------------

  // Extrai o primeiro valor no formato "1.234,56" ou "1234,56" ou "1234.56"
  function extrairPrimeiroValorMoeda(texto) {
    const m = String(texto || "").match(/(\d{1,3}(?:\.\d{3})*,\d{1,2}|\d+,\d{1,2}|\d+(?:\.\d+)?)/);
    if (!m?.[1]) return 0;
    return numeroSeguro(m[1]);
  }

  // Extrai o primeiro valor monetário que aparece APÓS o marcador no texto
  function extrairValorDepoisDe(texto, marcador) {
    const idx = String(texto || "").indexOf(marcador);
    if (idx < 0) return 0;
    return extrairPrimeiroValorMoeda(String(texto).slice(idx + marcador.length));
  }

  // ---------------------------------------------------------------------------
  // HELPER: coleta sub-elementos da row que contêm texto de frete,
  // ordena do menor (mais específico) para o maior.
  // ---------------------------------------------------------------------------
  function coletarTextosCandidatosFrete(row) {
    const vistos = new Set();
    const candidatos = [];

    const add = (el, origem) => {
      const raw = (
        (el?.innerText || "").trim() ||
        (el?.textContent || "").trim()
      )
        .replace(/ /g, " ")
        .replace(/\s+/g, " ")
        .trim();

      const norm = normalizarTextoFrete(raw);
      if (!norm || vistos.has(norm)) return;

      const temFrete =
        norm.includes("frete") ||
        norm.includes("envio") ||
        norm.includes("voce paga") ||
        norm.includes("custo de envio");

      if (!temFrete) return;

      vistos.add(norm);
      candidatos.push({ raw, norm, origem, len: norm.length });
    };

    add(row, "row");
    row.querySelectorAll("div, span, p, section, article, td, li").forEach(el => {
      add(el, "child");
    });

    return candidatos.sort((a, b) => a.len - b.len);
  }

  // ---------------------------------------------------------------------------
  // EXTRAÇÃO DE FRETE — candidatos ordenados por especificidade
  // ---------------------------------------------------------------------------
  function extrairFrete(row) {
    window.__VF_FRETE_DEBUG_COUNT = window.__VF_FRETE_DEBUG_COUNT || 0;
    const debugAtivo = window.__VF_FRETE_DEBUG_COUNT < 5;

    const candidatos = coletarTextosCandidatosFrete(row);

    // Termos que indicam linha de comissão — nunca usar como frete
    const reComissao = /tarifa de venda|premium a pagar|classico a pagar|comissao/i;

    let freteFinal = 0;
    let candidatoUsado = null;

    for (const c of candidatos) {
      const t = c.norm;

      // Bloquear candidatos que são claramente linhas de comissão
      if (reComissao.test(t)) continue;
      // Bloquear "voce recebe" sem contexto de frete
      if (t.includes("voce recebe") && !t.includes("frete") && !t.includes("custo de envio")) continue;

      // A) Comprador paga o envio → frete do vendedor = 0
      if (t.includes("envio por conta do comprador")) {
        freteFinal = 0;
        candidatoUsado = c;
        break;
      }

      // B) Custo de envio explícito (Full / Mercado Livre / genérico)
      if (t.includes("custo de envio do mercado livre")) {
        const v = extrairValorDepoisDe(t, "custo de envio do mercado livre");
        if (v > 0) { freteFinal = v; candidatoUsado = c; break; }
      }
      if (t.includes("custo de envio full")) {
        const v = extrairValorDepoisDe(t, "custo de envio full");
        if (v > 0) { freteFinal = v; candidatoUsado = c; break; }
      }
      if (t.includes("custo de envio")) {
        const v = extrairValorDepoisDe(t, "custo de envio");
        if (v > 0) { freteFinal = v; candidatoUsado = c; break; }
      }

      // C) Frete grátis + "voce paga" → pegar primeiro valor após "voce paga"
      const temFreteGratis =
        t.includes("frete gratis") ||
        t.includes("voce oferece frete gratis");

      if (temFreteGratis && t.includes("voce paga")) {
        const v = extrairValorDepoisDe(t, "voce paga");
        if (v > 0) { freteFinal = v; candidatoUsado = c; break; }
      }

      // D) Frete grátis + "A pagar R$ X" (sem marcador de comissão no candidato)
      if (temFreteGratis && t.includes("a pagar")) {
        const v = extrairValorDepoisDe(t, "a pagar");
        if (v > 0) { freteFinal = v; candidatoUsado = c; break; }
      }
    }

    if (debugAtivo) {
      window.__VF_FRETE_DEBUG_COUNT++;
      console.group("[VF FRETE DEBUG] #" + window.__VF_FRETE_DEBUG_COUNT);
      console.log("id provável:", extrairIdPainel(row));
      console.log("candidato usado:", candidatoUsado
        ? { origem: candidatoUsado.origem, norm: candidatoUsado.norm.substring(0, 200) }
        : null);
      console.log("candidatos:", candidatos.map(c => ({
        origem: c.origem,
        len: c.len,
        norm: c.norm.substring(0, 200)
      })));
      console.log("frete extraído:", freteFinal);
      console.groupEnd();
    }

    return freteFinal;
  }

  // ==========================
  // CÁLCULOS (estendido)
  // ==========================
  function calcular(precoVenda, custoInfo, comissaoInfo, frete) {
    const custo = numeroSeguro(custoInfo?.custo_produto);
    const impostoPct = normalizarPercentual(custoInfo?.imposto_percentual);
    const taxaFixa = numeroSeguro(custoInfo?.taxa_fixa);
    const comissaoValor = numeroSeguro(comissaoInfo?.valor);
    const comissaoPct = precoVenda > 0 ? (comissaoValor / precoVenda) * 100 : 0;
    const impostoValor = (precoVenda * impostoPct) / 100;

    // LC = preço - comissão - frete - imposto - custo - taxa fixa
    const lc = precoVenda - comissaoValor - frete - impostoValor - custo - taxaFixa;
    const mc = precoVenda > 0 ? (lc / precoVenda) * 100 : 0;

    // Métricas adicionais
    const custoTotal = custo + taxaFixa;
    const markup = custoTotal > 0 ? ((precoVenda - custoTotal) / custoTotal) * 100 : 0;
    const roi = custoTotal > 0 ? (lc / custoTotal) * 100 : 0;

    // Break-even: preço onde LC = 0
    // precoBE - (comissaoPct/100)*precoBE - frete - (impostoPct/100)*precoBE - custo - taxaFixa = 0
    // precoBE * (1 - comissaoPct/100 - impostoPct/100) = frete + custo + taxaFixa
    const fatorLiquido = 1 - (comissaoPct / 100) - (impostoPct / 100);
    const breakEven = fatorLiquido > 0
      ? (frete + custo + taxaFixa) / fatorLiquido
      : 0;

    // Preço sugerido para atingir margem alvo
    // mcAlvo = (precoAlvo - comissaoPct*precoAlvo - frete - impostoPct*precoAlvo - custo - taxaFixa) / precoAlvo
    // precoAlvo * (1 - comissaoPct/100 - impostoPct/100 - mcAlvo/100) = frete + custo + taxaFixa
    const mcAlvo = numeroSeguro(prefs.margemAlvo);
    const fatorAlvo = 1 - (comissaoPct / 100) - (impostoPct / 100) - (mcAlvo / 100);
    const precoSugerido = fatorAlvo > 0
      ? (frete + custo + taxaFixa) / fatorAlvo
      : 0;

    return {
      precoVenda, custo, taxaFixa, impostoPct, impostoValor,
      comissaoPct, comissaoValor, frete, lc, mc,
      markup, roi, breakEven, precoSugerido, mcAlvo
    };
  }

  // ==========================
  // OVERLAY / SHADOW DOM
  // ==========================
  function ensureOverlay() {
    let overlay = document.getElementById(OVERLAY_ID);
    if (overlay) return overlay;

    overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.style.cssText = "position:absolute;top:0;left:0;width:100%;pointer-events:none;z-index:999999;";
    document.body.appendChild(overlay);

    const root = overlay.attachShadow({ mode: "open" });
    injectStyles(root);

    // Container do HUD
    const hudWrap = document.createElement("div");
    hudWrap.className = "vf-hud vf-font";
    hudWrap.id = "vf-hud-wrap";
    root.appendChild(hudWrap);

    // Toast container
    const toastEl = document.createElement("div");
    toastEl.className = "vf-toast vf-font";
    toastEl.id = "vf-toast";
    root.appendChild(toastEl);

    return overlay;
  }

  function getOverlayRoot() {
    const overlay = ensureOverlay();
    if (!overlay.shadowRoot) {
      const root = overlay.attachShadow({ mode: "open" });
      injectStyles(root);
    }
    return overlay.shadowRoot;
  }

  function syncOverlaySize() {
    const overlay = ensureOverlay();
    const body = document.body;
    const html = document.documentElement;
    overlay.style.width = `${Math.max(body.scrollWidth, body.offsetWidth, html.clientWidth, html.scrollWidth, html.offsetWidth)}px`;
    overlay.style.height = `${Math.max(body.scrollHeight, body.offsetHeight, html.clientHeight, html.scrollHeight, html.offsetHeight)}px`;
  }

  // ==========================
  // TOAST
  // ==========================
  function showToast(msg, tipo = "ok", duracao = 2000) {
    const root = getOverlayRoot();
    const toast = root.getElementById("vf-toast");
    if (!toast) return;

    toast.className = `vf-toast vf-font ${tipo} show`;
    toast.textContent = msg;

    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => {
      toast.className = `vf-toast vf-font ${tipo}`;
    }, duracao);
  }

  // ==========================
  // CARDS DE ANÚNCIO
  // ==========================
  function getBoxKey(row, index) {
    const id = extrairIdPainel(row);
    return id ? `vf-box-${id}-${index}` : `vf-box-index-${index}`;
  }

  function ensureBox(key) {
    const root = getOverlayRoot();
    let box = root.querySelector(`[data-vf-key="${key}"]`);
    if (box) return box;

    box = document.createElement("div");
    box.className = `${BOX_CLASS} vf-card-green vf-font`;
    box.setAttribute("data-vf-key", key);
    box.setAttribute("data-expanded", "false");
    root.appendChild(box);
    return box;
  }

  function renderSemCusto(box, id) {
    box.className = `${BOX_CLASS} vf-card-gray vf-compact vf-font`;
    box.setAttribute("data-vf-status", "sem_custo");
    box.innerHTML = `
      <div class="vf-id" title="${id || ""}">${id || "—"}</div>
      <div class="vf-status-pill vf-status-sem-custo" style="margin-top:4px;">
        Sem custo
      </div>
      <div style="font-size:8.5px;opacity:0.45;margin-top:4px;">
        Base: ${currentBaseId || "nenhuma"}
      </div>
    `;
    box.onclick = null;
  }

  function renderErroExtracao(box, id) {
    box.className = `${BOX_CLASS} vf-card-red vf-compact vf-font`;
    box.setAttribute("data-vf-status", "erro");
    box.innerHTML = `
      <div class="vf-id" title="${id || ""}">${id || "—"}</div>
      <div class="vf-status-pill vf-status-critico" style="margin-top:4px;">
        ⚠ Erro
      </div>
    `;
    box.onclick = null;
  }

  function renderBox(box, id, dados, extras = {}) {
    const status = getStatusByMc(dados.mc);
    const cardCls = getCardColorClassByMc(dados.mc);
    const expanded = box.getAttribute("data-expanded") === "true";
    const temPromo = (extras.precoPromocional || 0) > 0 && extras.precoPromocional !== extras.precoCheio;

    box.setAttribute("data-vf-status", status.tipo);
    box.setAttribute("data-vf-mc", String(dados.mc));
    box.setAttribute("data-vf-id", id);

    box.onclick = (e) => {
      // Não fechar se clicou em chip/botão
      if (e.target.closest('.vf-chip')) return;
      box.setAttribute("data-expanded", String(!expanded));
      renderBox(box, id, dados, extras);
      requestAnimationFrame(() => scheduleProcess());
    };

    box.className = `${BOX_CLASS} ${cardCls} vf-font${expanded ? "" : " vf-compact"}`;

    // Barra de progresso (margem visual)
    const mcRange = Math.max(0, Math.min(30, dados.mc)); // 0–30% visual
    const barPct = (mcRange / 30) * 100;
    const barCls = status.tipo === "critico" ? "critico" : status.tipo === "atencao" ? "atencao" : "saudavel";
    const barFill = dados.mc < 0
      ? `<div class="vf-bar-fill neg" style="width:100%"></div>`
      : `<div class="vf-bar-fill ${barCls}" style="width:${barPct.toFixed(1)}%"></div>`;

    // Ticks visuais nos thresholds
    const tickAtencao = (prefs.thresholdAtencao / 30) * 100;
    const tickSaudavel = (prefs.thresholdSaudavel / 30) * 100;

    if (!expanded) {
      box.innerHTML = `
        <div class="vf-row">
          <div style="min-width:0;flex:1;">
            <div class="vf-id" title="${id}">${id}</div>
            <div class="vf-mc-big ${classeNumero(dados.mc)}">${porcentagem(dados.mc, 1)}</div>
            <div class="vf-status-pill ${status.classe}">
              ${status.texto}
            </div>
            <div class="vf-compact-lc ${classeNumero(dados.lc)}">LC ${moeda(dados.lc)}</div>
          </div>
          <div class="vf-arrow" style="flex-shrink:0;">▶</div>
        </div>
        <div class="vf-bar-wrap" style="margin-top:5px;">
          ${barFill}
          <div class="vf-bar-tick" style="left:${tickAtencao}%"></div>
          <div class="vf-bar-tick" style="left:${tickSaudavel}%"></div>
        </div>
      `;
      return;
    }

    // Expanded view
    const taxaLine = dados.taxaFixa > 0
      ? `<div class="vf-cell"><span class="vf-lbl">Taxa fixa</span><span class="vf-val">${moeda(dados.taxaFixa)}</span></div>`
      : "";

    box.innerHTML = `
      <div class="vf-row" style="margin-bottom:5px;">
        <span style="font-size:9px;font-weight:800;opacity:0.55;letter-spacing:0.06em;">VENFORCE</span>
        <span class="vf-status-pill ${status.classe}">${status.texto}</span>
        <div class="vf-arrow open">▶</div>
      </div>

      <div class="vf-row" style="margin-bottom:4px;">
        <div class="vf-id" style="flex:1;" title="${id}">${id}</div>
        <button class="vf-chip" data-action="copy-id" title="Copiar ID">📋</button>
      </div>

      <div class="vf-bar-wrap" style="margin-top:2px;">
        ${barFill}
        <div class="vf-bar-tick" style="left:${tickAtencao}%"></div>
        <div class="vf-bar-tick" style="left:${tickSaudavel}%"></div>
      </div>

      <div style="margin-top:6px;display:flex;justify-content:space-between;align-items:baseline;">
        <span class="vf-lbl">Margem</span>
        <span class="vf-mc-big ${classeNumero(dados.mc)}">${porcentagem(dados.mc, 2)}</span>
      </div>

      <hr class="vf-sep">

      <div class="vf-section-title">Receita</div>
      <div class="vf-grid2">
        <div class="vf-cell"><span class="vf-lbl">Venda</span><span class="vf-val">${moeda(dados.precoVenda)}</span></div>
        ${temPromo
          ? `<div class="vf-cell"><span class="vf-lbl">Cheio (s/ promo)</span><span class="vf-val" style="opacity:0.7;text-decoration:line-through;">${moeda(extras.precoCheio)}</span></div>`
          : `<div class="vf-cell"><span class="vf-lbl">Lucro líquido</span><span class="vf-val ${classeNumero(dados.lc)}">${moeda(dados.lc)}</span></div>`}
      </div>

      <hr class="vf-sep">

      <div class="vf-section-title">Custos & deduções</div>
      <div class="vf-grid3">
        <div class="vf-cell"><span class="vf-lbl">Custo</span><span class="vf-val">${moeda(dados.custo)}</span></div>
        <div class="vf-cell"><span class="vf-lbl">Frete</span><span class="vf-val">${moeda(dados.frete)}</span></div>
        <div class="vf-cell"><span class="vf-lbl">Imp ${porcentagem(dados.impostoPct,1)}</span><span class="vf-val">${moeda(dados.impostoValor)}</span></div>
        <div class="vf-cell"><span class="vf-lbl">Comissão</span><span class="vf-val">${moeda(dados.comissaoValor)}</span></div>
        <div class="vf-cell"><span class="vf-lbl">% Comissão</span><span class="vf-val">${porcentagem(dados.comissaoPct,1)}</span></div>
        ${taxaLine || `<div class="vf-cell"><span class="vf-lbl">Lucro</span><span class="vf-val ${classeNumero(dados.lc)}">${moeda(dados.lc)}</span></div>`}
      </div>

      <hr class="vf-sep">

      <div class="vf-section-title">Indicadores</div>
      <div class="vf-grid3">
        <div class="vf-cell"><span class="vf-lbl">Markup</span><span class="vf-val ${dados.markup > 0 ? 'vf-pos' : 'vf-neg'}">${porcentagem(dados.markup, 1)}</span></div>
        <div class="vf-cell"><span class="vf-lbl">ROI</span><span class="vf-val ${dados.roi > 0 ? 'vf-pos' : 'vf-neg'}">${porcentagem(dados.roi, 1)}</span></div>
        <div class="vf-cell"><span class="vf-lbl">Break-even</span><span class="vf-val">${moeda(dados.breakEven)}</span></div>
      </div>

      ${dados.precoSugerido > 0 ? `
        <div class="vf-hint-line">
          🎯 Para <b>${porcentagem(dados.mcAlvo, 0)}</b> de margem, venda por <b>${moeda(dados.precoSugerido)}</b>
          ${dados.precoSugerido > dados.precoVenda
            ? `<span style="color:var(--vf-yellow);">(+${moeda(dados.precoSugerido - dados.precoVenda)})</span>`
            : `<span style="color:var(--vf-green);">(${moeda(dados.precoSugerido - dados.precoVenda)})</span>`
          }
        </div>
      ` : ''}

      <div class="vf-mini-actions">
        <button class="vf-chip" data-action="copy-id">📋 ID</button>
        <button class="vf-chip" data-action="copy-resumo">📊 Resumo</button>
        <button class="vf-chip" data-action="open-anuncio">↗ Abrir</button>
      </div>

      <div style="margin-top:5px;font-size:8.5px;opacity:0.4;text-align:center;">
        Base: ${currentBaseId || "nenhuma"}
      </div>
    `;

    // Ações dos chips
    box.querySelectorAll('.vf-chip').forEach(chip => {
      chip.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const action = chip.getAttribute('data-action');
        if (action === 'copy-id') {
          navigator.clipboard?.writeText(id).then(() => {
            chip.classList.add('copied');
            chip.textContent = '✓ Copiado';
            setTimeout(() => {
              chip.classList.remove('copied');
              chip.textContent = '📋 ID';
            }, 1500);
          });
        } else if (action === 'copy-resumo') {
          const resumo = [
            `ID: ${id}`,
            `Preço: ${moeda(dados.precoVenda)}`,
            `Custo: ${moeda(dados.custo)}`,
            `Frete: ${moeda(dados.frete)}`,
            `Comissão: ${moeda(dados.comissaoValor)} (${porcentagem(dados.comissaoPct,1)})`,
            `Imposto: ${moeda(dados.impostoValor)} (${porcentagem(dados.impostoPct,1)})`,
            `Lucro: ${moeda(dados.lc)}`,
            `Margem: ${porcentagem(dados.mc,2)}`,
            `Markup: ${porcentagem(dados.markup,1)}`,
            `ROI: ${porcentagem(dados.roi,1)}`,
            `Break-even: ${moeda(dados.breakEven)}`
          ].join('\n');
          navigator.clipboard?.writeText(resumo).then(() => showToast("Resumo copiado!", "ok"));
        } else if (action === 'open-anuncio') {
          const url = `https://produto.mercadolivre.com.br/${id}`;
          window.open(url, "_blank");
        }
      });
    });
  }

  // ── INLINE CARD (integrado à row) ────────────────────────────────────────
  function cleanupBoxes(validKeys) {
    getOverlayRoot().querySelectorAll(`.${BOX_CLASS}`).forEach(box => {
      if (!validKeys.has(box.getAttribute("data-vf-key"))) box.remove();
    });
  }

  function positionBoxes(items) {
    const CARD_STACK_GAP = 8;
    let lastBottom = 0;

    items.forEach(({ box, row }) => {
      if (box.style.display === "none") return;

      const rect = row.getBoundingClientRect();
      const isNarrow = window.innerWidth < 768;
      const dynamicWidth = Math.min(BOX_WIDTH, Math.max(200, window.innerWidth - 24));
      const desiredLeft = window.scrollX + rect.right + CARD_GAP_FROM_ROW;
      const left = isNarrow
        ? window.scrollX + 10
        : Math.max(10, Math.min(desiredLeft, window.scrollX + window.innerWidth - dynamicWidth - VIEWPORT_RIGHT_GAP));

      const suggestedTop = window.scrollY + rect.top;
      const top = Math.max(suggestedTop, lastBottom + CARD_STACK_GAP);

      box.style.top  = `${top}px`;
      box.style.left = `${left}px`;

      lastBottom = top + (box.offsetHeight || 0);
    });
  }
  // ==========================
  // FILTROS / VISIBILIDADE
  // ==========================
  function aplicarFiltros() {
    const termo = prefs.filtroBusca?.toLowerCase().trim() || "";

    const filtrarEl = (el) => {
      const status = el.getAttribute("data-vf-status");
      const id     = (el.getAttribute("data-vf-id") || "").toLowerCase();
      let visivel   = true;
      if (prefs.filtroStatus && prefs.filtroStatus !== "todos") {
        if (prefs.filtroStatus !== status) visivel = false;
      }
      if (status === "saudavel" && !prefs.mostrarSaudavel) visivel = false;
      if (status === "atencao"  && !prefs.mostrarAtencao)  visivel = false;
      if (status === "critico"  && !prefs.mostrarCritico)  visivel = false;
      if (status === "sem_custo" && !prefs.mostrarSemCusto) visivel = false;
      if (termo && !id.includes(termo)) visivel = false;
      el.style.display = visivel ? "" : "none";
    };

    const root = getOverlayRoot();
    root.querySelectorAll(`.${BOX_CLASS}`).forEach(filtrarEl);
  }

  // ==========================
  // HUD FLUTUANTE
  // ==========================
  function getHudState() {
    return {
      mcs: lastAnalysisData.filter(d => d.tipo && d.tipo !== "sem_custo" && typeof d.mc === "number").map(d => d.mc),
      lcs: lastAnalysisData.filter(d => d.tipo && d.tipo !== "sem_custo" && typeof d.lc === "number").map(d => d.lc),
      revenues: lastAnalysisData.filter(d => d.tipo && d.tipo !== "sem_custo").map(d => d.precoVenda || 0),
      total: lastAnalysisData.length,
      saudavel: lastAnalysisData.filter(d => d.tipo === "saudavel").length,
      atencao: lastAnalysisData.filter(d => d.tipo === "atencao").length,
      critico: lastAnalysisData.filter(d => d.tipo === "critico").length,
      semCusto: lastAnalysisData.filter(d => d.tipo === "sem_custo").length
    };
  }

  function getMelhorPior() {
    const validos = lastAnalysisData.filter(d => d.tipo && d.tipo !== "sem_custo" && typeof d.mc === "number");
    if (!validos.length) return { melhor: null, pior: null };
    const sorted = [...validos].sort((a, b) => b.mc - a.mc);
    return {
      melhor: sorted[0],
      pior: sorted[sorted.length - 1]
    };
  }

  function renderHudPanel() {
    const root = getOverlayRoot();
    const wrap = root.getElementById("vf-hud-wrap");
    if (!wrap) return;

    const pos = prefs.hudPosicao || { y: 80 };
    wrap.style.top = `${Math.max(8, pos.y || 80)}px`;
    if (pos.x !== null && pos.x !== undefined) {
      wrap.style.left = `${Math.max(8, pos.x)}px`;
      wrap.style.right = "auto";
    } else {
      wrap.style.right = "14px";
      wrap.style.left = "auto";
    }

    // Minimizado
    if (prefs.hudMinimizado) {
      const { mcs, total } = getHudState();
      const mcMedio = mcs.length ? (mcs.reduce((s,v)=>s+v,0)/mcs.length) : 0;

      wrap.innerHTML = `
        <div class="vf-hud-pill" id="vf-hud-expand">
          <span class="vf-hud-pill-icon">⚡</span>
          <span>VenForce · ${total}</span>
          ${mcs.length ? `<span class="vf-hud-pill-mc">MC ${mcMedio.toFixed(1)}%</span>` : ''}
        </div>
      `;
      wrap.querySelector("#vf-hud-expand")?.addEventListener("click", async () => {
        prefs.hudMinimizado = false;
        await salvarPrefs();
        renderHudPanel();
      });
      return;
    }

    // Painel expandido
    const stt = getHudState();
    const mcs = stt.mcs;
    const lcs = stt.lcs;
    const revenues = stt.revenues;
    const mcMedio = mcs.length ? (mcs.reduce((s,v)=>s+v,0)/mcs.length) : 0;
    const lcTotal = lcs.reduce((s,v)=>s+v, 0);
    const revenueTotal = revenues.reduce((s,v)=>s+v, 0);
    const { melhor, pior } = getMelhorPior();

    const hasBase = !!currentBaseId;
    const semDados = stt.total === 0;

    // Conteúdo do corpo: stats + controles ou estado vazio
    let bodyContent = "";

    if (!hasBase) {
      bodyContent = `
        <div class="vf-hud-empty">
          <div style="font-size:24px;margin-bottom:6px;">📋</div>
          Nenhuma base de custos ativa.<br>
          Abra a <strong>extensão VenForce</strong> e selecione/importe uma base.
        </div>
      `;
    } else if (semDados) {
      bodyContent = `
        <div class="vf-hud-empty">
          <div style="font-size:24px;margin-bottom:6px;">🔍</div>
          Nenhum anúncio analisado ainda.<br>
          <span style="opacity:0.7;">Role a página de anúncios para começar a análise.</span>
        </div>
      `;
    } else {
      const isFiltro = (tipo) => prefs.filtroStatus === tipo ? "active-filter" : "";

      bodyContent = `
        <!-- ESTATÍSTICAS (clicar filtra) -->
        <div class="vf-stats-grid">
          <div class="vf-stat-box tot ${isFiltro("todos")}" data-filter="todos">
            <div class="vf-stat-num">${stt.total}</div>
            <div class="vf-stat-lbl">Total</div>
          </div>
          <div class="vf-stat-box sau ${isFiltro("saudavel")}" data-filter="saudavel">
            <div class="vf-stat-num">${stt.saudavel}</div>
            <div class="vf-stat-lbl">Saudável</div>
          </div>
          <div class="vf-stat-box ate ${isFiltro("atencao")}" data-filter="atencao">
            <div class="vf-stat-num">${stt.atencao}</div>
            <div class="vf-stat-lbl">Atenção</div>
          </div>
          <div class="vf-stat-box cri ${isFiltro("critico")}" data-filter="critico">
            <div class="vf-stat-num">${stt.critico}</div>
            <div class="vf-stat-lbl">Crítico</div>
          </div>
        </div>

        <!-- RESUMO FINANCEIRO -->
        <div class="vf-summary-row">
          <div class="vf-summary-box">
            <div class="vf-summary-lbl">MC médio</div>
            <div class="vf-summary-val ${classeNumero(mcMedio)}">${porcentagem(mcMedio, 2)}</div>
          </div>
          <div class="vf-summary-box">
            <div class="vf-summary-lbl">Lucro total</div>
            <div class="vf-summary-val ${classeNumero(lcTotal)}">${moeda(lcTotal)}</div>
          </div>
        </div>

        <!-- MELHOR / PIOR -->
        ${(melhor && pior && melhor !== pior) ? `
        <div class="vf-highlights">
          <div class="vf-highlight best" data-go-id="${melhor.id}">
            <div class="vf-highlight-title">🏆 Melhor</div>
            <div class="vf-highlight-id" title="${melhor.id}">${melhor.id}</div>
            <div class="vf-highlight-val">${porcentagem(melhor.mc, 1)}</div>
          </div>
          <div class="vf-highlight worst" data-go-id="${pior.id}">
            <div class="vf-highlight-title">⚠ Pior</div>
            <div class="vf-highlight-id" title="${pior.id}">${pior.id}</div>
            <div class="vf-highlight-val">${porcentagem(pior.mc, 1)}</div>
          </div>
        </div>
        ` : ''}

        <!-- CONTROLES -->
        <div class="vf-controls">
          <input
            type="text"
            class="vf-input"
            id="vf-busca"
            placeholder="🔍 Buscar por ID (MLB...)"
            value="${(prefs.filtroBusca || "").replace(/"/g,'&quot;')}"
          />
          <select class="vf-select" id="vf-ordenar">
            <option value="natural"  ${prefs.ordenacao==="natural"?"selected":""}>↕ Ordem natural</option>
            <option value="mc_asc"   ${prefs.ordenacao==="mc_asc"?"selected":""}>↑ Menor margem primeiro</option>
            <option value="mc_desc"  ${prefs.ordenacao==="mc_desc"?"selected":""}>↓ Maior margem primeiro</option>
            <option value="lc_desc"  ${prefs.ordenacao==="lc_desc"?"selected":""}>💰 Maior lucro primeiro</option>
          </select>
        </div>

        <!-- AÇÕES -->
        <div class="vf-action-row">
          <button class="vf-btn vf-btn-secondary" id="vf-expand-all">⊞ Expandir</button>
          <button class="vf-btn vf-btn-secondary" id="vf-collapse-all">⊟ Recolher</button>
        </div>
        <div class="vf-action-row">
          <button class="vf-btn vf-btn-primary" id="vf-export">⬇ Exportar CSV</button>
          <button class="vf-btn vf-btn-secondary" id="vf-toggle-settings">⚙ Ajustes</button>
        </div>

        <!-- PAINEL DE AJUSTES (toggle) -->
        <div id="vf-settings-panel" style="display:${prefs._showSettings ? 'block' : 'none'};">
          ${renderSettingsPanel()}
        </div>
      `;
    }

    wrap.innerHTML = `
      <div class="vf-hud-panel">
        <div class="vf-hud-header" id="vf-hud-drag">
          <div class="vf-hud-brand">
            <span class="vf-hud-brand-dot"></span>
            <span>VenForce</span>
            ${currentBaseId ? `<span class="vf-hud-base">· ${currentBaseId}</span>` : ''}
          </div>
          <div class="vf-hud-actions">
            <button class="vf-icon-btn" id="vf-hud-refresh" title="Recarregar base">↻</button>
            <button class="vf-icon-btn" id="vf-hud-minimize" title="Minimizar">−</button>
          </div>
        </div>
        <div class="vf-hud-body">
          ${bodyContent}
        </div>
        ${hasBase && !semDados ? `
        <div class="vf-hud-footer">
          <span class="vf-hud-footer-info">${revenueTotal > 0 ? `Receita: ${moeda(revenueTotal)}` : 'Pronto'}</span>
          <span style="opacity:0.65;">v1.2</span>
        </div>
        ` : ''}
      </div>
    `;

    attachHudEvents();
  }

  function renderSettingsPanel() {
    return `
      <div class="vf-settings" style="margin:8px -12px -12px -12px;border-radius:0;">
        <div class="vf-settings-title">⚙ Configurações</div>

        <div class="vf-settings-row">
          <label for="vf-th-sau">Saudável a partir de:</label>
          <div style="display:flex;align-items:center;gap:3px;">
            <input type="number" id="vf-th-sau" value="${prefs.thresholdSaudavel}" min="0" max="100" step="0.5">
            <span style="font-size:11px;color:var(--vf-text-l);">%</span>
          </div>
        </div>

        <div class="vf-settings-row">
          <label for="vf-th-ate">Atenção a partir de:</label>
          <div style="display:flex;align-items:center;gap:3px;">
            <input type="number" id="vf-th-ate" value="${prefs.thresholdAtencao}" min="0" max="100" step="0.5">
            <span style="font-size:11px;color:var(--vf-text-l);">%</span>
          </div>
        </div>

        <div class="vf-settings-row">
          <label for="vf-mc-alvo">Margem alvo (sugestão):</label>
          <div style="display:flex;align-items:center;gap:3px;">
            <input type="number" id="vf-mc-alvo" value="${prefs.margemAlvo}" min="0" max="100" step="0.5">
            <span style="font-size:11px;color:var(--vf-text-l);">%</span>
          </div>
        </div>

        <hr style="border:none;border-top:1px solid var(--vf-line);margin:10px 0 8px;">

        <div class="vf-settings-row">
          <label for="vf-mostrar-sau">✓ Mostrar saudáveis</label>
          <input type="checkbox" id="vf-mostrar-sau" ${prefs.mostrarSaudavel?"checked":""}>
        </div>
        <div class="vf-settings-row">
          <label for="vf-mostrar-ate">✓ Mostrar atenção</label>
          <input type="checkbox" id="vf-mostrar-ate" ${prefs.mostrarAtencao?"checked":""}>
        </div>
        <div class="vf-settings-row">
          <label for="vf-mostrar-cri">✓ Mostrar críticos</label>
          <input type="checkbox" id="vf-mostrar-cri" ${prefs.mostrarCritico?"checked":""}>
        </div>
        <div class="vf-settings-row">
          <label for="vf-mostrar-sem">✓ Mostrar sem custo</label>
          <input type="checkbox" id="vf-mostrar-sem" ${prefs.mostrarSemCusto?"checked":""}>
        </div>

        <hr style="border:none;border-top:1px solid var(--vf-line);margin:8px 0;">

        <div style="font-size:9px;color:var(--vf-text-l);text-align:center;line-height:1.4;">
          Dica: clique nos números do topo (Total/Saudável/Atenção/Crítico) para filtrar rapidamente.
        </div>
      </div>
    `;
  }

  function attachHudEvents() {
    const root = getOverlayRoot();

    // Minimizar
    root.getElementById("vf-hud-minimize")?.addEventListener("click", async () => {
      prefs.hudMinimizado = true;
      await salvarPrefs();
      renderHudPanel();
    });

    // Refresh
    root.getElementById("vf-hud-refresh")?.addEventListener("click", async () => {
      showToast("Recarregando base...", "ok", 1200);
      await loadCosts();
      // limpar boxes e reprocessar
      getOverlayRoot().querySelectorAll(`.${BOX_CLASS}`).forEach(el => el.remove());
      getPainelRows().forEach(row => { if (row?.dataset) delete row.dataset.vfProcessed; });
      processarPagina();
      atualizarHud();
    });

    // Drag do header
    setupDrag();

    // Filtros por stats
    root.querySelectorAll(".vf-stat-box[data-filter]").forEach(box => {
      box.addEventListener("click", async () => {
        const filtro = box.getAttribute("data-filter");
        prefs.filtroStatus = (prefs.filtroStatus === filtro) ? "todos" : filtro;
        await salvarPrefs();
        aplicarFiltros();
        renderHudPanel();
      });
    });

    // Busca
    const buscaEl = root.getElementById("vf-busca");
    if (buscaEl) {
      buscaEl.addEventListener("input", debounce(async (e) => {
        prefs.filtroBusca = e.target.value || "";
        await salvarPrefs();
        aplicarFiltros();
      }, 200));
    }

    // Ordenar
    root.getElementById("vf-ordenar")?.addEventListener("change", async (e) => {
      prefs.ordenacao = e.target.value;
      await salvarPrefs();
      reordenarCardsVisuais();
    });

    // Expandir todos
    root.getElementById("vf-expand-all")?.addEventListener("click", () => {
      collapseAllOnNextRender = false;
      expandAllOnNextRender = true;
      scheduleProcess();
    });

    // Recolher todos
    root.getElementById("vf-collapse-all")?.addEventListener("click", () => {
      expandAllOnNextRender = false;
      collapseAllOnNextRender = true;
      scheduleProcess();
    });

    // Exportar CSV
    root.getElementById("vf-export")?.addEventListener("click", () => {
      exportarCSV();
    });

    // Toggle settings
    root.getElementById("vf-toggle-settings")?.addEventListener("click", () => {
      prefs._showSettings = !prefs._showSettings;
      renderHudPanel();
    });

    // Highlights melhor/pior - rolar até o card
    root.querySelectorAll(".vf-highlight[data-go-id]").forEach(el => {
      el.addEventListener("click", () => {
        const id = el.getAttribute("data-go-id");
        rolarAteCard(id);
      });
    });

    // SETTINGS inputs
    const onChangeSettingsNum = async (key, el, validate) => {
      const v = Number(el.value);
      if (Number.isFinite(v) && validate(v)) {
        prefs[key] = v;
        await salvarPrefs();
        // re-render cards e hud
        getOverlayRoot().querySelectorAll(`.${BOX_CLASS}`).forEach(b => b.remove());
        getPainelRows().forEach(row => { if (row?.dataset) delete row.dataset.vfProcessed; });
        processarPagina();
        atualizarHud();
      }
    };

    root.getElementById("vf-th-sau")?.addEventListener("change", function() {
      onChangeSettingsNum("thresholdSaudavel", this, v => v >= 0 && v <= 100);
    });
    root.getElementById("vf-th-ate")?.addEventListener("change", function() {
      onChangeSettingsNum("thresholdAtencao", this, v => v >= 0 && v <= 100);
    });
    root.getElementById("vf-mc-alvo")?.addEventListener("change", function() {
      onChangeSettingsNum("margemAlvo", this, v => v >= 0 && v <= 100);
    });

    const onChangeCheck = async (key, el) => {
      prefs[key] = !!el.checked;
      await salvarPrefs();
      aplicarFiltros();
    };
    root.getElementById("vf-mostrar-sau")?.addEventListener("change", function() {
      onChangeCheck("mostrarSaudavel", this);
    });
    root.getElementById("vf-mostrar-ate")?.addEventListener("change", function() {
      onChangeCheck("mostrarAtencao", this);
    });
    root.getElementById("vf-mostrar-cri")?.addEventListener("change", function() {
      onChangeCheck("mostrarCritico", this);
    });
    root.getElementById("vf-mostrar-sem")?.addEventListener("change", function() {
      onChangeCheck("mostrarSemCusto", this);
    });
  }

  function rolarAteCard(id) {
    if (!id) return;
    const rows = getPainelRows();
    const row = rows.find(r => {
      const rId = extrairIdPainel(r);
      return rId && (rId === id || rId.includes(id) || id.includes(rId));
    });
    if (row) {
      row.scrollIntoView({ behavior: "smooth", block: "center" });
      row.classList.add("vf-row-highlight-saudavel");
      setTimeout(() => row.classList.remove("vf-row-highlight-saudavel"), 1800);
    }
  }

  // Ordenação visual: reposiciona cards no overlay com posição "virtual"
  function reordenarCardsVisuais() {
    // Como os cards são posicionados ao lado de cada linha do ML, "ordenar" significa
    // visualmente destacar/numerar; vamos só dar um realce nas linhas conforme a ordem
    // pedida. Reposicionar de fato quebraria o vínculo visual com o anúncio.
    // Aqui aplicamos um pequeno indicador numérico no canto do card.
    if (prefs.ordenacao === "natural") {
      getOverlayRoot().querySelectorAll(`.${BOX_CLASS}`).forEach(b => {
        const r = b.querySelector('.vf-rank-badge');
        if (r) r.remove();
      });
      return;
    }

    const dados = [...lastAnalysisData].filter(d => d.tipo && d.tipo !== "sem_custo");
    let sorted;
    if (prefs.ordenacao === "mc_asc") sorted = dados.sort((a,b) => a.mc - b.mc);
    else if (prefs.ordenacao === "mc_desc") sorted = dados.sort((a,b) => b.mc - a.mc);
    else if (prefs.ordenacao === "lc_desc") sorted = dados.sort((a,b) => b.lc - a.lc);
    else sorted = dados;

    const rankMap = new Map();
    sorted.forEach((d, i) => rankMap.set(d.id, i + 1));

    getOverlayRoot().querySelectorAll(`.${BOX_CLASS}`).forEach(b => {
      const id = b.getAttribute("data-vf-id");
      let badge = b.querySelector('.vf-rank-badge');
      if (rankMap.has(id)) {
        if (!badge) {
          badge = document.createElement('div');
          badge.className = 'vf-rank-badge';
          badge.style.cssText = `
            position:absolute;top:-6px;left:-6px;
            background:var(--vf-purple);color:#fff;
            font-size:9px;font-weight:800;
            width:18px;height:18px;border-radius:50%;
            display:flex;align-items:center;justify-content:center;
            box-shadow:0 2px 6px rgba(91,43,224,0.35);
            font-family:inherit;
          `;
          b.appendChild(badge);
        }
        badge.textContent = `#${rankMap.get(id)}`;
      } else if (badge) {
        badge.remove();
      }
    });
  }

  function exportarCSV() {
    if (!lastAnalysisData.length) {
      showToast("Nada para exportar ainda", "err", 1500);
      return;
    }
    const headers = [
      "ID", "Status", "Preco Venda", "Custo", "Frete",
      "Comissao", "Comissao %", "Imposto", "Imposto %",
      "Taxa Fixa", "Lucro Liquido", "Margem %", "Markup %",
      "ROI %", "Break-even"
    ];
    const linhas = [headers.join(";")];

    lastAnalysisData.forEach(d => {
      const linha = [
        d.id || "",
        d.tipo || "",
        d.precoVenda?.toFixed(2)?.replace(".", ",") || "0",
        d.custo?.toFixed(2)?.replace(".", ",") || "0",
        d.frete?.toFixed(2)?.replace(".", ",") || "0",
        d.comissaoValor?.toFixed(2)?.replace(".", ",") || "0",
        d.comissaoPct?.toFixed(2)?.replace(".", ",") || "0",
        d.impostoValor?.toFixed(2)?.replace(".", ",") || "0",
        d.impostoPct?.toFixed(2)?.replace(".", ",") || "0",
        d.taxaFixa?.toFixed(2)?.replace(".", ",") || "0",
        d.lc?.toFixed(2)?.replace(".", ",") || "0",
        d.mc?.toFixed(2)?.replace(".", ",") || "0",
        d.markup?.toFixed(2)?.replace(".", ",") || "0",
        d.roi?.toFixed(2)?.replace(".", ",") || "0",
        d.breakEven?.toFixed(2)?.replace(".", ",") || "0"
      ];
      linhas.push(linha.join(";"));
    });

    const csv = "\uFEFF" + linhas.join("\n"); // BOM para Excel reconhecer UTF-8
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    const dataStr = new Date().toISOString().slice(0, 10);
    a.download = `venforce_${currentBaseId || "export"}_${dataStr}.csv`;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast(`CSV exportado: ${lastAnalysisData.length} linhas`, "ok");
  }

  // ==========================
  // DRAG do HUD
  // ==========================
  function setupDrag() {
    const root = getOverlayRoot();
    const dragEl = root.getElementById("vf-hud-drag");
    const wrap = root.getElementById("vf-hud-wrap");
    if (!dragEl || !wrap) return;

    let startX = 0, startY = 0;
    let initLeft = 0, initTop = 0;
    let dragging = false;

    const onMouseDown = (e) => {
      // ignora se foi nos botões do header
      if (e.target.closest('.vf-icon-btn')) return;
      dragging = true;
      const rect = wrap.getBoundingClientRect();
      initLeft = rect.left;
      initTop = rect.top;
      startX = e.clientX;
      startY = e.clientY;
      e.preventDefault();
    };

    const onMouseMove = (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const newLeft = Math.max(8, Math.min(window.innerWidth - 100, initLeft + dx));
      const newTop = Math.max(8, Math.min(window.innerHeight - 60, initTop + dy));
      wrap.style.left = `${newLeft}px`;
      wrap.style.top = `${newTop}px`;
      wrap.style.right = "auto";
    };

    const onMouseUp = async () => {
      if (!dragging) return;
      dragging = false;
      const rect = wrap.getBoundingClientRect();
      prefs.hudPosicao = { x: rect.left, y: rect.top };
      await salvarPrefs();
    };

    dragEl.addEventListener("mousedown", onMouseDown);
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }

  function atualizarHud() {
    renderHudPanel();
  }

  // ==========================
  // DEBOUNCE
  // ==========================
  function debounce(fn, ms) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  // ==========================
  // TOOLTIP EARNINGS (ML interno)
  // ==========================

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function normalizarLabelTooltip(label) {
    return String(label || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  }

  function parseMoedaTooltip(valor) {
    const s = String(valor || "").replace(/\s/g, "");
    const neg = s.startsWith("-");
    const num = numeroSeguro(s.replace(/-/g, "").replace("R$", ""));
    return neg ? -num : num;
  }

  function valorAbsolutoMoedaTooltip(valor) {
    return Math.abs(parseMoedaTooltip(valor));
  }

  function parseEarningsTooltip(json) {
    if (!json || typeof json !== "object") return { ok: false };
    // aceitar tanto {detail:{costs:[]}} quanto {data:{detail:{costs:[]}}}
    const root = json.data || json;
    const costs = root?.detail?.costs || root?.costs || [];
    if (!Array.isArray(costs) || costs.length === 0) return { ok: false };

    let precoVenda = 0, comissaoValor = 0, frete = null;

    for (const cost of costs) {
      const lbl = normalizarLabelTooltip(cost.label);
      const val = valorAbsolutoMoedaTooltip(cost.value);
      if (lbl.startsWith("preco"))             precoVenda    = val;
      else if (lbl.includes("tarifa de venda")) comissaoValor = val;
      else if (lbl.includes("custo de envio"))  frete         = val;
    }

    // recebe: root.summary > root.value > label "voce recebe"
    let recebe = 0;
    if (root.summary?.value)           recebe = valorAbsolutoMoedaTooltip(root.summary.value);
    else if (root.value)               recebe = valorAbsolutoMoedaTooltip(root.value);
    else {
      const ri = costs.find(c => normalizarLabelTooltip(c.label).includes("voce recebe"));
      if (ri) recebe = valorAbsolutoMoedaTooltip(ri.value);
    }

    let fonteFrete = frete !== null ? "tooltip_label" : null;

    // fallback frete por fórmula: preço - comissão - recebe
    if (frete === null && precoVenda > 0 && comissaoValor >= 0 && recebe > 0) {
      const calc = Math.round((precoVenda - comissaoValor - recebe) * 100) / 100;
      frete = calc > 0.01 ? calc : 0;
      fonteFrete = "tooltip_formula";
    }

    const ok = precoVenda > 0 || comissaoValor > 0 || recebe > 0;
    return { ok, precoVenda, comissaoValor, frete, recebe, fonteFrete, raw: json };
  }

  // Fetch com retry para 424, res.text() → JSON.parse(), dedup via pending Map,
  // cache apenas sucesso (falha não é cacheada para permitir retry posterior).
  async function fetchEarningsTooltip(itemId) {
    if (!itemId) return null;
    if (earningsTooltipCache.has(itemId))   return earningsTooltipCache.get(itemId);
    if (earningsTooltipPending.has(itemId)) return earningsTooltipPending.get(itemId);

    const url = `/anuncios/api/listing/tooltip?type=earnings&documentId=${encodeURIComponent(itemId)}`;
    window.__VF_TOOLTIP_DEBUG_COUNT = window.__VF_TOOLTIP_DEBUG_COUNT || 0;

    const promise = (async () => {
      const delays = [0, 400, 900];

      for (let attempt = 0; attempt < delays.length; attempt++) {
        if (delays[attempt]) await sleep(delays[attempt]);

        const doLog = window.__VF_TOOLTIP_DEBUG_COUNT < 10;
        if (doLog) {
          window.__VF_TOOLTIP_DEBUG_COUNT++;
          console.log("[VF TOOLTIP REQUEST]", itemId, url, "attempt", attempt + 1);
        }

        try {
          const res = await fetch(url, { credentials: "include", cache: "default" });
          const text = await res.text();

          let json = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch (_) {
            console.warn("[VF TOOLTIP NON_JSON]", itemId, res.status, text?.slice?.(0, 120));
            if (res.status === 424 && attempt < delays.length - 1) continue;
            return null;
          }

          if (res.ok && json) {
            if (doLog) console.log("[VF TOOLTIP OK]", itemId, json);
            earningsTooltipCache.set(itemId, json);
            return json;
          }

          console.warn("[VF TOOLTIP FAIL_STATUS]", itemId, res.status);
          if (res.status === 424 && attempt < delays.length - 1) continue;
          return null;

        } catch (err) {
          console.warn("[VF TOOLTIP ERROR]", itemId, err?.message);
          if (attempt < delays.length - 1) continue;
          return null;
        }
      }

      return null;
    })();

    earningsTooltipPending.set(itemId, promise);
    try {
      return await promise;
    } finally {
      earningsTooltipPending.delete(itemId);
    }
  }

  // Wrapper fino: busca JSON raw → parseia → retorna dados ou null
  async function obterDadosFinanceirosTooltip(itemId) {
    const json = await fetchEarningsTooltip(itemId);
    if (!json) return null;
    const parsed = parseEarningsTooltip(json);
    return parsed.ok ? parsed : null;
  }

  // ==========================
  // PROCESSAR PÁGINA
  // ==========================
  async function processarRow(row, index) {
    const key = getBoxKey(row, index);
    const box = ensureBox(key);
    const cache = box.__venforceCache;
    const podeUsarCache =
      row.dataset?.vfProcessed === "1" &&
      cache?.id &&
      cache?.dados &&
      cache?.baseId === currentBaseId &&
      cache?.earningsVersion === EARNINGS_TOOLTIP_VERSION &&
      cache?.thresholdSau === prefs.thresholdSaudavel &&
      cache?.thresholdAte === prefs.thresholdAtencao &&
      cache?.mcAlvo === prefs.margemAlvo;

    let id, precoInfo, dados;

    if (podeUsarCache) {
      ({ id, precoInfo, dados } = cache);
    } else {
      id = extrairIdPainel(row);
      if (!id) {
        renderErroExtracao(box, null);
        return { key, box, row, dado: null };
      }

      const custoInfo = buscarCustoPorId(id);
      if (!custoInfo) {
        renderSemCusto(box, id);
        return { key, box, row, dado: { id, tipo: "sem_custo" } };
      }

      // Fontes DOM (fallback)
      const precoInfoDom = extrairPrecoVenda(row);
      const comissaoDom  = extrairComissaoInfo(row, precoInfoDom.precoVenda);
      const freteDom     = extrairFrete(row);

      // Fonte principal: tooltip earnings do ML
      const tooltipData = await obterDadosFinanceirosTooltip(id);

      // Mesclar: tooltip prevalece quando tiver valor
      const precoVendaFinal =
        tooltipData?.precoVenda > 0 ? tooltipData.precoVenda : precoInfoDom.precoVenda;

      const comissaoFinal =
        tooltipData?.comissaoValor > 0
          ? {
              valor: tooltipData.comissaoValor,
              percentual: precoVendaFinal > 0
                ? (tooltipData.comissaoValor / precoVendaFinal) * 100
                : 0
            }
          : comissaoDom;

      const freteFinal =
        tooltipData && tooltipData.frete !== null && tooltipData.frete !== undefined
          ? tooltipData.frete
          : freteDom;

      precoInfo = {
        precoVenda:      precoVendaFinal,
        precoCheio:      precoInfoDom.precoCheio,
        precoPromocional: tooltipData?.precoVenda > 0
          ? tooltipData.precoVenda
          : precoInfoDom.precoPromocional
      };

      if (!precoInfo.precoVenda) {
        renderErroExtracao(box, id);
        return { key, box, row, dado: null };
      }

      dados = calcular(precoVendaFinal, custoInfo, comissaoFinal, freteFinal);

      window.__VF_FINAL_DEBUG_COUNT = window.__VF_FINAL_DEBUG_COUNT || 0;
      if (window.__VF_FINAL_DEBUG_COUNT < 10) {
        window.__VF_FINAL_DEBUG_COUNT++;
        console.log("[VF FINAL DATA]", {
          id,
          fonte: tooltipData ? "tooltip" : "dom",
          precoVendaFinal,
          comissaoValor: comissaoFinal?.valor,
          freteFinal,
          fonteFrete: tooltipData?.fonteFrete || "dom",
          lc: dados.lc,
          mc: dados.mc
        });
      }
    }

    if (collapseAllOnNextRender) box.setAttribute("data-expanded", "false");
    else if (expandAllOnNextRender) box.setAttribute("data-expanded", "true");

    renderBox(box, id, dados, {
      precoCheio: precoInfo.precoCheio,
      precoPromocional: precoInfo.precoPromocional
    });

    if (!podeUsarCache) {
      box.__venforceCache = {
        id, dados, precoInfo,
        baseId: currentBaseId,
        earningsVersion: EARNINGS_TOOLTIP_VERSION,
        thresholdSau: prefs.thresholdSaudavel,
        thresholdAte: prefs.thresholdAtencao,
        mcAlvo: prefs.margemAlvo
      };
    }
    row.dataset.vfProcessed = "1";

    const status = getStatusByMc(dados.mc);

    return {
      key, box, row,
      dado: {
        id,
        tipo: status.tipo,
        precoVenda: dados.precoVenda,
        custo: dados.custo,
        frete: dados.frete,
        comissaoValor: dados.comissaoValor,
        comissaoPct: dados.comissaoPct,
        impostoValor: dados.impostoValor,
        impostoPct: dados.impostoPct,
        taxaFixa: dados.taxaFixa,
        lc: dados.lc,
        mc: dados.mc,
        markup: dados.markup,
        roi: dados.roi,
        breakEven: dados.breakEven
      }
    };
  }

  // Processa items com no máximo `limit` em paralelo — evita flood de requests 424
  async function mapLimit(items, limit, asyncFn) {
    const results = [];
    let index = 0;
    async function worker() {
      while (index < items.length) {
        const current = index++;
        try {
          results[current] = { status: "fulfilled", value: await asyncFn(items[current], current) };
        } catch (err) {
          results[current] = { status: "rejected", reason: err };
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
  }

  async function processarPagina() {
    scheduled = false;
    syncOverlaySize();

    const rows = getPainelRows();
    const validKeys = new Set();

    // Limite 3 paralelos — evita 424 por flood no endpoint ML
    const results = await mapLimit(rows, 3, (row, index) => processarRow(row, index));

    const items = [];
    lastAnalysisData = [];

    results.forEach(res => {
      if (res.status !== "fulfilled" || !res.value) return;
      const item = res.value;
      validKeys.add(item.key);
      items.push(item);
      if (item.dado) lastAnalysisData.push(item.dado);
    });

    cleanupBoxes(validKeys);
    positionBoxes(items);
    syncOverlaySize();

    aplicarFiltros();
    reordenarCardsVisuais();
    atualizarHud();

    if (expandAllOnNextRender) expandAllOnNextRender = false;
    if (collapseAllOnNextRender) collapseAllOnNextRender = false;
  }

  function scheduleProcess() {
    const now = Date.now();
    if (now - (scheduleProcess.lastRun || 0) < 450 || scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduleProcess.lastRun = Date.now();
      processarPagina().catch(err => {
        console.warn("[VenForce] processarPagina error:", err);
        scheduled = false;
      });
    });
  }

  function scheduleFullReload() {
    (async () => {
      await loadCosts();
      getOverlayRoot().querySelectorAll(`.${BOX_CLASS}`).forEach(el => el.remove());
      getPainelRows().forEach(row => {
        if (row?.dataset) delete row.dataset.vfProcessed;
      });
      scheduleProcess();
    })();
  }

  // ==========================
  // OBSERVERS
  // ==========================
  function startObserver() {
    new MutationObserver(mutations => {
      if (mutations.some(m => m.addedNodes?.length > 0)) scheduleProcess();
    }).observe(document.body, { childList: true, subtree: true });

    window.addEventListener("scroll", scheduleProcess, { passive: true });
    window.addEventListener("resize", scheduleProcess);
    window.addEventListener("load", scheduleProcess);
  }

  function startStorageWatcher() {
    if (!chrome?.storage?.onChanged) return;

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      const baseKeys = ["baseAtiva", "baseSelecionada", "token", "user", "venforce_user"];
      if (baseKeys.some(k => k in changes)) {
        console.log("[VenForce] storage alterado, recarregando...");
        scheduleFullReload();
      }
      if ("vf_prefs" in changes) {
        prefs = { ...DEFAULT_PREFS, ...(changes.vf_prefs.newValue || {}) };
        atualizarHud();
        aplicarFiltros();
      }
      if ("venforce_ativo" in changes) {
        const ativo = changes.venforce_ativo.newValue !== false;
        const overlay = document.getElementById(OVERLAY_ID);
        if (overlay) overlay.style.display = ativo ? "" : "none";
      }
    });
  }

  // ==========================
  // MENSAGENS DO POPUP
  // ==========================
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === "VENFORCE_SET_TOKEN") {
      chrome.storage.local.set({
        token: msg.token,
        venforce_user: msg.user
      }, () => {
        console.log("[VenForce] token salvo via login portal");
        scheduleFullReload();
        sendResponse?.({ ok: true });
      });
      return true;
    }

    if (msg.action === "VENFORCE_EXPAND_ALL") {
      expandAllOnNextRender = true;
      scheduleProcess();
      sendResponse?.({ ok: true });
      return true;
    }

    if (msg.action === "VENFORCE_COLLAPSE_ALL") {
      collapseAllOnNextRender = true;
      scheduleProcess();
      sendResponse?.({ ok: true });
      return true;
    }

    if (msg.action === "VENFORCE_GET_STATS") {
      const stt = getHudState();
      const mcMedio = stt.mcs.length ? (stt.mcs.reduce((s,v)=>s+v,0)/stt.mcs.length) : 0;
      sendResponse?.({
        ok: true,
        total: stt.total,
        saudavel: stt.saudavel,
        atencao: stt.atencao,
        critico: stt.critico,
        semCusto: stt.semCusto,
        mcMedio
      });
      return true;
    }

    return false;
  });

  // ==========================
  // INIT
  // ==========================
  async function init() {
    if (!PLATAFORMA) return;
    await carregarPrefs();
    await loadCosts();
    ensureOverlay();
    syncOverlaySize();
    renderHudPanel();
    processarPagina();
    startObserver();
    startStorageWatcher();
    console.log("[VenForce] inicialização concluída");
  }

  chrome.storage?.local?.get(["venforce_ativo"], result => {
    if (result?.venforce_ativo === false) {
      console.log("[VenForce] extensão desativada pelo usuário");
      return;
    }
    init();
  });
})();
