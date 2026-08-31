// Portal/ads.js — Página de Mercado Ads
//
// F5 — Cliente e Conta vêm do Shell V3 (data-vf-scope="account"), pelo evento
// DOM `vf:context` (a ponte documentada para script clássico, MASTER_SPEC
// §6.5/§15.3 — mesmo padrão de fechamentos-api.js:821). Esta tela mantinha
// seletores próprios de Cliente e de Conta Mercado Livre e, com eles, uma
// TERCEIRA cópia da regra de cardinalidade ("2+ contas ativas → pedir
// escolha"). A regra mora só em vf-context.js (R8); aqui sobrou o consumo.
//
// Escopo CONTA: /ads/performance recebe `clienteContaId` e devolve 409
// MULTIPLE_MARKETPLACE_ACCOUNTS sem ele quando o cliente tem 2+ contas ML.
// Esse 409 continua tratado — mas agora é devolvido ao store
// (signalContextError), que é quem sabe transformá-lo em estado de contexto.
//
// A competência deixou de ser "mês do ano corrente" (o seletor antigo montava
// 12 opções com new Date().getFullYear(), o que tornava impossível olhar
// dezembro do ano passado) e passou a ser a mesma competência YYYY-MM que o
// resto do V3 carrega em `?periodo=` — preservada ao trocar de operação e ao
// navegar entre módulos.

const API_BASE    = "https://venforce-server.onrender.com";
const STORAGE_KEY = "vf-token";

function getToken() {
  const t = localStorage.getItem(STORAGE_KEY);
  if (!t) { window.location.replace("index.html"); return null; }
  return t;
}
getToken();
// F5 — initLayout() saiu com o layout.js: vf-shell.js monta a navegação e
// cuida de token ausente e do desvio de `seller`.

// ─── Constantes ───────────────────────────────────────────────────────────────

const ADS_MESES_LABELS = [
  "", "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

const ADS_CHECKLIST_ITEMS = [
  "Dados de Ads conferidos",
  "ROAS analisado",
  "TACOS analisado",
  "Cancelados / devolvidos revisados",
  "Feedback enviado ao cliente",
  "Cliente respondeu",
];

const ADS_CHECKLIST_KEYS = [
  "dadosConferidos",
  "roasAnalisado",
  "tacosAnalisado",
  "canceladosRevisados",
  "feedbackEnviado",
  "clienteRespondeu",
];

const ANUNCIOS_PAGE_SIZE = 25;

// ─── Estado ───────────────────────────────────────────────────────────────────

let ADS_ACOMPANHAMENTO_ATUAL = null;
let ADS_CHECKLIST_ATUAL      = { semana1: {}, semana2: {}, semana3: {}, semana4: {} };
let ADS_FEEDBACK_ATUAL       = "";
let ADS_HAS_UNSAVED_CHANGES  = false;
let ADS_SAVING               = false;

// "idle" | "loading" | "loaded" | "sem_dados" | "error"
let ADS_PERFORMANCE_ESTADO = "idle";
let ADS_PERFORMANCE_ATUAL  = null; // dados reais da API ML
let ADS_ANUNCIOS_PAGE      = 1;

// Resumo mensal gerencial salvo manualmente (faturamentoTotal, cancelados, devolvidos, tacos)
// Vem do endpoint GET /ads/resumo-mensal e é totalmente separado da performance Mercado Ads.
let ADS_RESUMO_MENSAL_ATUAL = null;

// ─── Helpers de formatação ────────────────────────────────────────────────────

function adsFmtBRL(n) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(n) || 0);
}
function adsFmtNum(n, decimals = 2) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "0,00";
  return v.toLocaleString("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
function adsFmtPct(n, decimals = 2) {
  return adsFmtNum(n, decimals) + "%";
}
function adsFmtInt(n) {
  return (Number(n) || 0).toLocaleString("pt-BR");
}
function adsEscape(s) {
  const d = document.createElement("div");
  d.textContent = String(s ?? "");
  return d.innerHTML;
}
function adsTruncar(s, max = 70) {
  const str = String(s || "");
  return str.length > max ? str.slice(0, max - 1) + "…" : str;
}

// ─── Status baseado em ROAS ───────────────────────────────────────────────────

function adsStatusRoas(roas) {
  const r = Number(roas) || 0;
  if (r >= 20) return { label: "Saudável", cls: "is-success" };
  if (r >= 15) return { label: "Atenção",  cls: "is-warning" };
  if (r >   0) return { label: "Crítico",  cls: "is-danger"  };
  return                  { label: "—",        cls: ""               };
}

function adsStatusAnuncio(a) {
  const st = String(a.status || "").toLowerCase();
  if (st === "active")  return { label: "Ativo",   cls: "is-success" };
  if (st === "paused")  return { label: "Pausado", cls: "is-warning" };
  if (st === "idle")    return { label: "Inativo", cls: "is-danger"  };
  return                       { label: st || "—",  cls: ""               };
}

// Mapeia o accent já calculado (success/warning/danger/neutral) para o
// modificador do card, a classe do rodapé e o rótulo textual do KPI —
// nunca comunica estado só por cor.
function adsAccentMeta(accent) {
  if (accent === "success") return { modifier: "",                foot: "is-success", label: "Saudável" };
  if (accent === "warning") return { modifier: "vf-kpi--warning",  foot: "is-warning", label: "Atenção"  };
  if (accent === "danger")  return { modifier: "vf-kpi--danger",   foot: "is-danger",  label: "Crítico"  };
  return                           { modifier: "",                foot: "",           label: ""         };
}

// ─── TACOS — só faz sentido se houver faturamento total da loja ──────────────
// ACOS  = investimentoAds / gmvAds * 100        (vem/é calculado da API Mercado Ads)
// TACOS = investimentoAds / faturamentoTotal * 100  (faturamentoTotal é dado gerencial,
//         vem de /ads/resumo-mensal salvo manualmente — NUNCA da API Mercado Ads)
function adsTacosCalculado() {
  const perf = adsPerformanceFiltrada();
  const fat  = Number(ADS_RESUMO_MENSAL_ATUAL?.faturamentoTotal) || 0;
  if (!fat || fat <= 0) {
    return { tacos: null, faturamentoTotal: 0, semFaturamento: true };
  }
  const tacos = (Number(perf.investimentoAds) || 0) / fat * 100;
  return {
    tacos: Math.round(tacos * 100) / 100,
    faturamentoTotal: fat,
    semFaturamento: false,
  };
}

function adsStatusTacos(t) {
  if (t === null || t === undefined || !Number.isFinite(Number(t))) {
    return { label: "Sem dados", cls: "" };
  }
  const v = Number(t);
  if (v <= 4) return { label: "Saudável", cls: "is-success" };
  if (v <= 5) return { label: "Atenção",  cls: "is-warning" };
  return            { label: "Crítico",  cls: "is-danger"  };
}

// ─── Leitura dos filtros ──────────────────────────────────────────────────────

function adsPeriodoDaUrl() {
  try {
    const v = new URLSearchParams(window.location.search || "").get("periodo");
    return /^\d{4}-\d{2}$/.test(String(v || "")) ? v : null;
  } catch {
    return null;
  }
}

// A competência escolhida, no formato canônico YYYY-MM. Vazio = nenhuma —
// nunca "o mês atual": inferir período em silêncio é como se lê o mês errado.
function adsGetFiltroMesRef() {
  const sel = document.getElementById("ads-filtro-mes");
  const v = sel ? String(sel.value || "").trim() : "";
  return /^\d{4}-\d{2}$/.test(v) ? v : null;
}

// Só o número do mês, para os rótulos que usam ADS_MESES_LABELS.
function adsGetFiltroMes() {
  const ref = adsGetFiltroMesRef();
  return ref ? Number(ref.slice(5, 7)) || 0 : 0;
}

function adsGetClienteSlug() {
  const ctx = window.VF && window.VF.context ? window.VF.context.getContext() : null;
  return ctx && ctx.clienteSlug ? ctx.clienteSlug : "";
}

function adsGetLojaCampanha() {
  const sel = document.getElementById("ads-filtro-campanha");
  return (sel && sel.value) ? sel.value.trim() : "todas";
}

function adsGetContaMlId() {
  const ctx = window.VF && window.VF.context ? window.VF.context.getContext() : null;
  return ctx && ctx.clienteContaId ? String(ctx.clienteContaId) : "";
}

// ─── API fetch ────────────────────────────────────────────────────────────────

async function adsFetch(path, options = {}) {
  const token = localStorage.getItem(STORAGE_KEY);
  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token}`,
    ...(options.headers || {}),
  };
  return fetch(`${API_BASE}${path}`, { ...options, headers });
}

// ─── Carregar performance via API ML ─────────────────────────────────────────

async function adsCarregarPerformance() {
  const clienteSlug = adsGetClienteSlug();
  const mes         = adsGetFiltroMesRef();
  const contaMlId   = adsGetContaMlId();

  if (!clienteSlug || !mes) {
    ADS_PERFORMANCE_ATUAL  = null;
    ADS_PERFORMANCE_ESTADO = "idle";
    ADS_ANUNCIOS_PAGE = 1;
    adsRenderPerformance();
    adsPopularCampanhasSelect([]);
    return;
  }

  // A escolha da conta é do Shell (data-vf-scope="account"): sem ela, o
  // conteúdo desta página nem chega a ser exibido. Nada de decidir
  // cardinalidade aqui — essa regra mora só em vf-context.js (R8).

  ADS_PERFORMANCE_ESTADO = "loading";
  ADS_ANUNCIOS_PAGE = 1;
  adsRenderPerformance();

  try {
    const params = new URLSearchParams({ clienteSlug, mes });
    if (contaMlId) params.set("clienteContaId", contaMlId);
    const res    = await adsFetch(`/ads/performance?${params}`);
    const data   = await res.json();

    // 409 de conta ambígua é ESTADO DE CONTEXTO, não um "sem dados" desta
    // tela: o store recebe o erro tipado e leva o shell a pedir a operação
    // (mesmo tratamento de fechamentos-api.js:898).
    if (res.status === 409 && data.code === "MULTIPLE_MARKETPLACE_ACCOUNTS") {
      ADS_PERFORMANCE_ATUAL  = null;
      ADS_PERFORMANCE_ESTADO = "idle";
      adsPopularCampanhasSelect([]);
      adsRenderPerformance();
      window.VF?.context?.signalContextError({ code: "CONTA_AMBIGUA" });
      return;
    }

    if (!res.ok || !data.ok) throw new Error(data.erro || `HTTP ${res.status}`);

    if (data.semDados) {
      ADS_PERFORMANCE_ATUAL  = null;
      ADS_PERFORMANCE_ESTADO = "sem_dados";
      const motEl = document.getElementById("ads-sem-dados-motivo");
      if (motEl) motEl.textContent = data.motivo || "";
      adsPopularCampanhasSelect([]);
    } else {
      ADS_PERFORMANCE_ATUAL  = data.performance;
      ADS_PERFORMANCE_ESTADO = "loaded";
      adsPopularCampanhasSelect(data.performance?.campanhas || []);
    }
  } catch (err) {
    console.warn("[ads] falha ao carregar performance:", err.message);
    ADS_PERFORMANCE_ATUAL  = null;
    ADS_PERFORMANCE_ESTADO = "error";
    const motEl = document.getElementById("ads-sem-dados-motivo");
    if (motEl) motEl.textContent = `Erro ao consultar a API: ${err.message}`;
    adsPopularCampanhasSelect([]);
  }

  adsRenderPerformance();
}

// ─── Popular select de campanhas a partir da resposta ─────────────────────────

function adsPopularCampanhasSelect(campanhas) {
  const sel = document.getElementById("ads-filtro-campanha");
  if (!sel) return;
  const atual = sel.value;
  const ordenadas = [...campanhas].sort((a, b) => (b.investimentoAds || 0) - (a.investimentoAds || 0));
  sel.innerHTML = `<option value="">Todas</option>` +
    ordenadas.map((c) =>
      `<option value="${adsEscape(c.campaignId)}">Campanha ${adsEscape(c.campaignId)} — ${adsFmtBRL(c.investimentoAds)}</option>`
    ).join("");
  // Tenta restaurar a seleção anterior se ainda existir
  if (atual && ordenadas.some((c) => String(c.campaignId) === atual)) {
    sel.value = atual;
  } else {
    sel.value = "";
  }
}

// ─── Render: barra de estado dos dados (ADS_PERFORMANCE_ESTADO) ──────────────

function adsRenderBanner() {
  const banner   = document.getElementById("ads-sem-dados-banner");
  const titleEl  = document.getElementById("ads-data-status-title");
  const motivoEl = document.getElementById("ads-sem-dados-motivo");
  if (!banner || !titleEl) return;

  banner.classList.remove("is-info", "is-success", "is-warning", "is-danger");

  if (ADS_PERFORMANCE_ESTADO === "idle") {
    banner.classList.add("is-info");
    banner.setAttribute("role", "status");
    titleEl.textContent = "Aguardando seleção";
    if (motivoEl) motivoEl.textContent = "Selecione um cliente e um mês para carregar os dados de Mercado Ads.";
  } else if (ADS_PERFORMANCE_ESTADO === "loading") {
    banner.classList.add("is-info");
    banner.setAttribute("role", "status");
    titleEl.textContent = "Sincronizando com Mercado Ads";
    if (motivoEl) motivoEl.textContent = "Carregando performance, resumo e acompanhamento…";
  } else if (ADS_PERFORMANCE_ESTADO === "loaded") {
    banner.classList.add("is-success");
    banner.setAttribute("role", "status");
    titleEl.textContent = "Dados carregados";
    if (motivoEl) motivoEl.textContent = "";
  } else if (ADS_PERFORMANCE_ESTADO === "sem_dados") {
    banner.classList.add("is-warning");
    banner.setAttribute("role", "status");
    titleEl.textContent = "Cliente sem dados de Ads configurados";
    // ads-sem-dados-motivo já foi preenchido em adsCarregarPerformance() com data.motivo
  } else if (ADS_PERFORMANCE_ESTADO === "error") {
    banner.classList.add("is-danger");
    banner.setAttribute("role", "alert");
    titleEl.textContent = "Erro ao consultar a API";
    // ads-sem-dados-motivo já foi preenchido em adsCarregarPerformance() com a mensagem de erro
  }
}

// ─── Render: cards de resumo ──────────────────────────────────────────────────

function adsKpiCard({ label, value, foots = [], modifier = "" }) {
  const footHtml = foots
    .filter((f) => f && f.text)
    .map((f) => `<span class="vf-kpi__foot${f.cls ? " " + adsEscape(f.cls) : ""}">${adsEscape(f.text)}</span>`)
    .join("");
  return `
    <div class="vf-kpi${modifier ? " " + modifier : ""}">
      <span class="vf-kpi__label">${adsEscape(label)}</span>
      <span class="vf-kpi__value">${adsEscape(value)}</span>
      ${footHtml}
    </div>`;
}

function adsRenderSummary() {
  const grid = document.getElementById("ads-summary-grid");
  if (!grid) return;

  if (ADS_PERFORMANCE_ESTADO === "idle") {
    grid.innerHTML = `
      <div class="vf-empty">
        <p class="vf-empty__title">Selecione cliente e mês</p>
        <p class="vf-empty__description">Escolha um <strong>cliente</strong> e um <strong>mês</strong> para carregar a performance de Ads.</p>
      </div>`;
    return;
  }
  if (ADS_PERFORMANCE_ESTADO === "loading") {
    grid.innerHTML = `
      <div class="vf-loading-state">
        <span class="vf-spinner" aria-hidden="true"></span>
        Carregando dados da API Mercado Ads…
      </div>`;
    return;
  }
  if (ADS_PERFORMANCE_ESTADO === "sem_dados" || ADS_PERFORMANCE_ESTADO === "error") {
    grid.innerHTML = "";
    return;
  }

  const d = adsPerformanceFiltrada();

  const roasAccent = d.roas >= 20 ? "success" : d.roas >= 15 ? "warning" : (d.roas > 0 ? "danger" : "neutral");
  const roasMeta   = adsAccentMeta(roasAccent);

  const acosAccent = d.acos > 0 && d.acos <= 5 ? "success" : d.acos <= 8 ? "warning" : (d.acos > 0 ? "danger" : "neutral");
  const acosMeta   = adsAccentMeta(acosAccent);

  const t = adsTacosCalculado();
  const tacosAccent = t.semFaturamento ? "neutral" : (t.tacos <= 4 ? "success" : t.tacos <= 5 ? "warning" : "danger");
  const tacosMeta   = adsAccentMeta(tacosAccent);

  const cards = [
    adsKpiCard({
      label: "Investimento Ads",
      value: adsFmtBRL(d.investimentoAds),
    }),
    adsKpiCard({
      label: "GMV Ads",
      value: adsFmtBRL(d.gmvAds),
    }),
    adsKpiCard({
      label: "ROAS",
      value: adsFmtNum(d.roas) + "x",
      modifier: roasMeta.modifier,
      foots: [{ text: roasMeta.label, cls: roasMeta.foot }],
    }),
    adsKpiCard({
      label: "ACOS",
      value: adsFmtPct(d.acos),
      modifier: acosMeta.modifier,
      foots: [
        { text: "Investimento Ads ÷ GMV Ads" },
        { text: acosMeta.label, cls: acosMeta.foot },
      ],
    }),
    t.semFaturamento
      ? adsKpiCard({
          label: "TACOS",
          value: "—",
          foots: [{ text: "Informe o faturamento total em Resumo Mensal" }],
        })
      : adsKpiCard({
          label: "TACOS",
          value: adsFmtPct(t.tacos),
          modifier: tacosMeta.modifier,
          foots: [
            { text: `Investimento Ads ÷ Faturamento Total (${adsFmtBRL(t.faturamentoTotal)})` },
            { text: tacosMeta.label, cls: tacosMeta.foot },
          ],
        }),
    adsKpiCard({
      label: "Cliques",
      value: adsFmtInt(d.cliques),
    }),
    adsKpiCard({
      label: "Impressões",
      value: adsFmtInt(d.impressoes),
    }),
    adsKpiCard({
      label: "CTR",
      value: adsFmtPct(d.ctr),
    }),
    adsKpiCard({
      label: "Anúncios c/ venda",
      value: `${adsFmtInt(d.vendas)} / ${adsFmtInt(d.totalAnuncios)}`,
    }),
  ];

  grid.innerHTML = cards.join("");
}

// ─── Render: tabela mensal ────────────────────────────────────────────────────

function adsRenderTabela() {
  const tbody = document.getElementById("ads-table-body");
  const badge = document.getElementById("ads-table-total");
  if (!tbody) return;

  if (ADS_PERFORMANCE_ESTADO === "idle") {
    if (badge) badge.hidden = true;
    tbody.innerHTML = `<tr class="vf-table__empty"><td colspan="9">Selecione um cliente e mês para ver a performance.</td></tr>`;
    return;
  }
  if (ADS_PERFORMANCE_ESTADO === "loading") {
    if (badge) badge.hidden = true;
    tbody.innerHTML = `<tr class="vf-table__loading"><td colspan="9"><span class="vf-spinner vf-spinner--sm" aria-hidden="true"></span> Carregando…</td></tr>`;
    return;
  }
  if (ADS_PERFORMANCE_ESTADO === "sem_dados" || ADS_PERFORMANCE_ESTADO === "error") {
    if (badge) badge.hidden = true;
    tbody.innerHTML = `<tr class="vf-table__empty"><td colspan="9">Sem dados de Ads para este cliente.</td></tr>`;
    return;
  }

  const d   = adsPerformanceFiltrada();
  const mes = adsGetFiltroMes();
  const label = ADS_MESES_LABELS[mes] || d.mesRef || "—";
  const st  = adsStatusRoas(d.roas);

  const linha = `
    <tr>
      <td class="ads-td-mes"><strong>${adsEscape(label)}</strong></td>
      <td class="num ads-td-inv">${adsEscape(adsFmtBRL(d.investimentoAds))}</td>
      <td class="num">${adsEscape(adsFmtBRL(d.gmvAds))}</td>
      <td class="num ${d.roas >= 20 ? "ads-num-good" : d.roas >= 15 ? "" : (d.roas > 0 ? "ads-num-warn" : "")}">${adsEscape(adsFmtNum(d.roas))}x</td>
      <td class="num">${adsEscape(adsFmtPct(d.acos))}</td>
      <td class="num">${adsEscape(adsFmtInt(d.cliques))}</td>
      <td class="num">${adsEscape(adsFmtInt(d.impressoes))}</td>
      <td class="num">${d.vendas > 0 ? adsEscape(adsFmtInt(d.vendas)) : "—"}</td>
      <td class="center"><span class="vf-status ${adsEscape(st.cls)}">${adsEscape(st.label)}</span></td>
    </tr>`;

  if (badge) { badge.textContent = "1"; badge.hidden = false; }
  tbody.innerHTML = linha;
}

// ─── Recalcular performance considerando filtro de campanha ──────────────────

function adsPerformanceFiltrada() {
  if (!ADS_PERFORMANCE_ATUAL) {
    return {
      mesRef: "", investimentoAds: 0, gmvAds: 0, gmvDireto: 0, gmvIndireto: 0,
      roas: 0, acos: 0, ctr: 0, cpc: 0,
      cliques: 0, impressoes: 0, vendas: 0,
      totalAnuncios: 0,
    };
  }

  const campanhaFiltro = adsGetLojaCampanha();
  if (!campanhaFiltro || campanhaFiltro === "todas" || campanhaFiltro === "Todas") {
    return ADS_PERFORMANCE_ATUAL;
  }

  // Filtra os anúncios por campanha e recalcula agregados
  const anuncios = (ADS_PERFORMANCE_ATUAL.anuncios || [])
    .filter((a) => String(a.campaignId) === String(campanhaFiltro));

  return adsAgregarAnuncios(anuncios, ADS_PERFORMANCE_ATUAL.mesRef);
}

function adsAgregarAnuncios(anuncios, mesRef) {
  let cost = 0, gmv = 0, gmvDir = 0, gmvInd = 0, clicks = 0, prints = 0, vendas = 0;
  for (const a of anuncios) {
    const m = a.metrics || {};
    cost   += Number(m.cost)           || 0;
    gmv    += Number(m.totalAmount)    || 0;
    gmvDir += Number(m.directAmount)   || 0;
    gmvInd += Number(m.indirectAmount) || 0;
    clicks += Number(m.clicks)         || 0;
    prints += Number(m.prints)         || 0;
    if ((Number(m.totalAmount) || 0) > 0) vendas += 1;
  }
  const roas = cost   > 0 ? gmv / cost : 0;
  const acos = gmv    > 0 ? (cost / gmv) * 100 : 0;
  const ctr  = prints > 0 ? (clicks / prints) * 100 : 0;
  const cpc  = clicks > 0 ? cost / clicks : 0;
  return {
    mesRef: mesRef || "",
    investimentoAds: Math.round(cost  * 100) / 100,
    gmvAds:          Math.round(gmv   * 100) / 100,
    gmvDireto:       Math.round(gmvDir * 100) / 100,
    gmvIndireto:     Math.round(gmvInd * 100) / 100,
    roas:            Math.round(roas  * 100) / 100,
    acos:            Math.round(acos  * 100) / 100,
    ctr:             Math.round(ctr * 10000) / 10000,
    cpc:             Math.round(cpc   * 100) / 100,
    cliques: clicks, impressoes: prints, vendas,
    totalAnuncios: anuncios.length,
  };
}

// ─── Render: tabela de anúncios ───────────────────────────────────────────────

function adsAnunciosFiltradosOrdenados() {
  if (!ADS_PERFORMANCE_ATUAL || !Array.isArray(ADS_PERFORMANCE_ATUAL.anuncios)) return [];
  let lista = ADS_PERFORMANCE_ATUAL.anuncios.slice();

  // Filtro por campanha
  const campanhaFiltro = adsGetLojaCampanha();
  if (campanhaFiltro && campanhaFiltro !== "todas" && campanhaFiltro !== "Todas") {
    lista = lista.filter((a) => String(a.campaignId) === String(campanhaFiltro));
  }

  // Filtro por busca textual
  const buscaEl = document.getElementById("ads-anuncios-busca");
  const busca = buscaEl ? buscaEl.value.trim().toLowerCase() : "";
  if (busca) {
    lista = lista.filter((a) => {
      const titulo = String(a.title || "").toLowerCase();
      const mlb    = String(a.itemId || "").toLowerCase();
      const marca  = String(a.brandValueName || "").toLowerCase();
      return titulo.includes(busca) || mlb.includes(busca) || marca.includes(busca);
    });
  }

  // Filtro por status
  const statusEl = document.getElementById("ads-anuncios-status");
  const status = statusEl ? statusEl.value : "";
  if (status === "active" || status === "paused" || status === "idle") {
    lista = lista.filter((a) => String(a.status || "").toLowerCase() === status);
  } else if (status === "sold") {
    lista = lista.filter((a) => (a.metrics?.totalAmount || 0) > 0);
  }

  // Ordenação
  const ordenarEl = document.getElementById("ads-anuncios-ordenar");
  const ordenar = ordenarEl ? ordenarEl.value : "cost_desc";
  const cmp = {
    cost_desc:   (a, b) => (b.metrics?.cost        || 0) - (a.metrics?.cost        || 0),
    gmv_desc:    (a, b) => (b.metrics?.totalAmount || 0) - (a.metrics?.totalAmount || 0),
    roas_desc:   (a, b) => (b.metrics?.roas        || 0) - (a.metrics?.roas        || 0),
    acos_desc:   (a, b) => (b.metrics?.acos        || 0) - (a.metrics?.acos        || 0),
    clicks_desc: (a, b) => (b.metrics?.clicks      || 0) - (a.metrics?.clicks      || 0),
    prints_desc: (a, b) => (b.metrics?.prints      || 0) - (a.metrics?.prints      || 0),
  }[ordenar] || ((a, b) => (b.metrics?.cost || 0) - (a.metrics?.cost || 0));

  lista.sort(cmp);
  return lista;
}

function adsRenderAnuncios() {
  const tbody = document.getElementById("ads-anuncios-body");
  const total = document.getElementById("ads-anuncios-total");
  const pager = document.getElementById("ads-anuncios-pager");
  if (!tbody) return;

  if (ADS_PERFORMANCE_ESTADO === "idle") {
    if (total) total.hidden = true;
    if (pager) pager.innerHTML = "";
    tbody.innerHTML = `<tr class="vf-table__empty"><td colspan="11">Selecione um cliente e mês para ver os anúncios.</td></tr>`;
    return;
  }
  if (ADS_PERFORMANCE_ESTADO === "loading") {
    if (total) total.hidden = true;
    if (pager) pager.innerHTML = "";
    tbody.innerHTML = `<tr class="vf-table__loading"><td colspan="11"><span class="vf-spinner vf-spinner--sm" aria-hidden="true"></span> Carregando anúncios da API Mercado Ads…</td></tr>`;
    return;
  }
  if (ADS_PERFORMANCE_ESTADO === "sem_dados" || ADS_PERFORMANCE_ESTADO === "error") {
    if (total) total.hidden = true;
    if (pager) pager.innerHTML = "";
    tbody.innerHTML = `<tr class="vf-table__empty"><td colspan="11">Sem anúncios para este cliente/período.</td></tr>`;
    return;
  }

  const lista = adsAnunciosFiltradosOrdenados();

  if (total) {
    total.textContent = String(lista.length);
    total.hidden      = false;
  }

  if (!lista.length) {
    if (pager) pager.innerHTML = "";
    tbody.innerHTML = `<tr class="vf-table__empty"><td colspan="11">Nenhum anúncio para o filtro selecionado.</td></tr>`;
    return;
  }

  const totalPag = Math.max(1, Math.ceil(lista.length / ANUNCIOS_PAGE_SIZE));
  if (ADS_ANUNCIOS_PAGE > totalPag) ADS_ANUNCIOS_PAGE = totalPag;
  if (ADS_ANUNCIOS_PAGE < 1) ADS_ANUNCIOS_PAGE = 1;

  const ini = (ADS_ANUNCIOS_PAGE - 1) * ANUNCIOS_PAGE_SIZE;
  const fim = ini + ANUNCIOS_PAGE_SIZE;
  const pagina = lista.slice(ini, fim);

  tbody.innerHTML = pagina.map((a) => {
    const m = a.metrics || {};
    const st = adsStatusAnuncio(a);
    const roasCls = (m.roas >= 20) ? "ads-num-good" : (m.roas >= 15 ? "" : (m.roas > 0 ? "ads-num-warn" : ""));
    const acosCls = (m.acos > 0 && m.acos <= 5) ? "ads-num-good" : (m.acos <= 8 && m.acos > 0 ? "" : (m.acos > 0 ? "ads-num-warn" : ""));
    const thumb = a.thumbnail
      ? `<img class="ads-anuncio-thumb" src="${adsEscape(a.thumbnail.replace(/^http:/i, "https:"))}" alt="" loading="lazy" onerror="this.hidden=true">`
      : `<div class="ads-anuncio-thumb ads-anuncio-thumb--ph"></div>`;
    const linkBtn = a.permalink
      ? `<a href="${adsEscape(a.permalink)}" target="_blank" rel="noopener" class="ads-anuncio-link" title="Abrir no Mercado Livre" aria-label="Abrir anúncio no Mercado Livre">
           <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
         </a>`
      : "—";

    return `
      <tr>
        <td class="ads-col-anuncio">
          <div class="ads-anuncio-cell">
            ${thumb}
            <div class="ads-anuncio-info">
              <div class="ads-anuncio-titulo">${adsEscape(adsTruncar(a.title, 80))}</div>
              <div class="ads-anuncio-meta">
                <span class="ads-anuncio-mlb">${adsEscape(a.itemId || "—")}</span>
                ${a.brandValueName ? `<span class="ads-anuncio-marca">${adsEscape(a.brandValueName)}</span>` : ""}
                ${a.price ? `<span class="ads-anuncio-preco">${adsEscape(adsFmtBRL(a.price))}</span>` : ""}
              </div>
            </div>
          </div>
        </td>
        <td class="num ads-td-inv">${adsEscape(adsFmtBRL(m.cost))}</td>
        <td class="num">${adsEscape(adsFmtBRL(m.totalAmount))}</td>
        <td class="num ${roasCls}">${m.roas > 0 ? adsEscape(adsFmtNum(m.roas)) + "x" : "—"}</td>
        <td class="num ${acosCls}">${m.acos > 0 ? adsEscape(adsFmtPct(m.acos)) : "—"}</td>
        <td class="num">${adsEscape(adsFmtInt(m.clicks))}</td>
        <td class="num">${adsEscape(adsFmtInt(m.prints))}</td>
        <td class="num">${m.ctr > 0 ? adsEscape(adsFmtPct(m.ctr)) : "—"}</td>
        <td class="num">${m.cpc > 0 ? adsEscape(adsFmtBRL(m.cpc)) : "—"}</td>
        <td class="center"><span class="vf-status ${adsEscape(st.cls)}">${adsEscape(st.label)}</span></td>
        <td class="center">${linkBtn}</td>
      </tr>`;
  }).join("");

  // Pager
  if (pager) {
    if (totalPag <= 1) {
      pager.innerHTML = `<div class="vf-pager__info">Mostrando ${lista.length} de ${lista.length}</div>`;
    } else {
      const inicio = ini + 1;
      const fimReal = Math.min(fim, lista.length);
      pager.innerHTML = `
        <div class="vf-pager__info">Mostrando ${inicio}–${fimReal} de ${lista.length}</div>
        <div class="vf-pager__nav">
          <button type="button" class="vf-btn vf-btn--secondary vf-btn--sm ads-pager-btn" data-action="prev" ${ADS_ANUNCIOS_PAGE === 1 ? "disabled" : ""}>‹ Anterior</button>
          <span class="ads-pager-page">Página ${ADS_ANUNCIOS_PAGE} de ${totalPag}</span>
          <button type="button" class="vf-btn vf-btn--secondary vf-btn--sm ads-pager-btn" data-action="next" ${ADS_ANUNCIOS_PAGE === totalPag ? "disabled" : ""}>Próxima ›</button>
        </div>`;
      pager.querySelectorAll(".ads-pager-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          if (btn.dataset.action === "prev" && ADS_ANUNCIOS_PAGE > 1) ADS_ANUNCIOS_PAGE -= 1;
          if (btn.dataset.action === "next" && ADS_ANUNCIOS_PAGE < totalPag) ADS_ANUNCIOS_PAGE += 1;
          adsRenderAnuncios();
        });
      });
    }
  }
}

// ─── Render unificado de performance ─────────────────────────────────────────

function adsRenderPerformance() {
  adsRenderBanner();
  adsRenderSummary();
  adsRenderTabela();
  adsRenderAnuncios();
}

// ─── Resumo mensal gerencial (faturamento, cancelados, devolvidos, TACOS) ─────
// Independente da API Mercado Ads. Lê dados salvos manualmente em /ads/resumo-mensal.

async function adsCarregarResumoMensal() {
  const clienteSlug = adsGetClienteSlug();
  const mes         = adsGetFiltroMesRef();

  if (!clienteSlug || !mes) {
    ADS_RESUMO_MENSAL_ATUAL = null;
    adsRenderPerformance();
    return;
  }

  try {
    const params = new URLSearchParams({ clienteSlug, mes, lojaCampanha: "todas" });
    const res    = await adsFetch(`/ads/resumo-mensal?${params}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.erro || "Resposta inválida");
    ADS_RESUMO_MENSAL_ATUAL = data.resumo || null;
  } catch (err) {
    console.warn("[ads] falha ao carregar resumo mensal:", err.message);
    ADS_RESUMO_MENSAL_ATUAL = null;
  }

  // Re-render para refletir TACOS / faturamento
  adsRenderPerformance();
}

// ─── Checklist semanal ────────────────────────────────────────────────────────

async function adsCarregarAcompanhamento() {
  const clienteSlug = adsGetClienteSlug();
  const mes         = adsGetFiltroMesRef();

  if (!clienteSlug || !mes) {
    ADS_CHECKLIST_ATUAL      = { semana1: {}, semana2: {}, semana3: {}, semana4: {} };
    ADS_FEEDBACK_ATUAL       = "";
    ADS_ACOMPANHAMENTO_ATUAL = null;
    ADS_HAS_UNSAVED_CHANGES  = false;
    adsAtualizarFeedbackTextarea();
    adsAtualizarUpdatedAt(null);
    adsRenderChecklist();
    adsAtualizarBotaoSalvar();
    return;
  }

  const loja = adsGetLojaCampanha();
  adsSetSaveStatus("Carregando…", "is-info");

  try {
    const params = new URLSearchParams({ clienteSlug, mes, lojaCampanha: loja });
    const res    = await adsFetch(`/ads/acompanhamento?${params}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.ok || !data.acompanhamento) throw new Error("Resposta inválida");

    const a = data.acompanhamento;
    ADS_ACOMPANHAMENTO_ATUAL = a;
    ADS_CHECKLIST_ATUAL = (a.checklist && typeof a.checklist === "object" && !Array.isArray(a.checklist))
      ? a.checklist
      : { semana1: {}, semana2: {}, semana3: {}, semana4: {} };
    ADS_FEEDBACK_ATUAL      = a.feedbackText || "";
    ADS_HAS_UNSAVED_CHANGES = false;

    adsAtualizarFeedbackTextarea();
    adsAtualizarUpdatedAt(a.updatedAt);
    adsRenderChecklist();
    adsSetSaveStatus("Carregado", "is-success");
    setTimeout(() => adsLimparSaveStatus("is-success"), 2500);
  } catch (err) {
    console.warn("[ads] falha ao carregar acompanhamento:", err.message);
    ADS_CHECKLIST_ATUAL     = { semana1: {}, semana2: {}, semana3: {}, semana4: {} };
    ADS_FEEDBACK_ATUAL      = "";
    ADS_HAS_UNSAVED_CHANGES = false;
    adsAtualizarFeedbackTextarea();
    adsAtualizarUpdatedAt(null);
    adsRenderChecklist();
    adsSetSaveStatus("Erro ao carregar", "is-danger");
    setTimeout(() => adsLimparSaveStatus("is-danger"), 3500);
  }

  adsAtualizarBotaoSalvar();
}

function adsAtualizarFeedbackTextarea() {
  const ta = document.getElementById("ads-feedback-textarea");
  if (ta) ta.value = ADS_FEEDBACK_ATUAL;
}

function adsAtualizarUpdatedAt(updatedAt) {
  const el = document.getElementById("ads-updated-at");
  if (!el) return;
  if (!updatedAt) { el.hidden = true; el.textContent = ""; return; }
  const str = new Date(updatedAt).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
  el.textContent = `Última atualização: ${str}`;
  el.hidden      = false;
}

// ─── Status de salvamento ─────────────────────────────────────────────────────

function adsSetSaveStatus(msg, cls) {
  const el = document.getElementById("ads-save-status");
  if (!el) return;
  el.textContent = msg;
  el.className   = `vf-alert${cls ? " " + cls : ""}`;
  el.setAttribute("role", cls === "is-danger" ? "alert" : "status");
  el.hidden      = false;
}

function adsLimparSaveStatus(onlyCls) {
  const el = document.getElementById("ads-save-status");
  if (!el) return;
  if (onlyCls && !el.classList.contains(onlyCls)) return;
  el.hidden      = true;
  el.textContent = "";
  el.className   = "vf-alert";
}

function adsAtualizarSaveStatus() {
  if (ADS_HAS_UNSAVED_CHANGES) {
    adsSetSaveStatus("Alterações não salvas", "is-warning");
  } else {
    adsLimparSaveStatus();
  }
  adsAtualizarBotaoSalvar();
}

function adsCanSave() {
  return !!(adsGetClienteSlug() && adsGetFiltroMesRef() && !ADS_SAVING);
}

function adsAtualizarBotaoSalvar() {
  const btn = document.getElementById("ads-btn-salvar");
  if (!btn) return;
  btn.disabled = !adsCanSave();
}

// ─── Salvar acompanhamento ────────────────────────────────────────────────────

async function adsSalvarAcompanhamento() {
  if (!adsCanSave()) return;

  const clienteSlug  = adsGetClienteSlug();
  const mes          = adsGetFiltroMesRef();
  const lojaCampanha = adsGetLojaCampanha();

  ADS_SAVING = true;
  const btn  = document.getElementById("ads-btn-salvar");
  if (btn) { btn.disabled = true; btn.textContent = "Salvando…"; }
  adsSetSaveStatus("Salvando…", "is-info");

  try {
    const res = await adsFetch("/ads/acompanhamento", {
      method: "PUT",
      body: JSON.stringify({
        clienteSlug,
        mes,
        lojaCampanha,
        checklist:    ADS_CHECKLIST_ATUAL,
        feedbackText: ADS_FEEDBACK_ATUAL,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.erro || `HTTP ${res.status}`);

    ADS_HAS_UNSAVED_CHANGES  = false;
    ADS_ACOMPANHAMENTO_ATUAL = data.acompanhamento;
    adsAtualizarUpdatedAt(data.acompanhamento?.updatedAt);
    adsSetSaveStatus("Acompanhamento salvo", "is-success");
    setTimeout(() => adsLimparSaveStatus("is-success"), 2500);
  } catch (err) {
    console.warn("[ads] falha ao salvar:", err.message);
    adsSetSaveStatus(`Erro: ${err.message}`, "is-danger");
    setTimeout(() => adsLimparSaveStatus("is-danger"), 4000);
  } finally {
    ADS_SAVING = false;
    if (btn) { btn.textContent = "Salvar acompanhamento"; btn.disabled = !adsCanSave(); }
  }
}

// ─── Render: checklist semanal ────────────────────────────────────────────────

function adsGetCheck(sem, idx) {
  const semKey  = `semana${sem}`;
  const itemKey = ADS_CHECKLIST_KEYS[idx];
  const semObj  = ADS_CHECKLIST_ATUAL[semKey];
  return !!(semObj && semObj[itemKey]);
}

function adsSetCheck(sem, idx, value) {
  const semKey  = `semana${sem}`;
  const itemKey = ADS_CHECKLIST_KEYS[idx];
  if (!ADS_CHECKLIST_ATUAL[semKey]) ADS_CHECKLIST_ATUAL[semKey] = {};
  if (value) {
    ADS_CHECKLIST_ATUAL[semKey][itemKey] = true;
  } else {
    delete ADS_CHECKLIST_ATUAL[semKey][itemKey];
  }
  ADS_HAS_UNSAVED_CHANGES = true;
  adsAtualizarSaveStatus();
}

function adsRenderChecklist() {
  const grid = document.getElementById("ads-checklist-grid");
  if (!grid) return;

  const clienteSlug = adsGetClienteSlug();
  const mes         = adsGetFiltroMesRef();

  if (!clienteSlug || !mes) {
    grid.innerHTML = `
      <div class="vf-empty">
        <p class="vf-empty__description">Selecione um <strong>cliente</strong> e um <strong>mês</strong> para carregar o checklist.</p>
      </div>`;
    adsAtualizarBotaoSalvar();
    return;
  }

  const semanas = [1, 2, 3, 4];
  grid.innerHTML = semanas.map((sem) => {
    const checks = ADS_CHECKLIST_ITEMS.map((item, idx) => {
      const checked = adsGetCheck(sem, idx);
      return `
        <label class="vf-check ads-check-item">
          <input type="checkbox" class="ads-check-input" data-semana="${sem}" data-idx="${idx}" ${checked ? "checked" : ""}>
          <span>${adsEscape(item)}</span>
        </label>`;
    }).join("");

    const total   = ADS_CHECKLIST_ITEMS.length;
    const done    = ADS_CHECKLIST_ITEMS.filter((_, idx) => adsGetCheck(sem, idx)).length;
    const pct     = Math.round((done / total) * 100);
    const allDone = done === total;

    return `
      <div class="ads-week-card ${allDone ? "is-complete" : ""}">
        <div class="ads-week-header">
          <div class="ads-week-title">
            <span class="ads-week-num">Semana ${sem}</span>
            ${allDone ? `<svg class="ads-week-done-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>` : ""}
          </div>
          <div class="ads-week-progress">
            <div class="ads-week-progress-bar" style="width:${pct}%"></div>
          </div>
          <span class="ads-week-progress-label">${done}/${total}</span>
        </div>
        <div class="ads-week-checks">${checks}</div>
      </div>`;
  }).join("");

  grid.querySelectorAll(".ads-check-input").forEach((input) => {
    input.addEventListener("change", () => {
      const sem = Number(input.dataset.semana);
      const idx = Number(input.dataset.idx);
      adsSetCheck(sem, idx, input.checked);
      adsRenderChecklist();
    });
  });

  adsAtualizarBotaoSalvar();
}

// ─── Feedback para o cliente ──────────────────────────────────────────────────

function adsGerarFeedback() {
  const d   = adsPerformanceFiltrada();
  const mes = adsGetFiltroMes();
  const mesLabel = ADS_MESES_LABELS[mes] || d.mesRef || "período selecionado";

  if (!d.investimentoAds && !d.gmvAds && !d.totalAnuncios) {
    const ta = document.getElementById("ads-feedback-textarea");
    if (ta) ta.value = "Nenhum dado disponível para o período selecionado.";
    ADS_FEEDBACK_ATUAL      = ta ? ta.value : "";
    ADS_HAS_UNSAVED_CHANGES = true;
    adsAtualizarSaveStatus();
    return;
  }

  const st = adsStatusRoas(d.roas);
  const linhas = [
    `📊 Relatório de Mercado Ads — ${mesLabel}`,
    ``,
    `💰 Investimento em Ads: ${adsFmtBRL(d.investimentoAds)}`,
    `📈 GMV gerado pelos Ads: ${adsFmtBRL(d.gmvAds)}`,
    `🔁 ROAS: ${adsFmtNum(d.roas)}x`,
    `🎯 ACOS: ${adsFmtPct(d.acos)} (Investimento Ads ÷ GMV Ads)`,
  ];

  // TACOS é métrica gerencial: investimento / faturamento total da loja.
  // Só aparece quando o faturamento total foi informado em Resumo Mensal.
  const t = adsTacosCalculado();
  if (!t.semFaturamento) {
    const stT = adsStatusTacos(t.tacos);
    linhas.push(`🏪 TACOS: ${adsFmtPct(t.tacos)} (Investimento Ads ÷ Faturamento Total de ${adsFmtBRL(t.faturamentoTotal)}) — ${stT.label}`);
  } else {
    linhas.push(`🏪 TACOS: não calculado porque o faturamento total do mês ainda não foi informado em "Resumo Mensal".`);
  }

  if (d.cliques > 0)    linhas.push(`🖱️  Cliques: ${adsFmtInt(d.cliques)}`);
  if (d.impressoes > 0) linhas.push(`👁️  Impressões: ${adsFmtInt(d.impressoes)}`);
  if (d.ctr > 0)        linhas.push(`📊 CTR: ${adsFmtPct(d.ctr)}`);
  if (d.cpc > 0)        linhas.push(`💵 CPC médio: ${adsFmtBRL(d.cpc)}`);
  if (d.totalAnuncios)  linhas.push(`📦 Anúncios analisados: ${adsFmtInt(d.totalAnuncios)} (${adsFmtInt(d.vendas)} com venda)`);

  linhas.push(``, `✅ Análise:`);

  if (d.roas >= 20) {
    linhas.push(`Os investimentos em Ads estão com excelente retorno. O ROAS de ${adsFmtNum(d.roas)}x indica alta eficiência das campanhas.`);
  } else if (d.roas >= 15) {
    linhas.push(`O ROAS de ${adsFmtNum(d.roas)}x está em zona de atenção. Recomendamos revisar campanhas de menor performance para otimizar o retorno.`);
  } else if (d.roas > 0) {
    linhas.push(`O ROAS de ${adsFmtNum(d.roas)}x está abaixo do ideal. É importante revisar os lances e pausar campanhas de baixo retorno.`);
  } else {
    linhas.push(`Sem retorno mensurável das campanhas no período. Recomendamos revisar configuração das campanhas e dos anúncios ativos.`);
  }

  if (!t.semFaturamento) {
    if (t.tacos <= 4) {
      linhas.push(`O TACOS de ${adsFmtPct(t.tacos)} está saudável — o peso dos Ads sobre o faturamento total da loja está dentro do esperado.`);
    } else if (t.tacos <= 5) {
      linhas.push(`O TACOS de ${adsFmtPct(t.tacos)} está em zona de atenção. Vale rever o equilíbrio entre investimento em Ads e faturamento total.`);
    } else {
      linhas.push(`O TACOS de ${adsFmtPct(t.tacos)} está crítico. O investimento em Ads pesa demais sobre o faturamento total — recomendamos reduzir lances de menor retorno ou pausar campanhas pouco eficientes.`);
    }
  }

  linhas.push(``, `📌 Próximos passos:`);
  linhas.push(`- Revisar anúncios com maior ACOS e menor ROAS`);
  linhas.push(`- Reforçar campanhas com ROAS acima da média`);
  if (t.semFaturamento) {
    linhas.push(`- Informar o faturamento total do mês em "Resumo Mensal" para acompanhar o TACOS`);
  } else {
    linhas.push(`- Acompanhar evolução do TACOS para manter o investimento equilibrado com o faturamento`);
  }
  linhas.push(`- Ajustar orçamento conforme sazonalidade`);

  const ta = document.getElementById("ads-feedback-textarea");
  if (ta) ta.value = linhas.join("\n");
  ADS_FEEDBACK_ATUAL      = ta ? ta.value : "";
  ADS_HAS_UNSAVED_CHANGES = true;
  adsAtualizarSaveStatus();
}

function adsCopiarFeedback() {
  const ta = document.getElementById("ads-feedback-textarea");
  const ok = document.getElementById("ads-copy-ok");
  if (!ta || !ta.value.trim()) return;
  navigator.clipboard.writeText(ta.value).then(() => {
    if (ok) { ok.hidden = false; setTimeout(() => { ok.hidden = true; }, 2200); }
  }).catch(() => {
    ta.select();
    document.execCommand("copy");
  });
}

// ─── Preencher selects ────────────────────────────────────────────────────────

function adsFillSelects() {
  // Competências: as últimas 13, da mais recente para a mais antiga — mesma
  // lista do Financeiro V3 e da Visão. O seletor anterior montava 12 meses do
  // ANO CORRENTE, o que tornava impossível olhar dezembro do ano passado.
  const selMes = document.getElementById("ads-filtro-mes");
  if (selMes) {
    const hoje = new Date();
    const opcoes = [];
    for (let i = 0; i < 13; i++) {
      const d = new Date(Date.UTC(hoje.getFullYear(), hoje.getMonth() - i, 1));
      const ano = d.getUTCFullYear();
      const mes = d.getUTCMonth() + 1;
      opcoes.push(`<option value="${ano}-${String(mes).padStart(2, "0")}">${adsEscape(ADS_MESES_LABELS[mes])} / ${ano}</option>`);
    }
    selMes.innerHTML = `<option value="">Selecione a competência</option>` + opcoes.join("");
    // `?periodo=` é a competência canônica do V3 (vf-context.js §8.5): ela
    // sobrevive à troca de operação e à navegação entre módulos. Nenhum
    // padrão é escolhido quando ela não vem — "sem competência" é um estado
    // legítimo, e inferir o mês atual aqui seria decidir pelo operador.
    //
    // Lida direto da URL, não de window.VF.context: este script clássico é
    // avaliado ANTES de vf-shell.js (module, deferido) publicar o store.
    const daUrl = adsPeriodoDaUrl();
    if (daUrl && Array.prototype.some.call(selMes.options, (o) => o.value === daUrl)) selMes.value = daUrl;
  }

  // Período do checklist
  adsAtualizarPeriodoChecklist();

  // Campanhas: populadas via API (adsPopularCampanhasSelect)
}

function adsAtualizarPeriodoChecklist() {
  const periodEl = document.getElementById("ads-checklist-period");
  if (!periodEl) return;
  const ref = adsGetFiltroMesRef();
  if (!ref) { periodEl.textContent = "—"; return; }
  const [ano, mes] = ref.split("-").map(Number);
  const d = new Date(ano, mes - 1, 1);
  periodEl.textContent = d.toLocaleDateString("pt-BR", { month: "short", year: "numeric" })
    .replace(/^\w/, (c) => c.toUpperCase());
}

// ─── Event listeners ─────────────────────────────────────────────────────────

document.getElementById("ads-btn-atualizar")?.addEventListener("click", () => {
  adsCarregarPerformance();
  adsCarregarResumoMensal();
  adsCarregarAcompanhamento();
});

document.getElementById("ads-filtro-mes")?.addEventListener("change", () => {
  // A competência é compartilhável: fica na URL, como no resto do V3.
  window.VF?.context?.setPeriodoParam?.(adsGetFiltroMesRef());
  adsAtualizarPeriodoChecklist();
  adsRecarregarTudo();
});

/* ── CONTEXTO (F5 — vem do Shell V3) ─────────────────────────────────────
   Registrado enquanto este script clássico é avaliado, ou seja ANTES de
   vf-shell.js (module, deferido) rodar: nenhum emit se perde, nem o
   primeiro, síncrono, de dentro de vfContext.init(). A guarda por chave
   evita refazer três requisições quando `vf:context` dispara por algo que
   não é troca de cliente/operação (bandeira de integração, re-render). */
let adsUltimoContexto = Symbol("contexto-nao-aplicado-ainda");
document.addEventListener("vf:context", () => {
  const slug = adsGetClienteSlug();
  const conta = adsGetContaMlId();
  // Escopo CONTA: `vf:context` emite durante a resolução das contas (cliente
  // já conhecido, conta ainda não). Buscar aí gastaria uma requisição para um
  // recorte que o operador não escolheu — e /ads/performance responderia 409
  // de qualquer forma quando o cliente tem 2+ contas.
  const chave = slug && conta ? `${slug}:${conta}` : "";
  if (chave === adsUltimoContexto) return;
  adsUltimoContexto = chave;
  if (!chave) return;
  adsRecarregarTudo();
});

function adsRecarregarTudo() {
  adsCarregarPerformance();
  adsCarregarResumoMensal();
  adsCarregarAcompanhamento();
}

document.getElementById("ads-filtro-campanha")?.addEventListener("change", () => {
  ADS_ANUNCIOS_PAGE = 1;
  adsRenderPerformance();
  adsCarregarAcompanhamento();
});

// Filtros locais da tabela de anúncios (não disparam fetch)
document.getElementById("ads-anuncios-busca")?.addEventListener("input", () => {
  ADS_ANUNCIOS_PAGE = 1;
  adsRenderAnuncios();
});
document.getElementById("ads-anuncios-status")?.addEventListener("change", () => {
  ADS_ANUNCIOS_PAGE = 1;
  adsRenderAnuncios();
});
document.getElementById("ads-anuncios-ordenar")?.addEventListener("change", () => {
  ADS_ANUNCIOS_PAGE = 1;
  adsRenderAnuncios();
});

document.getElementById("ads-btn-gerar")?.addEventListener("click", adsGerarFeedback);
document.getElementById("ads-btn-copiar")?.addEventListener("click", adsCopiarFeedback);
document.getElementById("ads-btn-salvar")?.addEventListener("click", adsSalvarAcompanhamento);
document.getElementById("ads-feedback-textarea")?.addEventListener("input", (e) => {
  ADS_FEEDBACK_ATUAL      = e.target.value;
  ADS_HAS_UNSAVED_CHANGES = true;
  adsAtualizarSaveStatus();
});

// ─── Init ─────────────────────────────────────────────────────────────────────

adsFillSelects();
adsRenderPerformance();
adsRenderChecklist();
// A primeira carga não é disparada aqui: ela vem do primeiro `vf:context`,
// que só chega quando cliente E operação estão resolvidos. Chamar agora
// buscaria com contexto vazio.
