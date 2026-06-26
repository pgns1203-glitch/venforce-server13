/* ================================================================
   fechamentos-api.js — VenForce · Central de Vendas
   ----------------------------------------------------------------
   FERRAMENTA OPERACIONAL de conciliação por PEDIDO.
   Regra central: o PEDIDO é a fonte da verdade; o PRODUTO é agregação
   dos pedidos; dia/semana/mês são FILTROS sobre os pedidos.

   Honestidade do dado:
     null/undefined = AUSENTE (mostra "—")   ·   0 = zero REAL
     status: real | estimado | ausente | parcial | bloqueado
     resultado NUNCA é exibido como confiável se faltar dado.
   ================================================================ */

const STORAGE_KEY = "vf-token";
const API_BASE    = "https://venforce-server.onrender.com";

function getToken() {
  const t = localStorage.getItem(STORAGE_KEY);
  if (!t) { window.location.replace("index.html"); return null; }
  return t;
}
const TOKEN = getToken();

if (typeof window.initLayout === "function") window.initLayout();

/* ── HELPERS DE FORMATO ───────────────────────────────────── */
const esc = s => String(s ?? "").replace(/[&<>"']/g,
  c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const num   = (n, d = 0) => (Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
const money = n => 'R$ ' + num(n, 2);
const pct   = n => num(n, 1) + '%';
const round2 = v => { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0; };
const fmtDt = s => { if (s == null || s === '') return '—'; const d = new Date(s + (String(s).length === 10 ? 'T00:00:00' : '')); return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR'); };
const isoDate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/* Período de análise: converte o modo escolhido em { dateFrom, dateTo }. */
const PERIOD_OPTS = [
  ['mes_atual', 'Mês atual'],
  ['mes_anterior', 'Mês anterior'],
  ['ultimos7', 'Últimos 7 dias'],
  ['ultimos30', 'Últimos 30 dias'],
  ['personalizado', 'Personalizado'],
];
function computePeriodo(mode, customFrom, customTo) {
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const y = hoje.getFullYear(), m = hoje.getMonth();
  if (mode === 'mes_anterior') {
    return { mode, dateFrom: isoDate(new Date(y, m - 1, 1)), dateTo: isoDate(new Date(y, m, 0)) };
  }
  if (mode === 'ultimos7') {
    const f = new Date(hoje); f.setDate(f.getDate() - 6);
    return { mode, dateFrom: isoDate(f), dateTo: isoDate(hoje) };
  }
  if (mode === 'ultimos30') {
    const f = new Date(hoje); f.setDate(f.getDate() - 29);
    return { mode, dateFrom: isoDate(f), dateTo: isoDate(hoje) };
  }
  if (mode === 'personalizado') {
    const from = customFrom || isoDate(new Date(y, m, 1));
    const to = customTo || isoDate(hoje);
    return { mode: 'personalizado', dateFrom: from <= to ? from : to, dateTo: from <= to ? to : from };
  }
  // mes_atual (default): 1º dia do mês até hoje
  return { mode: 'mes_atual', dateFrom: isoDate(new Date(y, m, 1)), dateTo: isoDate(hoje) };
}
const shortMoney = n => {
  const v = Number(n) || 0;
  const abs = Math.abs(v);
  if (abs >= 1000000) return 'R$ ' + num(v / 1000000, 1) + ' mi';
  if (abs >= 1000) return 'R$ ' + num(v / 1000, 1) + 'k';
  return 'R$ ' + num(v, 0);
};
/* '—' para ausente; valor para 0 real. */
const valOr = (v, f = num) => (v === null || v === undefined) ? '—' : f(v);

/* ── STATUS / CONFIANÇA / CHIPS ───────────────────────────── */
const STATUS_LBL = { real:'Real', estimado:'Estimado', ausente:'Ausente', parcial:'Parcial', bloqueado:'Bloqueado' };
const STATUS_CLS = { real:'ok', estimado:'info', ausente:'crit', parcial:'warn', bloqueado:'muted' };
function statusBadge(s) { return `<span class="fapi-badge fapi-badge--${STATUS_CLS[s] || 'muted'}">${esc(STATUS_LBL[s] || s || '—')}</span>`; }
const CONF = { confiavel:['ok','Confiável'], parcial:['warn','Parcial'], insuficiente:['crit','Insuficiente'], bloqueado:['crit','Bloqueado'] };
function confidenceClass(c) { return (CONF[c] || CONF.bloqueado)[0]; }
function confidenceLabel(c) { return (CONF[c] || CONF.bloqueado)[1]; }
function confPill(c) { return `<span class="fapi-conf-pill fapi-conf-pill--${confidenceClass(c)}">${esc(confidenceLabel(c))}</span>`; }

/* chips discretos de logística / ads / diagnóstico */
function tagFull(full) {
  if (full === true)  return `<span class="fapi-tag fapi-tag--full">Full</span>`;
  if (full === false) return `<span class="fapi-tag fapi-tag--muted">Normal</span>`;
  return `<span class="fapi-tag fapi-tag--ausente">logística —</span>`;
}
function tagAds(status) {
  if (status === 'real')    return `<span class="fapi-tag fapi-tag--ads">Ads</span>`;
  if (status === 'parcial') return `<span class="fapi-tag fapi-tag--warn">Ads parcial</span>`;
  if (status === 'nao')     return `<span class="fapi-tag fapi-tag--muted">sem Ads</span>`;
  return `<span class="fapi-tag fapi-tag--ausente">Ads —</span>`;
}
function tagDiag(prod) {
  if (!prod) return `<span class="fapi-tag fapi-tag--ausente">—</span>`;
  const temCusto = prod.base?.temCusto === true;
  const noDiag = prod.diag?.presente === true;
  if (temCusto && noDiag)  return `<span class="fapi-tag fapi-tag--ok">base + diag</span>`;
  if (temCusto && !noDiag) return `<span class="fapi-tag fapi-tag--warn">base · fora diag</span>`;
  if (!temCusto && noDiag) return `<span class="fapi-tag fapi-tag--warn">diag · sem custo</span>`;
  return `<span class="fapi-tag fapi-tag--crit">sem base/diag</span>`;
}
function thumb(p) {
  const ini = String(p?.titulo || p?.sku || p?.mlb || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '—';
  return `<span class="fapi-thumb" title="Foto via API (futuro)">${esc(ini)}</span>`;
}
function emptyState({ icon='•', title='', why='', next='', action='' }) {
  return `<div class="fapi-empty"><div class="fapi-empty-ic">${icon}</div><b>${esc(title)}</b>
    ${why ? `<p class="fapi-empty-why"><span>Por que importa:</span> ${esc(why)}</p>` : ''}
    ${next ? `<p class="fapi-empty-next"><span>Próximo passo:</span> ${esc(next)}</p>` : ''}${action || ''}</div>`;
}

/* ── SELETORES MOCK ───────────────────────────────────────── */
const MOCK_CLIENTES = [
  { id:12, nome:'Loja Exemplo', slug:'loja-exemplo' },
  { id:27, nome:'Casa & Decoração BR', slug:'casa-decoracao-br' },
  { id:41, nome:'TechParts Oficial', slug:'techparts-oficial' },
];
const MOCK_COMPETENCIAS = [
  { competencia:'2026-05', label:'Maio/2026', inicio:'2026-05-01', fim:'2026-05-31' },
  { competencia:'2026-04', label:'Abril/2026', inicio:'2026-04-01', fim:'2026-04-30' },
];

/* ================================================================
   FIXTURE — catálogo de produtos + pedidos.
   Produto carrega base/custo, diagnóstico e Product Ads (quando houver
   por produto). Pedido carrega valores crus; resultado é DERIVADO.
   ================================================================ */
const MOCK_PRODUTOS = {
  MLB1111: { mlb:'MLB1111', sku:'SKU-001', titulo:'Cabo USB-C 2m Nylon',        full:true,  ads:{status:'real', investimento:420.00, vendasAds:6200.00, acos:6.8}, base:{temCusto:true, custo:18.00, imposto:10, status:'real'},    diag:{presente:true, mc:14.2, status:'real'} },
  MLB2222: { mlb:'MLB2222', sku:'SKU-014', titulo:'Suporte Articulado Monitor', full:true,  ads:{status:'real', investimento:880.00, vendasAds:12400.00, acos:7.1}, base:{temCusto:true, custo:95.00, imposto:10, status:'real'},   diag:{presente:true, mc:22.0, status:'real'} },
  MLB3333: { mlb:'MLB3333', sku:'SKU-022', titulo:'Luminária LED Mesa',         full:false, ads:{status:'ausente'},                                                  base:{temCusto:false, custo:null, imposto:null, status:'ausente'}, diag:{presente:false, mc:null, status:'ausente'} },
  MLB4444: { mlb:'MLB4444', sku:'SKU-037', titulo:'Organizador Gavetas Kit',    full:true,  ads:{status:'nao'},                                                      base:{temCusto:true, custo:52.00, imposto:10, status:'real'},   diag:{presente:true, mc:9.0, status:'real'} },
  MLB5555: { mlb:'MLB5555', sku:'SKU-048', titulo:'Fone Bluetooth Esportivo',   full:false, ads:{status:'real', investimento:610.00, vendasAds:8900.00, acos:6.9}, base:{temCusto:true, custo:70.00, imposto:10, status:'real'},   diag:{presente:true, mc:18.0, status:'real'} },
  MLB6666: { mlb:'MLB6666', sku:null,      titulo:'Capa Protetora Universal',   full:null,  ads:{status:'parcial', investimento:null, vendasAds:null, acos:null},     base:{temCusto:false, custo:null, imposto:null, status:'ausente'}, diag:{presente:false, mc:null, status:'ausente'} },
  MLB7777: { mlb:'MLB7777', sku:'SKU-061', titulo:'Garrafa Térmica Inox 1L',    full:true,  ads:{status:'ausente'},                                                  base:{temCusto:false, custo:null, imposto:null, status:'ausente'}, diag:{presente:true, mc:null, status:'parcial'} },
  MLB8888: { mlb:'MLB8888', sku:'SKU-070', titulo:'Mouse Gamer RGB',            full:false, ads:{status:'real', investimento:300.00, vendasAds:5400.00, acos:5.6}, base:{temCusto:true, custo:60.00, imposto:10, status:'real'},   diag:{presente:true, mc:16.5, status:'real'} },
};

// pedidos: data, mlb(ref|null), unidades, valor, frete, freteStatus, taxas, taxasStatus, status, logistica
const MOCK_PEDIDOS = [
  { id:'2000000001', data:'2026-05-02', mlb:'MLB1111', unidades:3, valor:312.90, frete:24.90, freteStatus:'real',    taxas:41.80,  taxasStatus:'real',    status:'pago',         logistica:'full' },
  { id:'2000000002', data:'2026-05-02', mlb:'MLB2222', unidades:2, valor:489.50, frete:32.40, freteStatus:'real',    taxas:65.20,  taxasStatus:'real',    status:'pago',         logistica:'full' },
  { id:'2000000003', data:'2026-05-03', mlb:'MLB3333', unidades:1, valor:220.00, frete:null,  freteStatus:'ausente', taxas:28.00,  taxasStatus:'real',    status:'pago',         logistica:'normal' },
  { id:'2000000004', data:'2026-05-05', mlb:'MLB5555', unidades:2, valor:360.00, frete:26.70, freteStatus:'real',    taxas:47.00,  taxasStatus:'real',    status:'pago',         logistica:'normal' },
  { id:'2000000005', data:'2026-05-06', mlb:'MLB7777', unidades:4, valor:1180.00,frete:41.00, freteStatus:'real',    taxas:150.00, taxasStatus:'real',    status:'pago',         logistica:'full' },
  { id:'2000000006', data:'2026-05-07', mlb:'MLB4444', unidades:1, valor:159.00, frete:null,  freteStatus:'ausente', taxas:21.10,  taxasStatus:'real',    status:'pago',         logistica:'full' },
  { id:'2000000007', data:'2026-05-08', mlb:'MLB1111', unidades:5, valor:521.50, frete:30.00, freteStatus:'real',    taxas:70.00,  taxasStatus:'real',    status:'pago',         logistica:'full' },
  { id:'2000000008', data:'2026-05-09', mlb:'MLB2222', unidades:1, valor:268.00, frete:26.70, freteStatus:'real',    taxas:35.70,  taxasStatus:'real',    status:'pago',         logistica:'full' },
  { id:'2000000009', data:'2026-05-10', mlb:'MLB6666', unidades:6, valor:540.00, frete:38.00, freteStatus:'real',    taxas:70.00,  taxasStatus:'real',    status:'pago',         logistica:'full' },
  { id:'2000000010', data:'2026-05-11', mlb:'MLB8888', unidades:2, valor:370.00, frete:28.00, freteStatus:'real',    taxas:49.00,  taxasStatus:'real',    status:'pago',         logistica:'normal' },
  { id:'2000000011', data:'2026-05-12', mlb:'MLB3333', unidades:2, valor:440.00, frete:30.00, freteStatus:'real',    taxas:56.00,  taxasStatus:'real',    status:'cancelado',    logistica:'normal' },
  { id:'2000000012', data:'2026-05-13', mlb:'MLB5555', unidades:1, valor:180.00, frete:18.50, freteStatus:'real',    taxas:24.00,  taxasStatus:'real',    status:'pago',         logistica:'normal' },
  { id:'2000000013', data:'2026-05-15', mlb:null,      unidades:1, valor:318.40, frete:19.90, freteStatus:'real',    taxas:44.30,  taxasStatus:'real',    status:'pago',         logistica:'normal' },
  { id:'2000000014', data:'2026-05-16', mlb:'MLB2222', unidades:3, valor:735.00, frete:45.00, freteStatus:'real',    taxas:98.00,  taxasStatus:'real',    status:'pago',         logistica:'full' },
  { id:'2000000015', data:'2026-05-17', mlb:'MLB7777', unidades:2, valor:590.00, frete:22.00, freteStatus:'real',    taxas:76.00,  taxasStatus:'real',    status:'com_problema', logistica:'full' },
  { id:'2000000016', data:'2026-05-18', mlb:'MLB1111', unidades:4, valor:417.20, frete:28.00, freteStatus:'real',    taxas:55.00,  taxasStatus:'real',    status:'pago',         logistica:'full' },
  { id:'2000000017', data:'2026-05-20', mlb:'MLB4444', unidades:2, valor:318.00, frete:null,  freteStatus:'ausente', taxas:42.00,  taxasStatus:'real',    status:'pago',         logistica:'full' },
  { id:'2000000018', data:'2026-05-22', mlb:'MLB8888', unidades:3, valor:555.00, frete:33.00, freteStatus:'real',    taxas:73.00,  taxasStatus:'real',    status:'pago',         logistica:'normal' },
  { id:'2000000019', data:'2026-05-23', mlb:'MLB5555', unidades:2, valor:360.00, frete:26.00, freteStatus:'real',    taxas:null,   taxasStatus:'ausente', status:'pago',         logistica:'normal' },
  { id:'2000000020', data:'2026-05-24', mlb:'MLB2222', unidades:1, valor:268.00, frete:26.70, freteStatus:'real',    taxas:35.70,  taxasStatus:'real',    status:'pago',         logistica:'full' },
  { id:'2000000021', data:'2026-05-26', mlb:'MLB6666', unidades:3, valor:270.00, frete:20.00, freteStatus:'estimado',taxas:35.00,  taxasStatus:'real',    status:'pago',         logistica:'full' },
  { id:'2000000022', data:'2026-05-28', mlb:'MLB1111', unidades:2, valor:208.60, frete:16.00, freteStatus:'real',    taxas:27.00,  taxasStatus:'real',    status:'pago',         logistica:'full' },
];

/* Contrato consumível pela tela (mantém compatibilidade com a doc). */
const mockFechamentoApiPayload = {
  ok: true,
  fonte: 'mock_conciliacao_fechamento_api',
  cliente: { id:12, nome:'Loja Exemplo', slug:'loja-exemplo' },
  periodo: { competencia:'2026-05', inicio:'2026-05-01', fim:'2026-05-31', label:'Maio/2026' },
  motor: { status:'mock', etapaAtual:'cruzar_base_custo', progresso:62, confianca:'parcial', podeConcluir:false,
           motivoBloqueio:'Receita sem produto conciliado e itens sem custo/base impedem resultado confiável.',
           geradoEm:new Date().toISOString(), origemPrincipal:'planilha_vendas' },
  adsPorProdutoDisponivel: true,   // há Product Ads por produto p/ parte do catálogo
  adsMensal: { investimento: 2210.00, status: 'real' },
  produtos: MOCK_PRODUTOS,
  pedidos: MOCK_PEDIDOS,
};

/* ────────────────────────────────────────────────────────────────
   CONTRATO FUTURO (não implementar agora) — Curva ABC e Full real.
   Nesta V1 NÃO há Curva ABC real, NÃO há Full API real, e não se inventa
   estoque parado / retirada Full / quantidade parada. Quando o backend/Drive
   existir, deve preencher estes campos; sem dado, mostrar "sem dado" ou ocultar.

   abc: {
     fonte,
     produtos: [{
       mlb, sku, titulo, unidades, faturamento,
       percentualFaturamento, acumuladoFaturamento,
       percentualUnidades, acumuladoUnidades,
       curvaFaturamento, curvaUnidades, curvaFinal
     }]
   }
   full: {
     fonte, pedidosFull, produtosFull, estoqueFull, retiradaFull
   }
   ──────────────────────────────────────────────────────────────── */

/* ── ESTADO ───────────────────────────────────────────────── */
/* Modos de período expostos na UI: mes | intervalo (Data personalizada) |
   ultimos7 | semana.  O modo 'dia' é LEGADO: não aparece no seletor, mas a
   régua de dias ainda pode aplicar um intervalo de 1 dia (de == ate). */
function defaultFilters() { return { modo:'mes', dia:null, semana:null, de:null, ate:null, logistica:'todos', midia:'todos', diagbase:'todos', status:'todos' }; }
function cloneFilters(filters) { return { ...defaultFilters(), ...(filters || {}) }; }
const F = {
  clientes: [], cliente: null,
  periodo: null,          // { mode, dateFrom, dateTo } — período de análise (substitui competência)
  rawPayload: null, viewPayload: null, visiblePayload: null,
  filters: defaultFilters(),
  draftFilters: defaultFilters(),
  selectedOrderId: null,
  // ── seção "Produtos por impacto" ──
  productSort: 'faturamento', productGroup: 'todos', productPage: 1, productPageSize: 50,
  intervaloAviso: null,   // aviso discreto quando a data inicial > final foi corrigida
  arquivoImport: null,    // File guardado no change do input — imune a repaint do carregarTela
  // ── recortes rápidos / ordenação da tabela de pedidos (tudo local) ──
  quickFilter: 'todos',   // chip de recorte rápido aplicado sobre F.viewPayload
  orderSort: 'data_desc', // ordenação local da tabela de pedidos
  fechQuick: 'todos',     // recorte do bloco Fechamento (todos/sem_custo/sem_frete/bloqueados/calculavel)
  fechDailySort: 'data',  // ordenação do bloco "Vendas por dia"
  // ── performance: fetch só em troca de cliente/comp; filtros/busca em memória ──
  page: 1, pageSize: 100, // tabela paginada (100 pedidos/página)
  searchTerm: '',         // busca local por pedido/MLB/SKU/título/status/logística
  searchTimer: null,      // debounce da busca
  loadSeq: 0,             // guard de concorrência: ignora resposta de fetch antigo
  loadAbort: null,        // AbortController do fetch em voo
};

/* ── DERIVAÇÕES DE PEDIDO (motor por pedido) ──────────────── */
function getOrderDate(o) { const d = new Date(String(o.data) + 'T00:00:00'); return isNaN(d.getTime()) ? null : d; }
function getWeekOfMonth(o) { const d = getOrderDate(o); return d ? Math.ceil(d.getDate() / 7) : null; }
function isOrderFull(o) { return o.logistica === 'full'; }
function getProduto(payload, mlb) { return mlb ? (payload.produtos || {})[mlb] || null : null; }
function hasProductAds(prod) { const s = prod?.ads?.status; return s === 'real' || s === 'parcial'; }
function isDateInPeriod(iso, period) {
  return !!iso && iso >= period.inicio && iso <= period.fim;
}
function clampDateToPeriod(iso, period) {
  if (!iso) return null;
  if (iso < period.inicio) return period.inicio;
  if (iso > period.fim) return period.fim;
  return iso;
}
function getCompetenceDays(period) {
  const days = [];
  const cur = new Date(period.inicio + 'T00:00:00');
  const end = new Date(period.fim + 'T00:00:00');
  while (!isNaN(cur.getTime()) && cur <= end) {
    days.push(isoDate(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}
function getWeekRanges(period) {
  const days = getCompetenceDays(period);
  const max = days.length ? Math.ceil(Number(days[days.length - 1].slice(8, 10)) / 7) : 5;
  return Array.from({ length:max }, (_, idx) => {
    const semana = idx + 1;
    const fromDay = (semana - 1) * 7 + 1;
    const toDay = Math.min(semana * 7, Number(period.fim.slice(8, 10)));
    const ym = period.competencia;
    return {
      semana,
      de: `${ym}-${String(fromDay).padStart(2, '0')}`,
      ate: `${ym}-${String(toDay).padStart(2, '0')}`,
    };
  });
}
function getLast7Range(period) {
  const fim = new Date(period.fim + 'T00:00:00');
  const de = new Date(fim);
  de.setDate(de.getDate() - 6);
  const deIso = isoDate(de);
  return { de: deIso < period.inicio ? period.inicio : deIso, ate: period.fim };
}
function sanitizeFilters(filters, payload) {
  const f = cloneFilters(filters);
  const period = payload.periodo;

  if (!['mes', 'dia', 'semana', 'intervalo', 'ultimos7'].includes(f.modo)) f.modo = 'mes';
  if (!['todos', 'full', 'nao_full'].includes(f.logistica)) f.logistica = 'todos';
  if (!['todos', 'com_ads', 'sem_ads'].includes(f.midia)) f.midia = 'todos';
  if (!['todos', 'com_custo', 'sem_custo', 'no_diag', 'fora_diag'].includes(f.diagbase)) f.diagbase = 'todos';
  if (!['todos', 'valido', 'cancelado', 'problema', 'bloqueado'].includes(f.status)) f.status = 'todos';

  if (f.modo === 'dia') {
    f.dia = isDateInPeriod(f.dia, period) ? f.dia : null;
    f.semana = null; f.de = null; f.ate = null;
  } else if (f.modo === 'semana') {
    const weeks = getWeekRanges(period).map(w => String(w.semana));
    f.semana = weeks.includes(String(f.semana || '')) ? String(f.semana) : null;
    f.dia = null; f.de = null; f.ate = null;
  } else if (f.modo === 'intervalo') {
    f.de = clampDateToPeriod(f.de, period);
    f.ate = clampDateToPeriod(f.ate, period);
    if (f.de && f.ate && f.de > f.ate) { const t = f.de; f.de = f.ate; f.ate = t; }
    f.dia = null; f.semana = null;
  } else {
    f.dia = null; f.semana = null; f.de = null; f.ate = null;
  }
  return f;
}

/* Calcula o pedido cruzando com o produto/base. Resultado DERIVADO. */
function computeOrder(o, payload) {
  const prod = getProduto(payload, o.mlb);
  const un = o.unidades;
  const cancelled = o.status === 'cancelado';
  const noProduct = !o.mlb;
  const temCusto = prod?.base?.temCusto === true;
  const custoTotal = (temCusto && un != null) ? round2(prod.base.custo * un) : null;
  const impostoPct = temCusto ? (prod.base.imposto || 0) : null;
  const imposto = (custoTotal != null) ? round2(o.valor * (impostoPct / 100)) : null;

  const out = {
    ...o,
    produto: prod ? { mlb:prod.mlb, sku:prod.sku, titulo:prod.titulo } : { mlb:o.mlb, sku:null, titulo:(noProduct ? '(linha financeira sem produto)' : o.mlb) },
    prod,
    full: isOrderFull(o),
    adsStatus: prod?.ads?.status ?? 'ausente',
    custo: custoTotal, custoStatus: custoTotal == null ? 'ausente' : 'real',
    imposto,
    resultado: null, resultadoStatus: 'bloqueado', confianca: 'bloqueado',
    pendencias: [],
  };

  if (cancelled) { out.pendencias.push('cancelado/reembolso — fora do resultado'); out.status = 'cancelado'; return out; }
  if (noProduct) { out.pendencias.push('financeiro sem produto conciliado'); return out; }
  if (custoTotal == null) { out.pendencias.push('MLB sem custo na base'); return out; }

  const provis = round2(o.valor - (o.frete || 0) - (o.taxas || 0) - custoTotal - (imposto || 0));
  out.resultado = provis;
  if (o.frete == null)        { out.resultadoStatus = 'parcial';  out.confianca = 'parcial'; out.pendencias.push('frete real ausente'); }
  else if (o.taxas == null)   { out.resultadoStatus = 'parcial';  out.confianca = 'parcial'; out.pendencias.push('taxa não identificada'); }
  else if (o.freteStatus === 'estimado') { out.resultadoStatus = 'estimado'; out.confianca = 'parcial'; out.pendencias.push('frete estimado'); }
  else                        { out.resultadoStatus = 'real';     out.confianca = 'confiavel'; }
  if (o.status === 'com_problema') { out.confianca = 'parcial'; out.pendencias.push('pedido com problema'); }
  if (prod && prod.diag?.presente !== true) out.pendencias.push('produto fora do diagnóstico');
  return out;
}

/* ── FILTROS ──────────────────────────────────────────────── */
function applyFilters(payload, filters) {
  filters = sanitizeFilters(filters, payload);
  let pedidos = (payload.pedidos || []).map(o => computeOrder(o, payload));

  // período de análise (intervalo de datas — pode cruzar meses)
  pedidos = pedidos.filter(o => o.data && o.data >= payload.periodo.inicio && o.data <= payload.periodo.fim);
  if (filters.modo === 'dia' && filters.dia) pedidos = pedidos.filter(o => o.data === filters.dia);
  if (filters.modo === 'semana' && filters.semana) pedidos = pedidos.filter(o => getWeekOfMonth(o) === Number(filters.semana));
  if (filters.modo === 'intervalo' && (filters.de || filters.ate)) {
    pedidos = pedidos.filter(o => (!filters.de || o.data >= filters.de) && (!filters.ate || o.data <= filters.ate));
  }
  if (filters.modo === 'ultimos7') {
    const r = getLast7Range(payload.periodo);
    pedidos = pedidos.filter(o => o.data >= r.de && o.data <= r.ate);
  }
  // logística
  if (filters.logistica === 'full')     pedidos = pedidos.filter(o => o.full === true);
  if (filters.logistica === 'nao_full') pedidos = pedidos.filter(o => o.full !== true);
  // mídia
  if (filters.midia === 'com_ads') pedidos = pedidos.filter(o => hasProductAds(o.prod));
  if (filters.midia === 'sem_ads') pedidos = pedidos.filter(o => !hasProductAds(o.prod));
  // diagnóstico/base
  if (filters.diagbase === 'com_custo')  pedidos = pedidos.filter(o => o.prod?.base?.temCusto === true);
  if (filters.diagbase === 'sem_custo')  pedidos = pedidos.filter(o => o.prod?.base?.temCusto !== true);
  if (filters.diagbase === 'no_diag')    pedidos = pedidos.filter(o => o.prod?.diag?.presente === true);
  if (filters.diagbase === 'fora_diag')  pedidos = pedidos.filter(o => !o.prod || o.prod.diag?.presente !== true);
  // status
  if (filters.status === 'valido')    pedidos = pedidos.filter(o => o.status === 'pago');
  if (filters.status === 'cancelado') pedidos = pedidos.filter(o => o.status === 'cancelado');
  if (filters.status === 'problema')  pedidos = pedidos.filter(o => o.status === 'com_problema');
  if (filters.status === 'bloqueado') pedidos = pedidos.filter(o => o.resultadoStatus === 'bloqueado' && o.status !== 'cancelado');

  return { ...payload, pedidos };
}

/* ── BUILDERS ─────────────────────────────────────────────── */
/* ── FECHAMENTO API (helpers puros) ───────────────────────────
   Fecham o PERÍODO inteiro (payload já escopado pelo GET por range) usando
   só pedidos/itens/componentes sincronizados + base vinculada. Não chamam ML.
   null = ausente ("—") · 0 = zero real · ausência nunca vira R$ 0,00. */
function fechamentoOrders(payload) {
  return (payload?.pedidos || []).map(o => (o.prod !== undefined ? o : computeOrder(o, payload)));
}
/* Recorte do Fechamento (reaproveita o predicado dos chips de pedido). */
function fechamentoOrdersFiltered(payload, quick) {
  const orders = fechamentoOrders(payload);
  return (quick && quick !== 'todos') ? orders.filter(o => pedidoMatchesQuick(o, quick)) : orders;
}
function fechSum(arr, f) { return round2(arr.reduce((s, o) => s + (Number(f(o)) || 0), 0)); }

function buildFechamentoResumo(payload, quick = 'todos') {
  const orders = fechamentoOrdersFiltered(payload, quick);
  const validos = orders.filter(o => o.status !== 'cancelado');
  const cancelProblema = orders.filter(o => o.status === 'cancelado' || o.status === 'com_problema');
  const faturamento = fechSum(validos, o => o.valor);
  const unidades = validos.reduce((s, o) => s + (o.unidades || 0), 0);
  const comComissao = validos.filter(o => o.taxas != null);
  const comissao = comComissao.length ? fechSum(comComissao, o => o.taxas) : null;
  const comCusto = validos.filter(o => o.custo != null);
  const custoTotal = comCusto.length ? fechSum(comCusto, o => o.custo) : null;
  const comImposto = validos.filter(o => o.imposto != null);
  const impostoTotal = comImposto.length ? fechSum(comImposto, o => o.imposto) : null;
  const comFrete = validos.filter(o => o.frete != null);
  const freteTotal = comFrete.length ? fechSum(comFrete, o => o.frete) : null; // null = ausente (sem Shipping API)
  const comResultado = validos.filter(o => o.resultado != null);
  const resultadoParcial = comResultado.length ? fechSum(comResultado, o => o.resultado) : null;
  const receitaBloqueada = fechSum(validos.filter(o => o.resultadoStatus === 'bloqueado'), o => o.valor);
  const ticket = validos.length ? round2(faturamento / validos.length) : null;

  // Confiável só quando TODO pedido válido tem resultado real (custo + tarifa +
  // frete real). Qualquer ausência (inclusive frete) mantém o fechamento parcial.
  let confianca;
  if (!validos.length || !comResultado.length) confianca = 'insuficiente';
  else if (validos.every(o => o.resultadoStatus === 'real')) confianca = 'confiavel';
  else confianca = 'parcial';

  return {
    periodo: payload.periodo, cliente: payload.cliente,
    fonte: payload.motor?.origemPrincipal || payload.fonte || 'central_vendas_db',
    totalPedidos: orders.length, validos: validos.length, cancelProblema: cancelProblema.length,
    unidades, faturamento, ticket, comissao, custoTotal, impostoTotal, freteTotal,
    resultadoParcial, receitaBloqueada, confianca,
  };
}

function buildFechamentoComponentes(payload, quick = 'todos') {
  const r = buildFechamentoResumo(payload, quick);
  const orders = fechamentoOrdersFiltered(payload, quick);
  const validos = orders.filter(o => o.status !== 'cancelado');
  const semCusto = validos.filter(o => o.mlb && o.custoStatus === 'ausente').length;
  const semFrete = validos.filter(o => o.frete == null).length;
  return [
    { comp:'Receita de produtos', op:'+', valor: r.faturamento,
      status: r.faturamento > 0 ? 'real' : 'ausente', fonte:'orders_api', obs:'soma do valor dos pedidos válidos' },
    { comp:'Tarifa marketplace', op:'−', valor: r.comissao == null ? null : -r.comissao,
      status: r.comissao == null ? 'ausente' : 'real', fonte:'orders_api', obs:'comissão (sale_fee) dos pedidos' },
    { comp:'Custo dos produtos', op:'−', valor: r.custoTotal == null ? null : -r.custoTotal,
      status: r.custoTotal == null ? 'ausente' : (semCusto > 0 ? 'parcial' : 'real'), fonte:'base vinculada',
      obs: semCusto > 0 ? `${num(semCusto)} pedido(s) sem custo na base` : 'custo unitário × unidades' },
    { comp:'Imposto interno', op:'−', valor: r.impostoTotal == null ? null : -r.impostoTotal,
      status: r.impostoTotal == null ? 'ausente' : (semCusto > 0 ? 'parcial' : 'real'), fonte:'cálculo interno',
      obs:'imposto % da base × receita' },
    { comp:'Frete seller', op:'−', valor: r.freteTotal == null ? null : -r.freteTotal,
      status: r.freteTotal == null ? 'ausente' : (semFrete > 0 ? 'parcial' : 'real'),
      fonte: r.freteTotal == null ? 'pendente' : 'shipments_api',
      obs: r.freteTotal == null
        ? 'nenhum envio retornou custo (shipments API)'
        : (semFrete > 0 ? `${num(semFrete)} pedido(s) sem frete real` : 'custo do envio (base_cost)') },
    { comp:'Resultado parcial', op:'=', valor: r.resultadoParcial,
      status: r.resultadoParcial == null ? 'ausente' : (r.confianca === 'confiavel' ? 'real' : 'parcial'), fonte:'cálculo interno',
      obs: r.confianca === 'confiavel' ? 'todos os componentes reais' : (semFrete > 0 || r.freteTotal == null ? 'parcial — frete incompleto' : 'parcial — falta custo em parte') },
  ];
}

function buildFechamentoQualidade(payload, quick = 'todos') {
  const orders = fechamentoOrdersFiltered(payload, quick);
  const validos = orders.filter(o => o.status !== 'cancelado');
  const faturamento = fechSum(validos, o => o.valor);
  const fatComCusto = fechSum(validos.filter(o => o.custo != null), o => o.valor);
  const fatComFrete = fechSum(validos.filter(o => o.frete != null), o => o.valor);
  const fatBloqueado = fechSum(validos.filter(o => o.resultadoStatus === 'bloqueado'), o => o.valor);
  return {
    semCusto: validos.filter(o => o.mlb && o.custoStatus === 'ausente').length,
    semFrete: validos.filter(o => o.frete == null).length,
    cancelProblema: orders.filter(o => o.status === 'cancelado' || o.status === 'com_problema').length,
    comResultado: validos.filter(o => o.resultado != null).length,
    bloqueados: validos.filter(o => o.resultadoStatus === 'bloqueado').length,
    pctFatComCusto: faturamento > 0 ? round2(fatComCusto / faturamento * 100) : null,
    pctFatComFrete: faturamento > 0 ? round2(fatComFrete / faturamento * 100) : null,
    pctFatBloqueado: faturamento > 0 ? round2(fatBloqueado / faturamento * 100) : null,
  };
}

function buildFechamentoPorDia(payload, quick = 'todos') {
  const orders = fechamentoOrdersFiltered(payload, quick);
  const map = new Map();
  for (const o of orders) {
    if (!o.data) continue;
    if (!map.has(o.data)) map.set(o.data, { data:o.data, pedidos:0, faturamento:0, comissao:0, custo:0, imposto:0, receitaBloqueada:0, cancelProblema:0, semFrete:0, semCusto:0, _comissao:false, _custo:false, _imposto:false });
    const d = map.get(o.data);
    const valido = o.status !== 'cancelado';
    d.pedidos += 1;
    if (valido) {
      d.faturamento += (o.valor || 0);
      if (o.taxas != null) { d.comissao += o.taxas; d._comissao = true; }
      if (o.custo != null) { d.custo += o.custo; d._custo = true; }
      if (o.imposto != null) { d.imposto += o.imposto; d._imposto = true; }
      if (o.frete == null) d.semFrete += 1;
      if (o.mlb && o.custoStatus === 'ausente') d.semCusto += 1;
    }
    if (o.resultadoStatus === 'bloqueado' && valido) d.receitaBloqueada += (o.valor || 0);
    if (o.status === 'cancelado' || o.status === 'com_problema') d.cancelProblema += 1;
  }
  return [...map.values()].map(d => ({
    data: d.data, pedidos: d.pedidos,
    faturamento: round2(d.faturamento),
    comissao: d._comissao ? round2(d.comissao) : null,
    custo: d._custo ? round2(d.custo) : null,
    imposto: d._imposto ? round2(d.imposto) : null,
    receitaBloqueada: round2(d.receitaBloqueada),
    cancelProblema: d.cancelProblema,
    semFrete: d.semFrete, semCusto: d.semCusto,
  }));
}

const FECH_DAILY_SORTS = [
  ['data', 'Data'], ['faturamento', 'Maior faturamento'], ['pedidos', 'Mais pedidos'],
  ['cancelProblema', 'Mais cancelados/problema'], ['receitaBloqueada', 'Maior receita bloqueada'],
  ['semFrete', 'Mais sem frete'], ['semCusto', 'Mais sem custo'],
];
function sortDias(dias, key) {
  const a = dias.slice();
  if (key === 'data') a.sort((x, y) => x.data.localeCompare(y.data));
  else a.sort((x, y) => (y[key] || 0) - (x[key] || 0) || x.data.localeCompare(y.data));
  return a;
}

function aggByProduct(pedidos) {
  const map = new Map();
  for (const o of pedidos) {
    const key = o.mlb || '__SEM_PRODUTO__';
    if (!map.has(key)) map.set(key, {
      mlb: o.mlb, prod: o.prod, titulo: o.produto.titulo, sku: o.produto.sku,
      unidades: 0, pedidos: 0, faturamento: 0, receitaBloqueada: 0, freteAcum: 0, taxasAcum: 0,
      cancelProblema: 0, full: o.full, fullPedidos: 0, normalPedidos: 0, semProduto: !o.mlb,
    });
    const a = map.get(key);
    const valido = o.status !== 'cancelado';
    a.pedidos += 1;
    if (valido) { a.unidades += (o.unidades || 0); a.faturamento += (o.valor || 0); a.taxasAcum += (o.taxas || 0); }
    if (o.resultadoStatus === 'bloqueado' && valido) a.receitaBloqueada += (o.valor || 0);
    a.freteAcum += (o.frete || 0);
    if (o.status === 'cancelado' || o.status === 'com_problema') a.cancelProblema += 1;
    if (o.full === true) { a.full = true; a.fullPedidos += 1; } else { a.normalPedidos += 1; }
  }
  for (const a of map.values()) { a.faturamento = round2(a.faturamento); a.receitaBloqueada = round2(a.receitaBloqueada); a.freteAcum = round2(a.freteAcum); a.taxasAcum = round2(a.taxasAcum); }
  return [...map.values()];
}

/* Logística do produto: full / normal / misto (ambos) / null (—). */
function productLogisticaTipo(a) {
  const f = a.fullPedidos > 0, n = a.normalPedidos > 0;
  return f && n ? 'misto' : f ? 'full' : n ? 'normal' : null;
}

/* Enriquece a agregação com derivados de leitura e aplica grupo + ordenação.
   Tudo derivado dos pedidos do período/filtro — sem inventar custo/frete. */
function buildProductImpactRows(view, { group = 'todos', sortBy = 'faturamento' } = {}) {
  const all = aggByProduct(view.pedidos).map(a => {
    const temCusto = !a.semProduto && a.prod?.base?.temCusto === true;
    return {
      ...a,
      temCusto,
      custoUnit: temCusto ? a.prod.base.custo : null,
      comissao: a.taxasAcum,
      ticketMedio: a.pedidos > 0 ? round2(a.faturamento / a.pedidos) : null,
      logisticaTipo: productLogisticaTipo(a),
    };
  });
  const totalFat = all.reduce((s, a) => s + a.faturamento, 0) || 0;
  all.forEach(a => { a.pctFat = totalFat > 0 ? round2(a.faturamento / totalFat * 100) : null; });

  // Curva ABC: ordena por faturamento desc, acumula % e classifica.
  // A: acumulado até 80% · B: 80%–95% · C: o restante. (item que cruza fica na faixa anterior)
  const byFat = all.slice().sort((x, y) => y.faturamento - x.faturamento);
  let acc = 0;
  for (const a of byFat) {
    const prev = acc;
    acc = round2(acc + (a.pctFat || 0));
    a.acumPctFat = acc;
    a.curva = (a.faturamento <= 0) ? null : (prev < 80 ? 'A' : prev < 95 ? 'B' : 'C');
  }

  let rows = all;
  if (group === 'sem_custo')            rows = rows.filter(a => !a.semProduto && !a.temCusto);
  else if (group === 'receita_bloqueada') rows = rows.filter(a => (a.receitaBloqueada || 0) > 0);
  else if (group === 'full')            rows = rows.filter(a => a.logisticaTipo === 'full' || a.logisticaTipo === 'misto');
  else if (group === 'normal')          rows = rows.filter(a => a.logisticaTipo === 'normal' || a.logisticaTipo === 'misto');
  else if (group === 'misto')           rows = rows.filter(a => a.logisticaTipo === 'misto');
  else if (group === 'curva_a')         rows = rows.filter(a => a.curva === 'A');
  else if (group === 'curva_b')         rows = rows.filter(a => a.curva === 'B');
  else if (group === 'curva_c')         rows = rows.filter(a => a.curva === 'C');
  // 'todos' não filtra

  const sortKey = group === 'receita_bloqueada' ? 'receitaBloqueada' : sortBy;
  rows = rows.slice().sort((x, y) => (y[sortKey] || 0) - (x[sortKey] || 0));
  return { rows, allRows: all, totalFat };
}
function buildDailySales(view) {
  const map = new Map();
  for (const o of view.pedidos) {
    if (!map.has(o.data)) map.set(o.data, { data:o.data, faturamento:0, pedidos:0, unidades:0, cancelProblema:0, produtosSet:new Set(), receitaBloqueada:0, _topMap:new Map() });
    const d = map.get(o.data);
    const valido = o.status !== 'cancelado';
    d.pedidos += 1;
    if (valido) { d.faturamento += (o.valor || 0); d.unidades += (o.unidades || 0); if (o.mlb) d.produtosSet.add(o.mlb); }
    if (o.status === 'cancelado' || o.status === 'com_problema') d.cancelProblema += 1;
    if (o.resultadoStatus === 'bloqueado' && valido) d.receitaBloqueada += (o.valor || 0);
    if (valido && o.mlb) d._topMap.set(o.mlb, (d._topMap.get(o.mlb) || 0) + (o.valor || 0));
  }
  const arr = [...map.values()].map(d => {
    let top = null; let topV = -1;
    for (const [mlb, v] of d._topMap) if (v > topV) { topV = v; top = mlb; }
    const prod = top ? MOCK_PRODUTOS[top] : null;
    return { data:d.data, faturamento:round2(d.faturamento), pedidos:d.pedidos, unidades:d.unidades,
             cancelProblema:d.cancelProblema, produtos:d.produtosSet.size, receitaBloqueada:round2(d.receitaBloqueada),
             topProduto: prod ? { titulo:prod.titulo, faturamento:round2(topV) } : null };
  });
  arr.sort((a, b) => a.data.localeCompare(b.data));
  return arr;
}

function buildDailyRulerRows() {
  if (!F.rawPayload) return [];
  const secondaryFilters = {
    ...F.filters,
    modo: 'mes',
    dia: null,
    semana: null,
    de: null,
    ate: null,
  };
  const monthView = applyFilters(F.rawPayload, secondaryFilters);
  const byDay = new Map(buildDailySales(monthView).map(d => [d.data, d]));
  return getCompetenceDays(F.rawPayload.periodo).map(data => byDay.get(data) || {
    data,
    faturamento: 0,
    pedidos: 0,
    unidades: 0,
    cancelProblema: 0,
    produtos: 0,
    receitaBloqueada: 0,
    topProduto: null,
  });
}
function dayScopeClass(data) {
  const fl = F.filters;
  if (fl.modo === 'dia') return fl.dia === data ? ' fapi-day--sel' : '';
  if (fl.modo === 'semana' && fl.semana) return getWeekOfMonth({ data }) === Number(fl.semana) ? ' fapi-day--scope' : '';
  if (fl.modo === 'intervalo' && (fl.de || fl.ate)) return (!fl.de || data >= fl.de) && (!fl.ate || data <= fl.ate) ? ' fapi-day--scope' : '';
  if (fl.modo === 'ultimos7') {
    const r = getLast7Range(F.rawPayload.periodo);
    return data >= r.de && data <= r.ate ? ' fapi-day--scope' : '';
  }
  return '';
}

/* ── CARREGAMENTO ─────────────────────────────────────────── */
async function carregarPayload(slug, dateFrom, dateTo, signal) {
  if (!slug) return null;
  try {
    const res = await fetch(
      `${API_BASE}/operacao/central-vendas/${encodeURIComponent(slug)}?dateFrom=${encodeURIComponent(dateFrom)}&dateTo=${encodeURIComponent(dateTo)}`,
      { headers: { Authorization: "Bearer " + TOKEN }, signal }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data || data.ok !== true) throw new Error("payload_invalido");
    // Período sem pedidos é resposta VÁLIDA (mostra estado vazio honesto, não mock).
    return data;
  } catch (err) {
    if (err?.name === 'AbortError') return null; // cancelado por troca de cliente/período
    // fallback para mock só quando o backend está inacessível — motor fica "● Mock"
    const cli = F.clientes.find(c => c.slug === slug) || mockFechamentoApiPayload.cliente;
    const comp = MOCK_COMPETENCIAS[0];
    const p = JSON.parse(JSON.stringify(mockFechamentoApiPayload));
    p.cliente = { id:cli.id, nome:cli.nome, slug:cli.slug };
    p.periodo = { competencia:comp.competencia, inicio:comp.inicio, fim:comp.fim, label:comp.label };
    return p;
  }
}

/* ── INIT ─────────────────────────────────────────────────── */
async function initFechamentosApi() {
  // Troca textos visíveis para "Central de Vendas"
  document.title = document.title.replace('Fechamentos API', 'Central de Vendas');
  const titleEl = document.querySelector('.fapi-title');
  if (titleEl && titleEl.textContent.trim() === 'Fechamentos API') titleEl.textContent = 'Central de Vendas';
  const ariaEl = document.getElementById('fapi-main');
  if (ariaEl) ariaEl.setAttribute('aria-label', 'Central de Vendas');

  // Busca lista real de clientes — mesmo endpoint e lógica do cliente-360.js.
  // Fallback para /clientes (admin-only) se o endpoint operacional não existir.
  try {
    let data = await fetch(`${API_BASE}/operacao/cliente-360/clientes`,
      { headers: { Authorization: 'Bearer ' + TOKEN } }).then(r => r.ok ? r.json() : null);
    if (!data?.ok) {
      const r2 = await fetch(`${API_BASE}/clientes`, { headers: { Authorization: 'Bearer ' + TOKEN } });
      data = r2.ok ? await r2.json() : null;
    }
    const lista = Array.isArray(data?.clientes) ? data.clientes
                : Array.isArray(data)            ? data
                : [];
    F.clientes = lista
      .filter(c => c?.ativo !== false)
      .sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));
  } catch (_) {
    F.clientes = [];
  }

  const sel = document.getElementById('fapi-client-select');
  if (sel) {
    sel.innerHTML = '<option value="">Selecione o cliente…</option>' +
      F.clientes.map(c => `<option value="${esc(c.slug)}">${esc(c.nome)}</option>`).join('');
    // Trocar cliente reseta filtros e seleção.
    sel.addEventListener('change', () => { F.cliente = F.clientes.find(c => c.slug === sel.value) || null; F.selectedOrderId = null; resetFilters(); carregarTela(); });
  }
  // Período de análise (substitui competência fixa). Default: mês atual.
  const periodSel = document.getElementById('fapi-period-select');
  if (periodSel) {
    periodSel.innerHTML = PERIOD_OPTS.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
    F.periodo = computePeriodo('mes_atual');
    periodSel.value = 'mes_atual';
    periodSel.addEventListener('change', onPeriodChange);
  }
  document.getElementById('fapi-period-apply')?.addEventListener('click', aplicarPeriodoCustom);

  const controls = document.querySelector('.fapi-controls');
  if (controls) montarBlocoImportacao(controls);
  carregarTela();
}

/* Troca de período de análise. "Personalizado" só mostra os inputs; aplica no
   botão "Aplicar". Os demais modos carregam dados uma vez. */
function onPeriodChange() {
  const periodSel = document.getElementById('fapi-period-select');
  const custom = document.getElementById('fapi-period-custom');
  const mode = periodSel?.value || 'mes_atual';
  if (mode === 'personalizado') {
    if (custom) custom.hidden = false;
    const from = document.getElementById('fapi-period-from');
    const to = document.getElementById('fapi-period-to');
    if (from && !from.value) from.value = F.periodo?.dateFrom || '';
    if (to && !to.value) to.value = F.periodo?.dateTo || '';
    return; // espera "Aplicar"
  }
  if (custom) custom.hidden = true;
  F.periodo = computePeriodo(mode);
  F.selectedOrderId = null;
  resetFilters();
  carregarTela();
}
function aplicarPeriodoCustom() {
  const from = document.getElementById('fapi-period-from')?.value;
  const to = document.getElementById('fapi-period-to')?.value;
  if (!from || !to) { setImportStatus('Informe data inicial e final.', 'warn'); return; }
  F.periodo = computePeriodo('personalizado', from, to);
  F.selectedOrderId = null;
  resetFilters();
  carregarTela();
}
function resetFilters() {
  F.filters = defaultFilters();
  F.draftFilters = defaultFilters();
  F.productSort = 'faturamento';
  F.productGroup = 'todos';
  F.productPage = 1;
  F.intervaloAviso = null;
  F.searchTerm = '';
  F.page = 1;
}

/* ÚNICO ponto de fetch. Só deve ser chamado em: init, troca de cliente/
   competência, e depois de importar/sincronizar. Filtros/busca/paginação
   NÃO passam por aqui — usam renderTela()/renderResults() em memória.
   Guard de concorrência (loadSeq) + AbortController ignoram resposta antiga. */
async function carregarTela() {
  const content = document.getElementById('fapi-content');
  if (!content) return;
  if (!F.cliente) {
    F.rawPayload = null; F.viewPayload = null; F.visiblePayload = null; renderHeader(null);
    content.innerHTML = emptyState({ icon:'🎯', title:'Selecione um cliente para abrir o motor',
      why:'O fechamento por pedido é sempre por cliente e por competência.', next:'Escolha um cliente e a competência acima.' });
    return;
  }

  if (!F.periodo) F.periodo = computePeriodo('mes_atual');
  const seq = ++F.loadSeq;
  if (F.loadAbort) { try { F.loadAbort.abort(); } catch (_) {} }
  F.loadAbort = (typeof AbortController !== 'undefined') ? new AbortController() : null;

  const payload = await carregarPayload(F.cliente.slug, F.periodo.dateFrom, F.periodo.dateTo, F.loadAbort?.signal);
  if (seq !== F.loadSeq) return; // resposta de um carregamento mais antigo — ignora

  F.rawPayload = payload;
  if (!F.rawPayload?.ok) {
    renderHeader({ motor:{ status:'indisponivel' } });
    content.innerHTML = emptyState({ icon:'🔌', title:'Motor indisponível', why:'O backend do motor ainda não respondeu.', next:'Quando o endpoint existir, a tela carrega o payload real.' });
    return;
  }

  F.filters = sanitizeFilters(F.filters, F.rawPayload);
  F.draftFilters = sanitizeFilters(F.draftFilters, F.rawPayload);
  F.page = 1;
  recomputeView();
  renderTela();
}

/* Aplica filtros sobre F.rawPayload em memória — SEM fetch. Recalcula uma vez. */
function recomputeView() {
  F.viewPayload = F.rawPayload ? applyFilters(F.rawPayload, F.filters) : null;
}

/* Pedidos visíveis = filtrados + termo de busca (local). Não pagina ainda. */
/* Recortes rápidos (chips + cards de qualidade). Tudo local sobre o pedido. */
const QUICK_FILTERS = [
  ['todos', 'Todos'], ['sem_custo', 'Sem custo'], ['sem_frete', 'Sem frete'],
  ['frete_real', 'Com frete real'], ['calculavel', 'Resultado calculável'],
  ['bloqueados', 'Bloqueados'], ['receita_bloqueada', 'Receita bloqueada'],
  ['cancel_problema', 'Cancelados/problema'], ['full', 'Full'], ['normal', 'Normal'],
];
function pedidoMatchesQuick(o, q) {
  switch (q) {
    case 'sem_custo':         return !!o.mlb && o.custoStatus === 'ausente';
    case 'sem_frete':         return o.status !== 'cancelado' && o.frete == null;
    case 'frete_real':        return o.frete != null;
    case 'calculavel':        return o.resultado != null;
    case 'bloqueados':        return o.resultadoStatus === 'bloqueado' && o.status !== 'cancelado';
    case 'receita_bloqueada': return o.resultadoStatus === 'bloqueado' && o.status !== 'cancelado';
    case 'cancel_problema':   return o.status === 'cancelado' || o.status === 'com_problema';
    case 'full':              return o.full === true;
    case 'normal':            return o.full !== true;
    default:                  return true;
  }
}

/* Ordenações locais da tabela de pedidos. */
const ORDER_SORTS = [
  ['data_desc', 'Data (mais recente)'], ['data_asc', 'Data (mais antiga)'],
  ['fat_desc', 'Maior faturamento'], ['fat_asc', 'Menor faturamento'],
  ['comissao_desc', 'Maior comissão'], ['frete_desc', 'Maior frete'],
  ['custo_desc', 'Maior custo'], ['resultado_desc', 'Maior resultado'],
  ['bloqueada_desc', 'Maior receita bloqueada'], ['confianca', 'Confiança (pior 1º)'],
];
const CONF_RANK = { bloqueado: 0, insuficiente: 0, parcial: 1, estimado: 2, real: 3, confiavel: 3 };
function sortPedidos(arr, key) {
  const a = arr.slice();
  const desc = f => (x, y) => { const vx = f(x), vy = f(y); return (vy == null ? -Infinity : vy) - (vx == null ? -Infinity : vx); };
  const asc  = f => (x, y) => { const vx = f(x), vy = f(y); return (vx == null ? Infinity : vx) - (vy == null ? Infinity : vy); };
  switch (key) {
    case 'data_asc':       a.sort((x, y) => String(x.data || '').localeCompare(String(y.data || '')) || String(x.id).localeCompare(String(y.id))); break;
    case 'fat_desc':       a.sort(desc(o => o.valor)); break;
    case 'fat_asc':        a.sort(asc(o => o.valor)); break;
    case 'comissao_desc':  a.sort(desc(o => o.taxas)); break;
    case 'frete_desc':     a.sort(desc(o => o.frete)); break;
    case 'custo_desc':     a.sort(desc(o => o.custo)); break;
    case 'resultado_desc': a.sort(desc(o => o.resultado)); break;
    case 'bloqueada_desc': a.sort(desc(o => (o.resultadoStatus === 'bloqueado' && o.status !== 'cancelado') ? (o.valor || 0) : null)); break;
    case 'confianca':      a.sort((x, y) => (CONF_RANK[x.confianca] ?? 9) - (CONF_RANK[y.confianca] ?? 9)); break;
    default:               a.sort((x, y) => String(y.data || '').localeCompare(String(x.data || '')) || String(y.id).localeCompare(String(x.id))); break;
  }
  return a;
}
function pedidoRowClass(o) {
  if (o.status === 'cancelado') return ' fapi-prow--cancel';
  if (o.status === 'com_problema') return ' fapi-prow--prob';
  if (o.resultadoStatus === 'bloqueado') return ' fapi-prow--bloq';
  if (o.mlb && o.custoStatus === 'ausente') return ' fapi-prow--nocusto';
  if (o.frete == null) return ' fapi-prow--nofrete';
  return '';
}

/* Pedidos filtrados (recorte rápido + busca). Ordenação/paginação ficam na tabela. */
function getVisiblePedidos() {
  let pedidos = F.viewPayload?.pedidos || [];
  if (F.quickFilter && F.quickFilter !== 'todos') pedidos = pedidos.filter(o => pedidoMatchesQuick(o, F.quickFilter));
  const term = String(F.searchTerm || '').trim().toLowerCase();
  if (term) {
    pedidos = pedidos.filter(o =>
      String(o.id || '').toLowerCase().includes(term) ||
      String(o.produto?.mlb || o.mlb || '').toLowerCase().includes(term) ||
      String(o.produto?.sku || o.sku || '').toLowerCase().includes(term) ||
      String(o.produto?.titulo || '').toLowerCase().includes(term) ||
      String(o.status || '').toLowerCase().includes(term) ||
      String((STATUS_PEDIDO[o.status] || [])[1] || '').toLowerCase().includes(term) ||
      (o.full === true ? 'full' : 'normal').includes(term) ||
      String(o.logistica || '').toLowerCase().includes(term)
    );
  }
  return pedidos;
}

/* Render completo SEM fetch. Blocos: Fechamento → Vendas por dia → Curva ABC →
   Pedidos (com sua toolbar de filtros) → detalhe. */
function renderTela() {
  const content = document.getElementById('fapi-content');
  if (!content || !F.rawPayload?.ok) return;
  renderHeader(F.rawPayload);
  content.innerHTML = '<div id="fapi-results"></div>';
  renderResults();
}

function renderResults() {
  const host = document.getElementById('fapi-results');
  if (!host || !F.viewPayload) return;
  F.visiblePayload = { ...F.viewPayload, pedidos: getVisiblePedidos() };
  host.innerHTML =
    renderFechamento() +
    renderDailySales() +
    renderTopProducts() +
    renderPedidos() +
    '<div id="fapi-pedido-detalhe"></div>';
  wireResults();
}

/* Re-render só da tabela de pedidos (busca/recorte/ordenação/página) — preserva
   o foco do campo de busca, que fica na toolbar (fora de #fapi-ped-table). */
function renderPedTable() {
  const host = document.getElementById('fapi-ped-table');
  if (!host) return;
  host.innerHTML = renderPedTableInner();
  wirePedTable();
}

/* ── 2. FECHAMENTO API ────────────────────────────────────────
   Fecha o PERÍODO inteiro. Tem recorte próprio (F.fechQuick) que filtra só
   este bloco (KPIs/composição/qualidade) — não toca a tabela de pedidos. */
const FECH_QUICKS = [
  ['todos', 'Todos'], ['sem_custo', 'Sem custo'], ['sem_frete', 'Sem frete'],
  ['bloqueados', 'Bloqueados'], ['calculavel', 'Calculáveis'],
];
function renderFechamento() {
  const payload = F.rawPayload;
  if (!payload?.ok) return '';
  const rAll = buildFechamentoResumo(payload, 'todos');
  const fonteTxt = (rAll.fonte === 'orders_api') ? 'orders_api · central_vendas_db' : esc(rAll.fonte);

  if (!rAll.totalPedidos) {
    return `
    <section class="fapi-panel">
      <div class="fapi-panel-head"><h2 class="fapi-panel-title">Fechamento API</h2>
        <span class="fapi-panel-meta">${esc(payload.periodo?.label || '')} · ${esc(payload.cliente?.nome || '')}</span></div>
      <div class="fapi-panel-body">${emptyState({ icon:'🧾', title:'Sem pedidos no período', why:'Nada sincronizado para fechar neste intervalo.', next:'Use “Sincronizar via API” para trazer os pedidos do ML.' })}</div>
    </section>`;
  }

  const r = buildFechamentoResumo(payload, F.fechQuick);
  const chips = FECH_QUICKS.map(([k, l]) => `<button class="fapi-chip${F.fechQuick === k ? ' active' : ''}" data-fechq="${k}" type="button">${esc(l)}</button>`).join('');
  const recorteBar = `<div class="fapi-toolbar"><div class="fapi-chipbar">${chips}</div>${F.fechQuick !== 'todos' ? `<span class="fapi-panel-meta">recorte: ${esc((FECH_QUICKS.find(x => x[0] === F.fechQuick) || [])[1] || '')} · ${num(r.totalPedidos)} pedido(s)</span>` : ''}</div>`;

  if (!r.totalPedidos) {
    return `
    <section class="fapi-panel">
      <div class="fapi-panel-head"><h2 class="fapi-panel-title">Fechamento API</h2>
        <div class="fapi-panel-actions"><span class="fapi-panel-meta">${esc(payload.periodo?.label || '')} · ${esc(payload.cliente?.nome || '')}</span></div></div>
      <div class="fapi-panel-body fapi-panel-body--flush">${recorteBar}
        <div class="fapi-panel-body">${emptyState({ icon:'•', title:'Nenhum pedido neste recorte', why:'O recorte selecionado não tem pedidos.', next:'Volte para “Todos”.' })}</div></div>
    </section>`;
  }

  const card = (lbl, val, sub, cls) => `<div class="fapi-card"><div class="fapi-card-lbl">${esc(lbl)}</div><div class="fapi-card-val${cls ? ' ' + cls : ''}">${val}</div><div class="fapi-card-sub">${sub || '&nbsp;'}</div></div>`;
  const cards = `<div class="fapi-cards">
    ${card('Total de pedidos', valOr(r.totalPedidos), 'no período')}
    ${card('Pedidos válidos', valOr(r.validos), 'pagos + problema')}
    ${card('Cancelados / problema', valOr(r.cancelProblema), 'fora da venda boa', 'crit')}
    ${card('Unidades vendidas', valOr(r.unidades), 'itens válidos')}
    ${card('Faturamento bruto', money(r.faturamento), 'pedidos válidos', 'brand')}
    ${card('Ticket médio', valOr(r.ticket, money), 'por pedido válido')}
    ${card('Comissão marketplace', valOr(r.comissao, money), 'tarifa ML (sale_fee)')}
    ${card('Custo dos produtos', valOr(r.custoTotal, money), 'base vinculada')}
    ${card('Imposto interno', valOr(r.impostoTotal, money), 'cálculo interno')}
    ${card('Frete seller', valOr(r.freteTotal, money), r.freteTotal == null ? 'ausente (shipments)' : 'real (shipments API)', r.freteTotal == null ? 'muted' : '')}
    ${card('Resultado parcial', valOr(r.resultadoParcial, money), r.confianca === 'confiavel' ? 'todos componentes reais' : 'parcial', r.confianca === 'confiavel' ? '' : 'warn')}
    ${card('Receita bloqueada', money(r.receitaBloqueada), 'falta custo/frete p/ calcular', 'warn')}
  </div>`;

  // Composição do resultado
  const comps = buildFechamentoComponentes(payload, F.fechQuick);
  const compRows = comps.map(c => `
    <tr${c.comp === 'Resultado parcial' ? ' class="fapi-ext-total"' : ''}>
      <td class="fapi-ext-comp${c.comp === 'Resultado parcial' ? ' strong' : ''}">${esc(c.comp)}</td>
      <td class="center fapi-ext-op">${esc(c.op)}</td>
      <td class="right fapi-ext-val">${c.valor == null ? '<span class="muted">—</span>' : (c.comp === 'Resultado parcial' ? `<span class="fapi-est">${money(c.valor)}</span>` : money(c.valor))}</td>
      <td>${statusBadge(c.status)}</td>
      <td class="fapi-ext-fonte muted">${esc(c.fonte)}</td>
      <td class="fapi-ext-obs muted clip">${esc(c.obs)}</td>
    </tr>`).join('');
  const composicao = `
    <div class="fapi-fech-sub"><b>Composição do resultado</b></div>
    <div class="fapi-tablewrap">
      <table class="fapi-table fapi-ext-table">
        <thead><tr><th>Componente</th><th class="center">Op.</th><th class="right">Valor</th><th>Status</th><th>Fonte</th><th>Observação</th></tr></thead>
        <tbody>${compRows}</tbody>
      </table>
    </div>`;

  // Qualidade do fechamento — somente leitura (recorte fica nos chips acima)
  const q = buildFechamentoQualidade(payload, F.fechQuick);
  const qItem = (lbl, val, cls) => `<div class="fapi-fech-q"><span class="fapi-fech-q-v${cls ? ' ' + cls : ''}">${val}</span><span class="fapi-fech-q-l">${esc(lbl)}</span></div>`;
  const qualidade = `
    <div class="fapi-fech-sub"><b>Qualidade do fechamento</b></div>
    <div class="fapi-fech-qgrid">
      ${qItem('pedidos sem custo', valOr(q.semCusto), q.semCusto ? 'crit' : '')}
      ${qItem('pedidos sem frete', valOr(q.semFrete), q.semFrete ? 'warn' : '')}
      ${qItem('com resultado calculável', valOr(q.comResultado))}
      ${qItem('pedidos bloqueados', valOr(q.bloqueados), q.bloqueados ? 'crit' : '')}
      ${qItem('cancelados/problema', valOr(q.cancelProblema))}
      ${qItem('% faturamento com custo', valOr(q.pctFatComCusto, pct))}
      ${qItem('% faturamento com frete real', valOr(q.pctFatComFrete, pct), (q.pctFatComFrete || 0) > 0 ? 'ok' : '')}
      ${qItem('% faturamento bloqueado', valOr(q.pctFatBloqueado, pct), (q.pctFatBloqueado || 0) > 0 ? 'warn' : '')}
    </div>`;

  return `
  <section class="fapi-panel">
    <div class="fapi-panel-head">
      <h2 class="fapi-panel-title">Fechamento API</h2>
      <div class="fapi-panel-actions">
        <span class="fapi-panel-meta">${esc(payload.periodo?.label || '')} · ${esc(payload.cliente?.nome || '')} · fonte: ${fonteTxt}</span>
        Confiança ${confPill(r.confianca)}
        <button class="fapi-btn fapi-btn-ghost fapi-btn-sm" id="fapi-fech-refresh" type="button" title="Recalcula do período já carregado — não chama a API do ML">Atualizar</button>
      </div>
    </div>
    <div class="fapi-panel-body fapi-panel-body--flush">
      ${recorteBar}
      ${cards}
      ${composicao}
      ${qualidade}
      <div class="fapi-table-note">Fechamento do <b>período inteiro</b> (independe dos filtros da tabela de pedidos). O <b>frete seller</b> vem da Shipments API por pedido quando disponível; pedidos sem frete real mantêm o fechamento <b>parcial</b>. Ausência aparece como <b>—</b>, nunca R$ 0,00.</div>
    </div>
  </section>`;
}

/* ── HEADER ───────────────────────────────────────────────── */
const MOTOR = { mock:['mock','● Mock'], parcial:['parcial','● Parcial'], api:['api','● API conectado'], indisponivel:['indisponivel','● Indisponível'], persistido:['api','● API conectado'], sem_dados:['indisponivel','● Sem dados no período'] };
function renderHeader(p) {
  const st = document.getElementById('fapi-motor-status');
  if (st) { const [cls, label] = MOTOR[p?.motor?.status] || MOTOR.mock; st.className = `fapi-motor fapi-motor--${cls}`; st.textContent = label; }
  const cf = document.getElementById('fapi-confianca');
  if (cf) { if (p?.motor?.confianca) { cf.hidden = false; cf.innerHTML = `Confiança ${confPill(p.motor.confianca)}`; } else cf.hidden = true; }
}

/* ── 3. VENDAS POR DIA (régua visual + tabela ordenável) ─────── */
function renderDailySales() {
  const dias = buildDailyRulerRows();
  if (!dias.length) return '';
  const cells = dias.map(d => {
    const scope = dayScopeClass(d.data);
    const empty = d.pedidos === 0 ? ' fapi-day--empty' : '';
    const markers = [
      d.cancelProblema > 0 ? '<span class="fapi-day-marker fapi-day-marker--problem" title="Cancelamento/problema"></span>' : '',
      d.receitaBloqueada > 0 ? '<span class="fapi-day-marker fapi-day-marker--blocked" title="Receita bloqueada"></span>' : '',
    ].join('');
    const tip = `${fmtDt(d.data)} · ${money(d.faturamento)} · ${d.pedidos} ped · ${d.unidades} un` + (d.topProduto ? ` · top: ${d.topProduto.titulo}` : '');
    return `<button class="fapi-day${scope}${empty}" data-day="${esc(d.data)}" title="${esc(tip)}">
      <span class="fapi-day-d">${esc(String(new Date(d.data + 'T00:00:00').getDate()).padStart(2, '0'))}</span>
      <span class="fapi-day-v">${esc(shortMoney(d.faturamento))}</span>
      <span class="fapi-day-p">${esc(String(d.pedidos))} ped.</span>
      <span class="fapi-day-markers">${markers}</span>
    </button>`;
  }).join('');

  // Tabela ordenável por dia (período inteiro)
  const tdias = sortDias(buildFechamentoPorDia(F.rawPayload, 'todos'), F.fechDailySort);
  const dailySortOpts = FECH_DAILY_SORTS.map(([k, l]) => `<option value="${k}"${F.fechDailySort === k ? ' selected' : ''}>${esc(l)}</option>`).join('');
  const diaRows = tdias.map(d => `
    <tr class="fapi-dayrow${dayScopeClass(d.data) ? ' fapi-dayrow--scope' : ''}" data-fechday="${esc(d.data)}" title="Filtrar pedidos de ${fmtDt(d.data)}" tabindex="0">
      <td class="nowrap">${fmtDt(d.data)}</td>
      <td class="right">${valOr(d.pedidos)}</td>
      <td class="right strong">${money(d.faturamento)}</td>
      <td class="right">${valOr(d.comissao, money)}</td>
      <td class="right">${valOr(d.custo, money)}</td>
      <td class="right">${valOr(d.imposto, money)}</td>
      <td class="right">${d.receitaBloqueada > 0 ? `<span class="fapi-est">${money(d.receitaBloqueada)}</span>` : '—'}</td>
      <td class="right">${d.semFrete > 0 ? num(d.semFrete) : '—'}</td>
      <td class="right">${d.semCusto > 0 ? num(d.semCusto) : '—'}</td>
      <td class="right">${d.cancelProblema > 0 ? num(d.cancelProblema) : '—'}</td>
    </tr>`).join('');

  return `
  <section class="fapi-panel">
    <div class="fapi-panel-head"><h2 class="fapi-panel-title">Vendas por dia</h2>
      <span class="fapi-panel-meta">clique num dia para filtrar os pedidos · amarelo = problema · vermelho = receita bloqueada</span></div>
    <div class="fapi-panel-body"><div class="fapi-days">${cells}</div></div>
    <div class="fapi-fech-sub fapi-fech-sub--row"><b>Resumo por dia</b>
      <label class="fapi-fitem fapi-toolbar-sort"><span>Ordenar por</span>
        <select class="fapi-fsel" id="fapi-daily-sort">${dailySortOpts}</select></label></div>
    <div class="fapi-panel-body fapi-panel-body--flush"><div class="fapi-tablewrap">
      <table class="fapi-table fapi-table--click">
        <thead><tr><th>Data</th><th class="right">Ped.</th><th class="right">Faturamento</th><th class="right">Comissão</th><th class="right">Custo</th><th class="right">Imposto</th><th class="right">Receita bloq.</th><th class="right">S/frete</th><th class="right">S/custo</th><th class="right">Canc/Prob</th></tr></thead>
        <tbody>${diaRows}</tbody>
      </table></div></div>
  </section>`;
}

/* ── 3. TABELA DE PEDIDOS ─────────────────────────────────── */
const STATUS_PEDIDO = { pago:['ok','Pago'], cancelado:['crit','Cancelado'], com_problema:['warn','Problema'], pendente:['warn','Pendente'] };

/* Texto da linha "Filtros ativos" (recorte + selects + busca + ordenação). */
function activeFiltersText() {
  const parts = [];
  if (F.quickFilter && F.quickFilter !== 'todos') {
    const q = QUICK_FILTERS.find(c => c[0] === F.quickFilter);
    if (q) parts.push(q[1]);
  }
  const fl = F.filters;
  if (fl.logistica === 'full') parts.push('Full'); else if (fl.logistica === 'nao_full') parts.push('não Full');
  if (fl.midia === 'com_ads') parts.push('com Ads'); else if (fl.midia === 'sem_ads') parts.push('sem Ads');
  if (fl.diagbase !== 'todos') parts.push(fl.diagbase.replace('_', ' '));
  if (fl.status !== 'todos') parts.push(fl.status);
  if (fl.modo === 'intervalo' && fl.de && fl.de === fl.ate) parts.push(`dia ${fmtDt(fl.de)}`);
  const termo = String(F.searchTerm || '').trim();
  if (termo) parts.push(`busca "${termo}"`);
  const s = ORDER_SORTS.find(x => x[0] === F.orderSort);
  return { recortes: parts, ordenacao: s ? s[1] : '' };
}

/* Bloco Pedidos: toolbar (busca + selects + chips + ordenação) colada à tabela.
   A toolbar é renderizada uma vez; a tabela vive em #fapi-ped-table e re-renderiza
   sozinha (busca/recorte/ordenação/página) preservando o foco da busca. */
function renderPedidos() {
  const fl = F.filters;
  const opt = (v, label, cur) => `<option value="${esc(v)}"${cur === v ? ' selected' : ''}>${esc(label)}</option>`;
  const selF = (key, cur, opts) => `<select class="fapi-fsel" data-pedfilter="${key}">${opts}</select>`;
  const chips = QUICK_FILTERS.map(([k, l]) =>
    `<button class="fapi-chip${F.quickFilter === k ? ' active' : ''}" data-quick="${k}" type="button">${esc(l)}</button>`).join('');
  const sortOpts = ORDER_SORTS.map(([k, l]) => `<option value="${k}"${F.orderSort === k ? ' selected' : ''}>${esc(l)}</option>`).join('');

  return `
  <section class="fapi-panel">
    <div class="fapi-panel-head"><h2 class="fapi-panel-title">Pedidos</h2>
      <span class="fapi-panel-meta">clique para abrir o extrato · todos os filtros são locais (sem nova busca no servidor)</span></div>
    <div class="fapi-panel-body fapi-panel-body--flush">
      <div class="fapi-toolbar fapi-toolbar--ped">
        <label class="fapi-fitem fapi-fitem--search"><span>Buscar</span>
          <input type="search" id="fapi-search" class="fapi-fsearch" placeholder="pedido, MLB, SKU, título, status…" value="${esc(F.searchTerm || '')}" autocomplete="off"></label>
        <label class="fapi-fitem"><span>Logística</span>${selF('logistica', fl.logistica, [opt('todos','Todos',fl.logistica), opt('full','Full',fl.logistica), opt('nao_full','Não Full',fl.logistica)].join(''))}</label>
        <label class="fapi-fitem"><span>Mídia</span>${selF('midia', fl.midia, [opt('todos','Todos',fl.midia), opt('com_ads','Com Ads',fl.midia), opt('sem_ads','Sem Ads',fl.midia)].join(''))}</label>
        <label class="fapi-fitem"><span>Diag./base</span>${selF('diagbase', fl.diagbase, [opt('todos','Todos',fl.diagbase), opt('com_custo','Com custo',fl.diagbase), opt('sem_custo','Sem custo',fl.diagbase), opt('no_diag','No diagnóstico',fl.diagbase), opt('fora_diag','Fora do diag.',fl.diagbase)].join(''))}</label>
        <label class="fapi-fitem"><span>Status</span>${selF('status', fl.status, [opt('todos','Todos',fl.status), opt('valido','Válido',fl.status), opt('cancelado','Cancelado',fl.status), opt('problema','Problema',fl.status), opt('bloqueado','Bloqueado',fl.status)].join(''))}</label>
        <label class="fapi-fitem fapi-toolbar-sort"><span>Ordenar por</span><select class="fapi-fsel" id="fapi-order-sort">${sortOpts}</select></label>
      </div>
      <div class="fapi-chipbar fapi-chipbar--ped">${chips}</div>
      <div id="fapi-ped-table">${renderPedTableInner()}</div>
    </div>
  </section>`;
}

/* Tabela + paginação + linha de filtros ativos (re-renderável isoladamente). */
function renderPedTableInner() {
  const all = getVisiblePedidos();
  const sorted = sortPedidos(all, F.orderSort);
  const total = sorted.length;

  const af = activeFiltersText();
  const ativosTxt = af.recortes.length ? af.recortes.join(' · ') : 'nenhum recorte';
  const activeLine = `<div class="fapi-active-filters">
    <span><b>Filtros ativos:</b> ${esc(ativosTxt)} · ordenado por ${esc(af.ordenacao)}</span>
    <button class="fapi-btn fapi-btn-ghost fapi-btn-sm" id="fapi-clear-local" type="button">Limpar tudo</button>
  </div>`;

  if (!total) {
    const buscando = String(F.searchTerm || '').trim();
    return `${activeLine}<div class="fapi-panel-body">${emptyState({ icon:'📦', title: buscando ? 'Nenhum pedido para a busca' : 'Nenhum pedido neste recorte', why: buscando ? `Nada encontrado para "${esc(buscando)}".` : 'O recorte/filtros atuais não retornaram pedidos.', next:'Use “Limpar tudo” ou escolha “Todos” nos chips acima.' })}</div>`;
  }

  const pageSize = F.pageSize;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (F.page > pages) F.page = pages;
  if (F.page < 1) F.page = 1;
  const start = (F.page - 1) * pageSize;
  const end = Math.min(start + pageSize, total);
  const rows = sorted.slice(start, end);
  const tr = rows.map(o => {
    const [scls, slbl] = STATUS_PEDIDO[o.status] || ['muted', o.status];
    const res = o.resultado == null ? '<span class="muted">—</span>' : `<span class="fapi-est">${money(o.resultado)}</span>`;
    return `
      <tr class="fapi-prow${pedidoRowClass(o)}${F.selectedOrderId === o.id ? ' fapi-prow--sel' : ''}" data-pedido="${esc(o.id)}" tabindex="0">
        <td class="mono">${esc(o.id)}</td>
        <td class="nowrap">${fmtDt(o.data)}</td>
        <td><span class="fapi-pill fapi-pill--${scls}">${esc(slbl)}</span></td>
        <td class="clip">${esc(o.produto?.titulo || '—')}</td>
        <td class="mono">${esc(o.produto?.mlb || '—')}</td>
        <td class="mono muted">${esc(o.produto?.sku || '—')}</td>
        <td>${tagFull(o.full)}</td>
        <td>${tagAds(o.adsStatus)}</td>
        <td class="right strong">${valOr(o.valor, money)}</td>
        <td class="right${o.frete != null ? ' fapi-cell-ok' : ' muted'}">${valOr(o.frete, money)}</td>
        <td class="right">${valOr(o.taxas, money)}</td>
        <td class="right${o.custo != null ? ' fapi-cell-ok' : ' muted'}">${valOr(o.custo, money)}</td>
        <td class="right">${res}</td>
        <td>${confPill(o.confianca)}</td>
        <td class="muted clip">${o.pendencias.length ? esc(o.pendencias[0]) : '—'}</td>
      </tr>`;
  }).join('');
  return `${activeLine}
      <div class="fapi-tablewrap">
        <table class="fapi-table fapi-table--click">
          <thead><tr><th>Pedido</th><th>Data</th><th>Status</th><th>Produto</th><th>MLB</th><th>SKU</th><th>Full</th><th>Ads</th><th class="right">Valor</th><th class="right">Frete</th><th class="right">Taxas</th><th class="right">Custo</th><th class="right">Resultado</th><th>Confiança</th><th>Pendência</th></tr></thead>
          <tbody>${tr}</tbody>
        </table>
      </div>
      <div class="fapi-pager">
        <button class="fapi-btn fapi-btn-ghost fapi-btn-sm" id="fapi-page-prev" type="button"${F.page <= 1 ? ' disabled' : ''}>← Anterior</button>
        <span class="fapi-pager-info">Mostrando ${num(start + 1)}–${num(end)} de ${num(total)} pedidos${pages > 1 ? ` · página ${num(F.page)}/${num(pages)}` : ''}</span>
        <button class="fapi-btn fapi-btn-ghost fapi-btn-sm" id="fapi-page-next" type="button"${F.page >= pages ? ' disabled' : ''}>Próxima →</button>
      </div>
      <div class="fapi-table-note">Linhas destacadas: <b>vermelho</b> cancelado/bloqueado · <b>amarelo</b> problema · <b>laranja</b> sem custo · <b>cinza</b> sem frete. Ausência é <b>—</b>, nunca R$ 0,00.</div>`;
}

/* ── 4. DETALHE DO PEDIDO ─────────────────────────────────── */
/* Lista o que falta para concluir, com o impacto de cada lacuna. */
function faltasDoPedido(o, prod) {
  const faltas = [];
  if (o.status === 'cancelado') faltas.push(['pedido cancelado/reembolso', 'não conclui resultado; impacto fora da venda boa']);
  if (!o.mlb) faltas.push(['financeiro sem produto', 'impede atribuir custo/base e calcular resultado do item']);
  if (o.custoStatus === 'ausente' && o.mlb) faltas.push(['falta custo/base', 'impede calcular resultado do item']);
  if (o.frete == null) faltas.push(['falta frete real', 'resultado fica parcial, nunca confiável']);
  if (o.taxas == null) faltas.push(['falta taxa', 'resultado fica parcial, nunca confiável']);
  if (prod && prod.diag?.presente !== true) faltas.push(['falta vínculo com diagnóstico', 'sem checagem de margem do produto']);
  return faltas;
}
function abrirPedido(id) {
  const o = (F.viewPayload?.pedidos || F.rawPayload?.pedidos || []).map(x => x.prod !== undefined ? x : computeOrder(x, F.rawPayload)).find(x => x.id === id);
  const host = document.getElementById('fapi-pedido-detalhe');
  if (!o || !host) return;
  F.selectedOrderId = id;
  document.querySelectorAll('.fapi-prow').forEach(r => r.classList.toggle('fapi-prow--sel', r.dataset.pedido === id));

  const prod = o.prod;
  const faltas = faltasDoPedido(o, prod);
  const bloqueado = o.resultado == null;
  const cancelado = o.status === 'cancelado';
  const precoUnit = (o.valor != null && o.unidades) ? round2(o.valor / o.unidades) : null;

  // Uma linha do extrato: Componente · Operação · Valor · Status · Fonte · Obs.
  const linha = (comp, op, valHtml, status, fonte, obs) => `
    <tr>
      <td class="fapi-ext-comp">${esc(comp)}</td>
      <td class="center fapi-ext-op">${esc(op || '')}</td>
      <td class="right fapi-ext-val">${valHtml}</td>
      <td>${status ? statusBadge(status) : '<span class="muted">—</span>'}</td>
      <td class="fapi-ext-fonte muted">${esc(fonte || '—')}</td>
      <td class="fapi-ext-obs muted clip">${esc(obs || '—')}</td>
    </tr>`;

  // Bloco do produto: quantidade, preço/valor, Full/Normal, Ads, base/diag.
  const prodKV = [
    ['MLB', o.produto?.mlb || '—'],
    ['SKU', o.produto?.sku || '—'],
    ['Quantidade', valOr(o.unidades, num)],
    ['Preço unit.', valOr(precoUnit, money)],
    ['Valor do pedido', valOr(o.valor, money)],
  ].map(([k, v]) => `<div class="fapi-det-row"><span class="fapi-det-k">${esc(k)}</span><span class="fapi-det-v">${esc(v)}</span></div>`).join('');

  host.innerHTML = `
    <section class="fapi-panel fapi-detail">
      <div class="fapi-panel-head"><h2 class="fapi-panel-title">Extrato financeiro do pedido</h2>
        <div class="fapi-panel-actions">${confPill(o.confianca)}
          <button class="fapi-btn fapi-btn-ghost fapi-btn-sm" onclick="fecharPedido()">Fechar ✕</button></div></div>
      <div class="fapi-panel-body">
        <p class="fapi-det-lede">Valores derivados do pedido e dos cruzamentos disponíveis. Ausência nunca vira zero.</p>

        <div class="fapi-det-head">${thumb(o.produto)}
          <div><div class="fapi-det-title">${esc(o.produto?.titulo || '—')}</div>
            <div class="fapi-det-meta">Pedido ${esc(o.id)} · ${fmtDt(o.data)} · ${esc((STATUS_PEDIDO[o.status] || ['', o.status])[1])}</div>
            <div class="fapi-det-tags">${tagFull(o.full)} ${tagAds(o.adsStatus)} ${tagDiag(prod)}</div></div></div>
        <div class="fapi-det-grid">${prodKV}</div>

        <div class="fapi-ext-wrap fapi-tablewrap">
          <table class="fapi-table fapi-ext-table">
            <thead><tr><th>Componente</th><th class="center">Op.</th><th class="right">Valor</th><th>Status</th><th>Fonte</th><th>Observação</th></tr></thead>
            <tbody>
              ${linha('Receita do pedido', '', valOr(o.valor, money), 'real', o.mlb ? 'planilha vendas / futuro Orders API' : 'planilha vendas (sem MLB)', o.mlb ? '' : 'linha financeira sem produto')}
              ${linha('Frete seller', '−', valOr(o.frete, money), o.frete == null ? 'ausente' : o.freteStatus, o.freteStatus === 'estimado' ? 'estimado / futuro Shipping API' : 'planilha vendas / futuro Shipping API', o.frete == null ? 'sem frete real — parcial' : '')}
              ${linha('Taxas marketplace', '−', valOr(o.taxas, money), o.taxas == null ? 'ausente' : o.taxasStatus, 'planilha vendas / futuro pagamentos', o.taxas == null ? 'taxa não identificada — parcial' : '')}
              ${linha('Custo / base', '−', valOr(o.custo, money), o.custoStatus, 'base interna', o.custoStatus === 'ausente' ? (o.mlb ? 'sem custo na base — bloqueia' : 'sem produto vinculado') : '')}
              ${linha('Imposto / regra interna', '−', valOr(o.imposto, money), o.imposto == null ? 'ausente' : 'real', 'base interna · Imposto %', o.imposto == null ? 'depende do custo/base' : '')}
              ${cancelado ? linha('Reembolso / cancelamento', '−', valOr(o.valor, money), 'parcial', 'planilha vendas', 'pedido cancelado — impacto, não conclusão') : ''}
              <tr class="fapi-ext-total">
                <td class="fapi-ext-comp strong">Resultado estimado</td>
                <td class="center fapi-ext-op">=</td>
                <td class="right fapi-ext-val">${o.resultado == null ? '<span class="muted">—</span>' : `<span class="fapi-est">${money(o.resultado)}</span>`}</td>
                <td>${statusBadge(o.resultadoStatus)}</td>
                <td class="fapi-ext-fonte muted">derivado</td>
                <td class="fapi-ext-obs muted">${esc(bloqueado ? 'bloqueado — não vira R$ 0,00' : (o.resultadoStatus === 'real' ? 'todos os componentes presentes' : 'parcial — não confiável'))}</td>
              </tr>
            </tbody>
          </table>
        </div>

        ${(bloqueado || faltas.length) ? `<div class="fapi-det-block${bloqueado ? '' : ' fapi-det-block--warn'}">
          <b>${bloqueado ? 'Sem informações suficientes para concluir' : 'Resultado parcial — o que ainda falta'}</b>
          <ul>${faltas.map(([f, imp]) => `<li><b>${esc(f)}</b> — ${esc(imp)}</li>`).join('')}</ul>
        </div>` : ''}
      </div>
    </section>`;
  host.scrollIntoView({ behavior:'smooth', block:'nearest' });
}
function fecharPedido() { F.selectedOrderId = null; const h = document.getElementById('fapi-pedido-detalhe'); if (h) h.innerHTML = ''; document.querySelectorAll('.fapi-prow--sel').forEach(r => r.classList.remove('fapi-prow--sel')); }

/* ── 5. PRODUTOS POR IMPACTO ───────────────────────────────── */
/* Ferramenta de LEITURA/ANÁLISE (sem recomendação automática): agrega os
   pedidos do período por produto/MLB, com grupos, ordenação e paginação. */
const PROD_SORTS = [
  ['faturamento','Faturamento'], ['unidades','Unidades'], ['pedidos','Pedidos'],
  ['ticketMedio','Ticket médio'], ['comissao','Comissão'], ['receitaBloqueada','Receita bloqueada'],
];
const PROD_GROUPS = [
  ['todos','Todos'], ['curva_a','Curva A'], ['curva_b','Curva B'], ['curva_c','Curva C'],
  ['sem_custo','Sem custo'], ['full','Full'], ['normal','Normal'], ['misto','Misto'],
];
function prodBaseTag(a) {
  if (a.semProduto) return '<span class="fapi-tag fapi-tag--ausente">—</span>';
  return a.temCusto ? '<span class="fapi-tag fapi-tag--ok">com custo</span>' : '<span class="fapi-tag fapi-tag--crit">sem custo</span>';
}
function prodLogTag(t) {
  if (t === 'full')  return '<span class="fapi-tag fapi-tag--full">Full</span>';
  if (t === 'normal')return '<span class="fapi-tag fapi-tag--muted">Normal</span>';
  if (t === 'misto') return '<span class="fapi-tag fapi-tag--warn">Misto</span>';
  return '<span class="fapi-tag fapi-tag--ausente">—</span>';
}
const CURVA_TAG = { A: '<span class="fapi-tag fapi-tag--ok">A</span>', B: '<span class="fapi-tag fapi-tag--warn">B</span>', C: '<span class="fapi-tag fapi-tag--muted">C</span>' };
function renderTopProducts() {
  // Curva ABC sobre o PERÍODO inteiro (independe dos filtros da tabela de pedidos).
  const view = { pedidos: fechamentoOrders(F.rawPayload) };
  const { rows, allRows, totalFat } = buildProductImpactRows(view, { group: F.productGroup, sortBy: F.productSort });

  const vendidos = allRows.filter(a => !a.semProduto);
  const curvaA = vendidos.filter(a => a.curva === 'A');
  const semCusto = vendidos.filter(a => !a.temCusto);
  const fatSemCusto = round2(semCusto.reduce((s, a) => s + a.faturamento, 0));
  const top10 = vendidos.slice().sort((x, y) => y.faturamento - x.faturamento).slice(0, 10);
  const top10Pct = totalFat > 0 ? round2(top10.reduce((s, a) => s + a.faturamento, 0) / totalFat * 100) : null;
  const card = (lbl, val, sub, cls) => `<div class="fapi-card"><div class="fapi-card-lbl">${esc(lbl)}</div><div class="fapi-card-val${cls ? ' ' + cls : ''}">${val}</div><div class="fapi-card-sub">${sub || '&nbsp;'}</div></div>`;
  const cards = `<div class="fapi-cards">
    ${card('Produtos vendidos', valOr(vendidos.length), 'com faturamento no período')}
    ${card('Curva A', valOr(curvaA.length), 'concentram até 80%', 'brand')}
    ${card('Top 10 produtos', valOr(top10Pct, pct), 'do faturamento do período')}
    ${card('Produtos sem custo', valOr(semCusto.length), 'sem custo na base', semCusto.length ? 'crit' : '')}
    ${card('Faturamento sem custo', money(fatSemCusto), 'receita sem custo p/ calcular', fatSemCusto > 0 ? 'warn' : '')}
  </div>`;

  const groupChips = PROD_GROUPS.map(([k, l]) => `<button class="fapi-sortbtn${F.productGroup === k ? ' active' : ''}" data-prodgroup="${k}">${esc(l)}</button>`).join('');
  const sortBtns = PROD_SORTS.map(([k, l]) => `<button class="fapi-sortbtn${F.productSort === k ? ' active' : ''}" data-prodsort="${k}">${esc(l)}</button>`).join('');

  const total = rows.length;
  const pageSize = F.productPageSize;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (F.productPage > pages) F.productPage = pages;
  if (F.productPage < 1) F.productPage = 1;
  const start = (F.productPage - 1) * pageSize;
  const end = Math.min(start + pageSize, total);
  const pageRows = rows.slice(start, end);

  const semFaturamento = totalFat <= 0;
  const tableOrEmpty = (semFaturamento || total === 0)
    ? emptyState({ icon:'•', title: semFaturamento ? 'Sem faturamento no período' : 'Sem produtos neste grupo', why: semFaturamento ? 'Não há receita para montar a curva ABC.' : 'Nenhum produto no recorte atual.', next: semFaturamento ? 'Sincronize pedidos ou amplie o período.' : 'Troque o grupo.' })
    : `<div class="fapi-tablewrap">
      <table class="fapi-table">
        <thead><tr><th>#</th><th>Curva</th><th>Produto</th><th>MLB</th><th>SKU</th><th class="right">Faturamento</th><th class="right">%</th><th class="right">Acum.%</th><th class="right">Un.</th><th class="right">Ped.</th><th class="right">Ticket</th><th class="right">Comissão</th><th class="right">Custo un.</th><th>Base</th><th>Logística</th><th class="right">Receita bloq.</th></tr></thead>
        <tbody>${pageRows.map((a, i) => `
          <tr class="${!a.semProduto && !a.temCusto ? 'fapi-prow--missing-base' : ''}">
            <td class="fapi-rank">${num(start + i + 1)}</td>
            <td>${a.curva ? CURVA_TAG[a.curva] : '<span class="fapi-tag fapi-tag--ausente">—</span>'}</td>
            <td class="strong clip">${esc(a.titulo || '—')}</td>
            <td class="mono">${esc(a.mlb || '—')}</td>
            <td class="mono muted">${esc(a.sku || '—')}</td>
            <td class="right strong">${money(a.faturamento)}</td>
            <td class="right">${valOr(a.pctFat, pct)}</td>
            <td class="right muted">${valOr(a.acumPctFat, pct)}</td>
            <td class="right">${valOr(a.unidades)}</td>
            <td class="right">${valOr(a.pedidos)}</td>
            <td class="right">${valOr(a.ticketMedio, money)}</td>
            <td class="right">${money(a.comissao)}</td>
            <td class="right">${valOr(a.custoUnit, money)}</td>
            <td>${prodBaseTag(a)}</td>
            <td>${prodLogTag(a.logisticaTipo)}</td>
            <td class="right">${a.receitaBloqueada > 0 ? `<span class="fapi-est">${money(a.receitaBloqueada)}</span>` : '—'}</td>
          </tr>`).join('')}</tbody>
      </table></div>
      <div class="fapi-pager">
        <button class="fapi-btn fapi-btn-ghost fapi-btn-sm" id="fapi-prod-prev" type="button"${F.productPage <= 1 ? ' disabled' : ''}>← Anterior</button>
        <span class="fapi-pager-info">Mostrando ${num(start + 1)}–${num(end)} de ${num(total)} produtos${pages > 1 ? ` · página ${num(F.productPage)}/${num(pages)}` : ''}</span>
        <button class="fapi-btn fapi-btn-ghost fapi-btn-sm" id="fapi-prod-next" type="button"${F.productPage >= pages ? ' disabled' : ''}>Próxima →</button>
      </div>`;

  return `
  <section class="fapi-panel">
    <div class="fapi-panel-head"><h2 class="fapi-panel-title">Curva ABC de Produtos</h2>
      <span class="fapi-panel-meta">A ≤80% · B ≤95% · C resto do faturamento do período · leitura/análise</span></div>
    <div class="fapi-panel-body fapi-panel-body--flush">
      ${cards}
      <div class="fapi-prodbar">
        <div class="fapi-sortbar fapi-prodgroups" id="fapi-prodgroups"><span class="fapi-sortbar-lbl">Grupo</span>${groupChips}</div>
        <div class="fapi-prodactions">
          <button class="fapi-btn fapi-btn-ghost fapi-btn-sm" id="fapi-prod-onlysemcusto" type="button">Ver apenas sem custo</button>
          <button class="fapi-btn fapi-btn-ghost fapi-btn-sm" id="fapi-prod-copysemcusto" type="button">Copiar MLBs sem custo</button>
        </div>
      </div>
      <div class="fapi-sortbar" id="fapi-prodsortbar"><span class="fapi-sortbar-lbl">Ordenar por</span>${sortBtns}</div>
      ${tableOrEmpty}
    </div>
  </section>`;
}

/* Copia para a área de transferência os MLBs sem custo na base (todo o período). */
function fallbackCopy(texto, cb) {
  try {
    const ta = document.createElement('textarea');
    ta.value = texto; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
  } catch (_) { /* ignora */ }
  if (cb) cb();
}
function copiarMlbsSemCusto() {
  const view = { pedidos: fechamentoOrders(F.rawPayload) };
  const { allRows } = buildProductImpactRows(view, { group: 'todos', sortBy: 'faturamento' });
  const mlbs = allRows.filter(a => !a.semProduto && !a.temCusto && a.mlb).map(a => a.mlb);
  const btn = document.getElementById('fapi-prod-copysemcusto');
  const flash = msg => { if (btn) { const t = btn.dataset.label || btn.textContent; btn.dataset.label = t; btn.textContent = msg; setTimeout(() => { btn.textContent = t; }, 1600); } };
  if (!mlbs.length) { flash('Nenhum sem custo'); return; }
  const texto = mlbs.join('\n');
  const ok = () => flash(`Copiado ${mlbs.length} MLB(s)`);
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(texto).then(ok).catch(() => fallbackCopy(texto, ok));
  else fallbackCopy(texto, ok);
}

/* ── INTERAÇÕES ───────────────────────────────────────────── */
/* Filtro de pedido (select da toolbar) — aplica instantâneo, sem fetch. */
function setPedFilter(key, value) {
  F.filters[key] = value || (key === 'logistica' || key === 'midia' || key === 'diagbase' || key === 'status' ? 'todos' : null);
  F.filters = sanitizeFilters(F.filters, F.rawPayload);
  F.selectedOrderId = null;
  F.page = 1;
  recomputeView();
  renderPedTable();
}
function applyDayFilter(day) {
  // Clique num dia (régua ou tabela) → filtra SÓ a tabela de pedidos daquele dia.
  if (!isDateInPeriod(day, F.rawPayload.periodo)) return;
  F.filters = { ...cloneFilters(F.filters), modo:'intervalo', dia:null, semana:null, de:day, ate:day };
  F.selectedOrderId = null;
  F.page = 1;
  recomputeView();
  renderResults(); // re-render geral p/ refletir o destaque do dia na régua + tabela filtrada
}
/* Recorte rápido (chip). Toggle: reclicar o ativo volta a "Todos". */
function applyQuickFilter(q) {
  F.quickFilter = (q !== 'todos' && q === F.quickFilter) ? 'todos' : q;
  F.page = 1;
  F.selectedOrderId = null;
  renderPedTable();
  document.querySelectorAll('.fapi-chipbar--ped .fapi-chip').forEach(b => b.classList.toggle('active', b.dataset.quick === F.quickFilter));
}
function setOrderSort(value) {
  F.orderSort = value || 'data_desc';
  F.page = 1;
  renderPedTable();
}
/* "Limpar tudo": zera recorte, ordenação, busca e selects (mantém o período). */
function limparTudoLocal() {
  F.quickFilter = 'todos';
  F.orderSort = 'data_desc';
  resetFilters();
  F.selectedOrderId = null;
  recomputeView();
  renderResults(); // rebuild toolbar (selects/busca/chips) + tabela
}
/* Busca local com debounce de 300ms — re-renderiza só #fapi-ped-table; o input
   está na toolbar (fora desse host), então o foco é preservado. */
function onSearchInput(value) {
  if (F.searchTimer) clearTimeout(F.searchTimer);
  F.searchTimer = setTimeout(() => {
    F.searchTerm = value;
    F.page = 1;
    F.selectedOrderId = null;
    renderPedTable();
  }, 300);
}
function goToPage(delta) {
  F.page = Math.max(1, F.page + delta);
  renderPedTable();
}
/* Recortes do Fechamento (chips próprios) — re-render só do bloco Fechamento. */
function setFechQuick(q) {
  F.fechQuick = (q !== 'todos' && q === F.fechQuick) ? 'todos' : q;
  renderResults(); // bloco Fechamento depende de F.fechQuick; demais blocos não mudam
}

/* Handlers da tabela de pedidos (re-bind a cada renderPedTable). */
function wirePedTable() {
  const host = document.getElementById('fapi-ped-table');
  if (!host) return;
  host.querySelector('#fapi-clear-local')?.addEventListener('click', limparTudoLocal);
  host.querySelector('#fapi-page-prev')?.addEventListener('click', () => goToPage(-1));
  host.querySelector('#fapi-page-next')?.addEventListener('click', () => goToPage(1));
  host.querySelectorAll('.fapi-prow').forEach(row => {
    row.addEventListener('click', () => abrirPedido(row.dataset.pedido));
    row.addEventListener('keydown', e => { if (e.key === 'Enter') abrirPedido(row.dataset.pedido); });
  });
  if (F.selectedOrderId) abrirPedido(F.selectedOrderId);
}
function wireResults() {
  // Fechamento: recortes próprios + "Atualizar" (recalcula do payload, sem ML)
  document.getElementById('fapi-fech-refresh')?.addEventListener('click', () => renderResults());
  document.querySelectorAll('[data-fechq]').forEach(b => b.addEventListener('click', () => setFechQuick(b.dataset.fechq)));
  // Vendas por dia: ordenação da tabela + clique no dia (régua/linha)
  document.getElementById('fapi-daily-sort')?.addEventListener('change', e => { F.fechDailySort = e.target.value; renderResults(); });
  document.querySelectorAll('[data-fechday]').forEach(r => r.addEventListener('click', () => applyDayFilter(r.dataset.fechday)));
  document.querySelectorAll('.fapi-day').forEach(d => d.addEventListener('click', () => applyDayFilter(d.dataset.day)));
  // Curva ABC: grupos, ordenação, paginação e ações
  document.querySelectorAll('#fapi-prodgroups .fapi-sortbtn').forEach(b => b.addEventListener('click', () => { F.productGroup = b.dataset.prodgroup; F.productPage = 1; renderResults(); }));
  document.querySelectorAll('#fapi-prodsortbar .fapi-sortbtn').forEach(b => b.addEventListener('click', () => { F.productSort = b.dataset.prodsort; F.productPage = 1; renderResults(); }));
  document.getElementById('fapi-prod-prev')?.addEventListener('click', () => { F.productPage = Math.max(1, F.productPage - 1); renderResults(); });
  document.getElementById('fapi-prod-next')?.addEventListener('click', () => { F.productPage = F.productPage + 1; renderResults(); });
  document.getElementById('fapi-prod-onlysemcusto')?.addEventListener('click', () => { F.productGroup = 'sem_custo'; F.productPage = 1; renderResults(); });
  document.getElementById('fapi-prod-copysemcusto')?.addEventListener('click', copiarMlbsSemCusto);
  // Pedidos: toolbar (busca + selects + chips + ordenação) — filtros instantâneos
  const search = document.getElementById('fapi-search');
  if (search) search.addEventListener('input', e => onSearchInput(e.target.value));
  document.querySelectorAll('[data-pedfilter]').forEach(s => s.addEventListener('change', () => setPedFilter(s.dataset.pedfilter, s.value)));
  document.querySelectorAll('.fapi-chipbar--ped .fapi-chip').forEach(b => b.addEventListener('click', () => applyQuickFilter(b.dataset.quick)));
  document.getElementById('fapi-order-sort')?.addEventListener('change', e => setOrderSort(e.target.value));
  wirePedTable();
}

/* ── IMPORTAÇÃO DE VENDAS (admin only) ───────────────────── */
function montarBlocoImportacao(controls) {
  const user = JSON.parse(localStorage.getItem('vf-user') || '{}');
  if (user.role !== 'admin') return;

  if (!document.getElementById('fapi-import-styles')) {
    const s = document.createElement('style');
    s.id = 'fapi-import-styles';
    s.textContent = [
      '.fapi-import-block { border-left: 1px solid var(--vfop-border,#dde1e8); padding-left: 14px; margin-left: 2px; }',
      '.fapi-import-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }',
      '.fapi-import-input { width: 0.1px; height: 0.1px; opacity: 0; overflow: hidden; position: absolute; z-index: -1; }',
      '.fapi-import-label { display: inline-flex; align-items: center; height: 28px; padding: 0 10px; border-radius: 6px; font-size: 11.5px; font-weight: 600; cursor: pointer; border: 1px solid var(--vfop-border,#dde1e8); color: var(--vfop-muted,#5a6578); background: var(--vfop-surface,#fff); white-space: nowrap; }',
      '.fapi-import-label:hover { background: var(--vfop-subtle,#f8f9fb); }',
      '.fapi-import-fname { font-size: 11px; color: var(--vfop-text,#111827); max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
      '.fapi-import-fname:empty::before { content: "Nenhum arquivo"; color: var(--vfop-soft,#8c96a6); }',
      '.fapi-import-status { font-size: 11.5px; font-weight: 600; margin-top: 4px; padding: 3px 7px; border-radius: 4px; width: 100%; box-sizing: border-box; }',
      '.fapi-import-status--info    { color: #2563eb; background: #eff6ff; }',
      '.fapi-import-status--ok      { color: #1a7a45; background: #f4fbf7; }',
      '.fapi-import-status--warn    { color: #855100; background: #fdf9f0; }',
      '.fapi-import-status--danger  { color: #9b1c1c; background: #fdf4f3; }',
    ].join('\n');
    document.head.appendChild(s);
  }

  const wrap = document.createElement('div');
  wrap.id = 'fapi-import-block';
  wrap.className = 'fapi-field fapi-import-block';
  wrap.innerHTML = `
    <label>Importar vendas</label>
    <div class="fapi-import-row">
      <input type="file" id="fapi-import-file" accept=".xlsx" class="fapi-import-input">
      <label for="fapi-import-file" class="fapi-import-label">Escolher .xlsx</label>
      <span id="fapi-import-fname" class="fapi-import-fname"></span>
      <button id="fapi-import-btn" class="fapi-btn fapi-btn-primary fapi-btn-sm" type="button">Importar</button>
      <button id="fapi-sync-btn" class="fapi-btn fapi-btn-ghost fapi-btn-sm" type="button" title="Busca os pedidos direto da API do Mercado Livre (sem planilha)">Sincronizar via API</button>
    </div>
    <div id="fapi-import-status" class="fapi-import-status" hidden></div>`;
  controls.appendChild(wrap);

  // Guarda o File em F.arquivoImport no momento da seleção — imune a qualquer
  // repaint ou reescrita de #fapi-content pelo carregarTela.
  document.getElementById('fapi-import-file').addEventListener('change', function () {
    const f = this.files?.[0] || null;
    F.arquivoImport = f;
    const nome = document.getElementById('fapi-import-fname');
    if (nome) nome.textContent = f ? f.name : '';
    setImportStatus('', '');
  });

  document.getElementById('fapi-import-btn').addEventListener('click', executarImportacao);
  document.getElementById('fapi-sync-btn').addEventListener('click', executarSincronizacao);
}

function setImportStatus(msg, tipo) {
  const el = document.getElementById('fapi-import-status');
  if (!el) return;
  el.hidden = !msg;
  el.textContent = msg || '';
  el.className = `fapi-import-status fapi-import-status--${tipo || 'info'}`;
}

async function executarImportacao() {
  if (!TOKEN) return;
  const btn = document.getElementById('fapi-import-btn');

  if (!F.cliente) { setImportStatus('Selecione um cliente antes de importar.', 'warn'); return; }
  if (!F.periodo) { setImportStatus('Selecione o período antes de importar.', 'warn'); return; }

  // Usa F.arquivoImport (variável de estado) — não depende de input.files[0],
  // que o browser pode zerar após repaint mesmo sem destruir o elemento.
  const arquivo = F.arquivoImport;
  if (!arquivo) { setImportStatus('Selecione a planilha de vendas (.xlsx).', 'warn'); return; }

  if (btn) { btn.disabled = true; btn.textContent = 'Importando…'; }
  setImportStatus('Importando…', 'info');

  try {
    const form = new FormData();
    form.append('sales', arquivo);
    // Import (planilha) ainda agrupa por competência: deriva do mês do início do período.
    form.append('competencia', String(F.periodo.dateFrom).slice(0, 7));

    const res = await fetch(
      `${API_BASE}/operacao/central-vendas/${encodeURIComponent(F.cliente.slug)}/importar-vendas`,
      { method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN }, body: form }
    );

    if (res.status === 401) { window.location.replace('index.html'); return; }

    const json = await res.json();
    if (!res.ok) throw new Error(json.erro || json.error || json.message || `HTTP ${res.status}`);

    const pedidos = json.pedidosPersistidos ?? '?';
    setImportStatus(`✓ Importado: ${pedidos} pedido(s). Recarregando…`, 'ok');
    // Limpa o arquivo após importação bem-sucedida
    F.arquivoImport = null;
    const fileInput = document.getElementById('fapi-import-file');
    if (fileInput) fileInput.value = '';
    const fname = document.getElementById('fapi-import-fname');
    if (fname) fname.textContent = '';
    await carregarTela();
    setImportStatus(`✓ ${pedidos} pedido(s) importados com sucesso.`, 'ok');
  } catch (err) {
    setImportStatus(`Erro: ${err?.message || 'Falha na importação.'}`, 'danger');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Importar'; }
  }
}

/* Sincronização API-first: busca pedidos direto da Orders API do ML, sem planilha.
   Custo continua vindo da base vinculada oficial do cliente. */
async function executarSincronizacao() {
  if (!TOKEN) return;
  const btn = document.getElementById('fapi-sync-btn');

  if (!F.cliente) { setImportStatus('Selecione um cliente antes de sincronizar.', 'warn'); return; }
  if (!F.periodo) { setImportStatus('Selecione o período antes de sincronizar.', 'warn'); return; }

  if (btn) { btn.disabled = true; btn.textContent = 'Sincronizando…'; }
  setImportStatus('Sincronizando pedidos via API do Mercado Livre…', 'info');

  try {
    const res = await fetch(
      `${API_BASE}/operacao/central-vendas/${encodeURIComponent(F.cliente.slug)}/sincronizar`,
      {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify({ dateFrom: F.periodo.dateFrom, dateTo: F.periodo.dateTo }),
      }
    );

    if (res.status === 401) { window.location.replace('index.html'); return; }

    const json = await res.json();
    if (!res.ok) throw new Error(json.erro || json.error || json.message || `HTTP ${res.status}`);

    const pedidos = json.pedidosPersistidos ?? '?';
    const orders = json.ordersEncontrados ?? '?';
    const baseTxt = json.baseVinculada ? `base "${json.baseVinculada.nome}"` : 'sem base vinculada';
    setImportStatus(`✓ Sincronizado: ${pedidos} pedido(s) de ${orders} da API · ${baseTxt}. Recarregando…`, 'ok');
    await carregarTela();
    setImportStatus(`✓ ${pedidos} pedido(s) sincronizados via API (${baseTxt}).`, 'ok');
  } catch (err) {
    setImportStatus(`Erro: ${err?.message || 'Falha na sincronização.'}`, 'danger');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Sincronizar via API'; }
  }
}

/* ── BOOT ─────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', initFechamentosApi);
