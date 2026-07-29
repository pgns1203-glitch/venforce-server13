// server/tests/observabilityControlCenter.test.js
// Carrega os módulos REAIS do Control Center (store, api, renderers) no Node e
// exercita as sete visões.
//
// O que isto protege:
//  - nenhuma view quebra em estado vazio, carregando, erro ou sem permissão
//    (o Control Center precisa abrir mesmo com o backend fora);
//  - todo valor vindo de log/erro/usuário sai escapado — o painel renderiza
//    exatamente o texto que um atacante conseguiu gravar num log;
//  - o curl copiável nunca imprime o token.
//
// Roda sem infra: node tests/observabilityControlCenter.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

let passou = 0;
const ok = (nome, condicao) => {
  assert.ok(condicao, `FALHOU: ${nome}`);
  passou++;
  console.log(`  ok  ${nome}`);
};

/* ── shim mínimo ──────────────────────────────────────────────────────────── */

function criarStorage() {
  const dados = new Map();
  return {
    getItem: (k) => (dados.has(String(k)) ? dados.get(String(k)) : null),
    setItem: (k, v) => { dados.set(String(k), String(v)); },
    removeItem: (k) => { dados.delete(String(k)); },
  };
}

globalThis.window = globalThis;
globalThis.localStorage = criarStorage();
globalThis.location = { pathname: "/control-center.html", search: "", href: "http://portal.local/control-center.html" };
globalThis.history = { pushState() {}, replaceState() {} };
globalThis.document = { addEventListener() {}, createElement() { return { style: {}, setAttribute() {}, click() {} }; } };
globalThis.addEventListener = () => {};

localStorage.setItem("vf-user", JSON.stringify({ id: 1, nome: "Admin", email: "admin@venforce.com", role: "admin" }));
localStorage.setItem("vf-token", "eyJhbGciOiJIUzI1NiJ9.eyJpZCI6MSwiZXhwIjo5OTk5OTk5OTk5fQ.assinaturaSecreta");
localStorage.setItem("vf-api-base", "https://api.teste.local");

const portal = path.join(__dirname, "..", "..", "Portal");
["control-center-api.js", "control-center-store.js", "control-center-renderers.js"].forEach((arquivo) => {
  const caminho = path.join(portal, arquivo);
  vm.runInThisContext(fs.readFileSync(caminho, "utf8"), { filename: caminho });
});

const S = globalThis.VFCStore;
const R = globalThis.VFCRenderers;
const API = globalThis.VFCApi;

const VIEWS = ["overview", "requests", "errors", "browser", "health", "routes", "tools"];

function estadoBase(patch) {
  return Object.assign({}, S.state, patch || {});
}

/* ── payload hostil: exatamente o que um log envenenado carregaria ───────── */

const XSS = '<img src=x onerror="alert(1)"><script>alert(2)</script>"onmouseover="alert(3)';

function semHtmlInjetado(html) {
  return html.indexOf("<img src=x") === -1
    && html.indexOf("<script>alert") === -1
    && html.indexOf('onerror="alert') === -1
    && html.indexOf('onmouseover="alert') === -1;
}

console.log("\n▸ 1. Utilitários de formatação e escape");
{
  ok("escapeHtml neutraliza tags", S.escapeHtml("<b>x</b>") === "&lt;b&gt;x&lt;/b&gt;");
  ok("escapeHtml neutraliza aspas", S.escapeHtml('a"b\'c').indexOf('"') === -1);
  ok("escapeHtml aceita null", S.escapeHtml(null) === "");
  ok("escapeHtml aceita undefined", S.escapeHtml(undefined) === "");

  ok("status 2xx é sucesso", S.classeStatus(200) === "is-success");
  ok("status 3xx é info", S.classeStatus(302) === "is-info");
  ok("status 4xx é atenção", S.classeStatus(404) === "is-warning");
  ok("status 5xx é perigo", S.classeStatus(500) === "is-danger");
  ok("status 0 é falha de rede", S.classeStatus(0) === "is-network");
  ok("status ausente é falha de rede", S.classeStatus(null) === "is-network");
  ok("rótulo de rede é NET", S.rotuloStatus(0) === "NET");

  ok("duração em ms", S.formatarDuracao(840) === "840ms");
  ok("duração em segundos", S.formatarDuracao(2400) === "2.40s");
  ok("duração ausente não vira NaN", S.formatarDuracao(null) === "—");
  ok("duração inválida não vira NaN", S.formatarDuracao("abc") === "—");
  ok("número ausente não vira NaN", S.formatarNumero(undefined) === "—");
  ok("data inválida não vira Invalid Date", S.formatarDataHora("xxx") === "—");
  ok("bytes ausentes não viram NaN", S.formatarBytes(null) === "—");
  ok("bytes são legíveis", S.formatarBytes(2048) === "2.0 KB");
}

console.log("\n▸ 2. Diagnóstico de sessão não expõe o token");
{
  const jwt = S.decodificarJwt();
  ok("token é detectado", jwt.presente === true);
  ok("JWT é decodificado localmente", jwt.decodificavel === true);
  ok("expiração é extraída", typeof jwt.expiraEm === "string");
  ok("o token em si nunca é devolvido", JSON.stringify(jwt).indexOf("assinaturaSecreta") === -1);

  const curl = S.montarCurl({
    requestId: "req-1",
    servidor: { method: "GET", path: "/bases", metadata: { url: "/bases?ativo=true" } },
  });
  ok("curl usa variável de ambiente, não o token", curl.indexOf("$VF_TOKEN") !== -1);
  ok("curl não contém o JWT", curl.indexOf("assinaturaSecreta") === -1 && curl.indexOf("eyJ") === -1);
  ok("curl carrega o request id para correlação", curl.indexOf("X-Request-Id: req-1") !== -1);
  ok("curl aponta para a API configurada", curl.indexOf("https://api.teste.local") !== -1);
}

console.log("\n▸ 3. Toda view abre em estado vazio (backend responde, sem dados)");
{
  const vazio = estadoBase({
    resumo: {
      janela: "1h", desde: new Date().toISOString(), slowMs: 1000, total: 0, porMinuto: 0,
      percentualSucesso: null, erros4xx: 0, erros5xx: 0, falhasRede: 0, errosNavegador: 0,
      errosJs: 0, rejeicoesNaoTratadas: 0, eventosNavegador: 0, sessoes: 0, duracaoMedia: 0,
      p50: 0, p95: 0, p99: 0, lentas: 0, rotaComMaisErros: null, rotaMaisLenta: null,
      ultimoErro: null, porMinutoSerie: [], porStatus: [],
      fila: { pendentes: 0, descartados: 0, falhasConsecutivas: 0, gravados: { requests: 0, clientEvents: 0 }, descartadosPorFila: 0, descartadosPorErro: 0 },
    },
    saude: {
      statusGeral: "saudavel",
      api: { status: "saudavel", uptimeSegundos: 3600, node: "v24", ambiente: "development", plataforma: "linux x64", horaServidor: new Date().toISOString(), versao: null, memoria: { rssMb: 90, heapUsadoMb: 40, heapTotalMb: 60, sistemaLivreMb: 800 } },
      banco: { status: "saudavel", latenciaMs: 3, erro: null, pool: { total: 4, ociosas: 3, aguardando: 0 } },
      observabilidade: {
        habilitada: true, eventosNavegador: true, capturaStack: true, retencaoDias: 7,
        maxLinhas: 50000, slowMs: 1000, armazenamento: { requests: 0, client_events: 0, request_mais_antiga: null },
        fila: { pendentes: 0, descartados: 0, descartadosPorFila: 0, descartadosPorErro: 0, gravados: { requests: 0, clientEvents: 0 }, falhasConsecutivas: 0, ultimoErro: null, ultimoFlushEm: null },
      },
      integracoes: [
        { id: "clickup", nome: "ClickUp", variaveis: [{ nome: "CLICKUP_TOKEN", presente: false }], configuracao: "nao_configurado", testavel: true, teste: "nao_testado", nota: null },
      ],
    },
    rotas: { ok: true, total: 0, rotas: [] },
    local: { eventos: [], stats: null, runtime: { version: "2.0.0", ativo: false, habilitado: false, indexedDb: "ok", broadcastChannel: true, sessionId: "s-1", tabId: "t-1", pageLoadId: "p-1", ultimoSync: null, ultimoSyncErro: null, pendentes: 0, config: { captureConsole: false }, limiteEventos: 1000 }, disponivel: true },
  });

  VIEWS.forEach((view) => {
    const estado = Object.assign({}, vazio, { view: view });
    let html;
    assert.doesNotThrow(() => { html = R[view](estado); }, `view ${view} não pode lançar em estado vazio`);
    ok(`view "${view}" renderiza sem lançar`, typeof html === "string" && html.length > 0);
    ok(`view "${view}" não emite undefined/NaN na tela`,
      html.indexOf(">undefined<") === -1 && html.indexOf(">NaN<") === -1 && html.indexOf("[object Object]") === -1);
  });

  ok("overview mostra estado vazio explicativo", R.overview(vazio).indexOf("Nenhum registro nesta janela") !== -1);
  ok("overview não inventa número quando não há dado", R.overview(vazio).indexOf("vf-kpi__value\">—") !== -1 || R.overview(vazio).indexOf(">0<") !== -1);
  ok("statusBar renderiza", R.statusBar(vazio).indexOf("vfc-statusbar") === 1 || R.statusBar(vazio).indexOf("vfc-statusbar") > 0);
  ok("abas renderizam as sete visões", VIEWS.every((v) => R.abas(vazio).indexOf('data-cc-view="' + v + '"') !== -1));
  ok("seletor de janela renderiza as cinco opções", S.WINDOWS.every((w) => R.seletorJanela(vazio).indexOf('data-cc-window="' + w + '"') !== -1));
}

console.log("\n▸ 4. Estados de falha são explicados, não escondidos");
{
  const casos = [
    ["sem-permissao", "Sem permissão"],
    ["banco-indisponivel", "Banco indisponível"],
    ["endpoint-ausente", "Endpoint ausente"],
    ["offline", "Servidor inacessível"],
    ["sem-token", "Sessão sem token"],
  ];
  casos.forEach(([tipo, esperado]) => {
    const html = R.falha({ tipo: tipo, erro: "detalhe técnico" }, "requests");
    ok(`falha "${tipo}" tem título próprio`, html.indexOf(esperado) !== -1);
    ok(`falha "${tipo}" usa banner de erro`, html.indexOf('role="alert"') !== -1);
  });

  ok("falha desconhecida ainda renderiza", R.falha({ tipo: "coisa-nova", erro: "x" }).indexOf("Não foi possível carregar") !== -1);
  ok("falha sem objeto não quebra", R.falha(null) === "");

  const comBackendFora = estadoBase({
    view: "overview",
    falhas: { resumo: { tipo: "banco-indisponivel", erro: "sem conexão" } },
    local: { eventos: [{ eventId: "e1", eventType: "request", page: "bases.html" }], stats: null, runtime: null, disponivel: true },
  });
  const html = R.overview(comBackendFora);
  ok("com o banco fora o overview oferece os dados locais", html.indexOf("Somente dados locais") !== -1);
  ok("e mostra o caminho para eles", html.indexOf('data-cc-view="browser"') !== -1);
}

console.log("\n▸ 5. Escape de conteúdo hostil vindo dos logs");
{
  const estado = estadoBase({
    view: "requests",
    requests: {
      linhas: [{
        source: "server", id: 1, request_id: XSS, method: XSS, route: XSS, path: XSS,
        status_code: 500, duration_ms: 900, user_email: XSS, user_nome: XSS,
        page: XSS, session_id: XSS, error_message: XSS, error_name: XSS,
        created_at: new Date().toISOString(),
      }],
      total: 1, page: 1, totalPages: 1, slowMs: 1000,
    },
    filtros: Object.assign({}, S.state.filtros, { search: XSS, route: XSS, user: XSS, screen: XSS }),
    local: { eventos: [], stats: null, runtime: null, disponivel: false },
  });

  const html = R.requests(estado);
  ok("tabela de requests escapa o conteúdo", semHtmlInjetado(html));
  ok("o texto hostil aparece escapado, não sumido", html.indexOf("&lt;img src=x") !== -1);
  ok("o valor hostil no filtro também é escapado", html.indexOf('value="&lt;img') !== -1);

  const estadoErros = estadoBase({
    view: "errors",
    erros: {
      grupos: [{
        origem: "server", tipo: XSS, mensagem: XSS, rota: XSS, metodo: XSS, status: 500,
        total: 3, usuarios: 1, primeira: new Date().toISOString(), ultima: new Date().toISOString(),
        ultimoRequestId: XSS, stack: XSS, severidade: "alta", assinatura: XSS,
      }],
      total: 1,
    },
  });
  ok("agrupamento de erros escapa o conteúdo", semHtmlInjetado(R.errors(estadoErros)));

  const estadoDetalhe = estadoBase({
    selecionado: {
      requestId: XSS,
      detalhe: {
        requestId: XSS,
        servidor: {
          method: XSS, route: XSS, path: XSS, status_code: 500, duration_ms: 10,
          user_email: XSS, user_nome: XSS, content_type: XSS, response_size: 10,
          user_agent: XSS, error_name: XSS, error_message: XSS, error_stack: XSS,
          metadata: { url: XSS, query: { q: XSS }, origem: XSS, referer: XSS, ip: XSS },
          created_at: new Date().toISOString(),
        },
        navegador: [{ created_at: new Date().toISOString(), event_type: XSS, severity: "error", message: XSS, page: XSS }],
        eventoPrincipal: {
          method: XSS, endpoint: XSS, page: XSS, status_code: 500, duration_ms: 12,
          event_type: "request", severity: "error", message: XSS, stack: XSS,
          session_id: XSS, tab_id: XSS, page_load_id: XSS,
          data: { headers: { "x-teste": XSS }, request: { campo: XSS }, response: { capturado: true, corpo: { erro: XSS } }, contentType: XSS, url: XSS },
        },
        timeline: [{ fonte: "server", em: new Date().toISOString(), tipo: XSS, severidade: "error", titulo: XSS, pagina: XSS, duracao: 10, status: 500 }],
        correlacao: { temServidor: true, temNavegador: true, completa: true, motivo: null },
      },
    },
  });

  ["resumo", "request", "response", "erro", "timeline", "contexto"].forEach((aba) => {
    const drawerHtml = R.drawer(Object.assign({}, estadoDetalhe, { abaDetalhe: aba }));
    ok(`drawer/${aba} renderiza sem lançar`, typeof drawerHtml === "string" && drawerHtml.length > 0);
    ok(`drawer/${aba} escapa conteúdo hostil`, semHtmlInjetado(drawerHtml));
  });

  const estadoNavegador = estadoBase({
    view: "browser",
    local: {
      disponivel: true,
      eventos: [{ eventId: XSS, eventType: XSS, severity: "error", page: XSS, message: XSS, requestId: XSS, synced: 0, timestamp: new Date().toISOString() }],
      stats: { total: 1, naoSincronizados: 1, porTipo: {}, sessoes: {}, abas: {}, paginas: {} },
      runtime: { version: "2.0.0", ativo: true, habilitado: true, indexedDb: "ok", broadcastChannel: true, sessionId: XSS, tabId: XSS, pageLoadId: XSS, ultimoSync: null, ultimoSyncErro: XSS, pendentes: 1, config: { captureConsole: false }, limiteEventos: 1000, fetchInterceptado: true, xhrInterceptado: true, errosInterceptados: true },
    },
    sessoes: [{ session_id: XSS, user_email: XSS, eventos: 1, abas: 1, erros: 1, ultima_pagina: XSS, fim: new Date().toISOString() }],
  });
  ok("visão Navegador escapa conteúdo hostil", semHtmlInjetado(R.browser(estadoNavegador)));

  const estadoRotas = estadoBase({
    view: "routes",
    rotas: { ok: true, total: 1, rotas: [{ metodo: XSS, caminho: XSS, area: XSS, autenticacao: XSS, adminOnly: XSS, middlewares: [XSS], introspeccao: "ok" }] },
    rotasStats: [{ rota: XSS, method: XSS, total: 5, erros: 1, lentas: 0, media: 100, p95: 200, ultima: new Date().toISOString() }],
  });
  ok("inventário de rotas escapa conteúdo hostil", semHtmlInjetado(R.routes(estadoRotas)));
}

console.log("\n▸ 6. Overview com dados reais");
{
  const estado = estadoBase({
    view: "overview",
    resumo: {
      janela: "1h", slowMs: 1000, total: 400, porMinuto: 6.7, percentualSucesso: 92.5,
      erros4xx: 20, erros5xx: 10, falhasRede: 3, errosNavegador: 8, errosJs: 5,
      rejeicoesNaoTratadas: 1, eventosNavegador: 120, sessoes: 4, duracaoMedia: 210,
      p50: 110, p95: 850, p99: 2100, lentas: 12,
      rotaComMaisErros: { rota: "/operacao/cliente-360/:slug", total: 10 },
      rotaMaisLenta: { rota: "/fechamentos/financeiro", media: 3200 },
      ultimoErro: { request_id: "r-9", method: "GET", rota: "/bases/:baseId", status_code: 500, error_message: "boom", created_at: new Date().toISOString() },
      porMinutoSerie: [{ minuto: new Date().toISOString(), total: 10, erros: 2 }, { minuto: new Date().toISOString(), total: 4, erros: 0 }],
      porStatus: [{ faixa: 200, total: 370 }, { faixa: 400, total: 20 }, { faixa: 500, total: 10 }],
      fila: { pendentes: 2, descartados: 0, descartadosPorFila: 0, descartadosPorErro: 0, gravados: { requests: 400, clientEvents: 120 }, falhasConsecutivas: 0 },
    },
    erros: { grupos: [{ origem: "server", tipo: "TypeError", mensagem: "x is not a function", rota: "/bases/:baseId", metodo: "GET", status: 500, total: 4, usuarios: 2, primeira: new Date().toISOString(), ultima: new Date().toISOString(), ultimoRequestId: "r-9", stack: "at f", severidade: "alta", assinatura: "a1" }], total: 1 },
    local: { eventos: [], stats: { naoSincronizados: 3 }, runtime: null, disponivel: true },
  });

  const html = R.overview(estado);
  ok("taxa de erro é derivada do sucesso", html.indexOf("7.5%") !== -1);
  ok("p95 aparece", html.indexOf("850ms") !== -1);
  ok("o gráfico por minuto é desenhado em CSS", html.indexOf("vfc-bar") !== -1);
  ok("a distribuição por status é desenhada em CSS", html.indexOf("vfc-stack-bar__parte") !== -1);
  ok("nenhuma biblioteca de gráfico é carregada", html.indexOf("<canvas") === -1 && html.indexOf("chart.js") === -1);
  ok("endpoint com mais erros é clicável", html.indexOf('data-cc-action="filter-route"') !== -1);
  ok("último erro leva ao detalhe", html.indexOf('data-cc-request="r-9"') !== -1);
  ok("eventos não sincronizados aparecem", html.indexOf("não sincronizados") !== -1);
}

console.log("\n▸ 7. Requests: filtros, ordenação e paginação");
{
  const linhas = Array.from({ length: 3 }, (_, i) => ({
    source: i % 2 ? "browser" : "server", id: i, request_id: "r" + i, method: "GET",
    route: "/bases", path: "/bases", status_code: 200 + i, duration_ms: 100 * (i + 1),
    user_email: "a@x.com", page: "bases.html", session_id: "s1", error_message: null,
    created_at: new Date().toISOString(),
  }));
  const estado = estadoBase({
    view: "requests",
    requests: { linhas: linhas, total: 250, page: 2, totalPages: 5, slowMs: 1000 },
    filtros: Object.assign({}, S.state.filtros, { page: 2, status: "5xx", onlySlow: true, sortBy: "duration_ms", sortDir: "asc" }),
    local: { eventos: [{ requestId: "r0" }], stats: null, runtime: null, disponivel: true },
  });
  const html = R.requests(estado);

  ok("chip de status ativo é marcado", html.indexOf('data-cc-status="5xx"') !== -1 && html.indexOf("is-active") !== -1);
  ok("chip de lentas ativo é marcado", html.indexOf('data-cc-toggle="onlySlow"') !== -1);
  ok("botão de limpar filtros aparece com filtro ativo", html.indexOf('data-cc-action="clear-filters"') !== -1);
  ok("ordenação ativa é sinalizada", html.indexOf("vf-table__sort is-asc") !== -1);
  ok("aria-sort é declarado", html.indexOf('aria-sort="ascending"') !== -1);
  ok("paginação mostra intervalo real da página", html.indexOf("51–100 de 250") !== -1);
  ok("página anterior é navegável", html.indexOf('data-cc-page="1"') !== -1);
  ok("página seguinte é navegável", html.indexOf('data-cc-page="3"') !== -1);
  ok("linha correlacionada ganha indicador", html.indexOf("vfc-elo") !== -1);
  ok("linhas são acessíveis por teclado", html.indexOf('tabindex="0"') !== -1);
  ok("a tabela tem caption para leitor de tela", html.indexOf("<caption") !== -1);

  const semFiltro = estadoBase({
    view: "requests",
    requests: { linhas: [], total: 0, page: 1, totalPages: 1, slowMs: 1000 },
    local: { eventos: [], stats: null, runtime: null, disponivel: true },
  });
  ok("sem resultado e sem filtro a mensagem é de janela vazia",
    R.requests(semFiltro).indexOf("Nenhuma request na janela") !== -1);

  const comFiltro = estadoBase({
    view: "requests",
    requests: { linhas: [], total: 0, page: 1, totalPages: 1, slowMs: 1000 },
    filtros: Object.assign({}, S.state.filtros, { search: "abc" }),
    local: { eventos: [], stats: null, runtime: null, disponivel: true },
  });
  ok("sem resultado com filtro a mensagem é de filtro",
    R.requests(comFiltro).indexOf("Nenhuma request para estes filtros") !== -1);
}

console.log("\n▸ 8. Detalhe declara o que NÃO foi capturado");
{
  const base = {
    requestId: "r-1",
    servidor: null,
    navegador: [],
    eventoPrincipal: {
      method: "POST", endpoint: "/importar-base", page: "bases.html", status_code: 0,
      duration_ms: 30, event_type: "network-error", severity: "error", message: "Failed to fetch",
      data: {
        cancelada: true,
        request: { capturado: false, motivo: "corpo binário ou stream" },
        response: { capturado: false, truncado: true, motivo: "response não textual" },
      },
    },
    timeline: [],
    correlacao: { temServidor: false, temNavegador: true, completa: false, motivo: "sem registro no servidor" },
  };

  const html = R.drawer(estadoBase({ selecionado: { requestId: "r-1", detalhe: base }, abaDetalhe: "resumo" }));
  ok("payload truncado é declarado", html.indexOf("response truncada") !== -1);
  ok("response não capturada é declarada", html.indexOf("response não capturada") !== -1);
  ok("body não capturado é declarado", html.indexOf("body não capturado") !== -1);
  ok("request cancelada é declarada", html.indexOf("request cancelada") !== -1);
  ok("erro de rede é declarado", html.indexOf("erro de rede") !== -1);
  ok("log somente local é declarado", html.indexOf("log somente local") !== -1);
  ok("correlação incompleta é declarada", html.indexOf("correlação incompleta") !== -1);

  ok("reexecução é bloqueada fora de GET", html.indexOf("Reexecução só é liberada para GET") !== -1);

  const get = JSON.parse(JSON.stringify(base));
  get.servidor = { method: "GET", route: "/bases", path: "/bases", status_code: 200, duration_ms: 10, metadata: {}, created_at: new Date().toISOString() };
  const htmlGet = R.drawer(estadoBase({ selecionado: { requestId: "r-1", detalhe: get }, abaDetalhe: "resumo" }));
  ok("reexecução é liberada para GET sem parâmetro", htmlGet.indexOf('data-cc-action="test-get"') !== -1);
  ok("ações de cópia estão disponíveis",
    ["copy-request-id", "copy-endpoint", "copy-json", "copy-curl"].every((a) => htmlGet.indexOf('data-cc-action="' + a + '"') !== -1));
  ok("log persistido é declarado quando existe no servidor", htmlGet.indexOf("log persistido") !== -1);
}

console.log("\n▸ 9. Saúde separa configuração de teste");
{
  const saude = {
    statusGeral: "atencao",
    api: { status: "saudavel", uptimeSegundos: 7200, node: "v24", ambiente: "production", plataforma: "linux x64", horaServidor: new Date().toISOString(), versao: "abc123", memoria: { rssMb: 120, heapUsadoMb: 500, heapTotalMb: 600, sistemaLivreMb: 200 } },
    banco: { status: "falha", latenciaMs: null, erro: "ECONNREFUSED", pool: null },
    observabilidade: {
      habilitada: true, eventosNavegador: true, capturaStack: true, retencaoDias: 7, maxLinhas: 50000, slowMs: 1000,
      armazenamento: { requests: 10, client_events: 20, request_mais_antiga: new Date().toISOString() },
      fila: { pendentes: 5, descartados: 3, descartadosPorFila: 1, descartadosPorErro: 2, gravados: { requests: 10, clientEvents: 20 }, falhasConsecutivas: 2, ultimoErro: "sem conexão", ultimoFlushEm: new Date().toISOString() },
    },
    integracoes: [
      { id: "mercadolivre", nome: "Mercado Livre", variaveis: [{ nome: "ML_CLIENT_ID", presente: true }, { nome: "ML_CLIENT_SECRET", presente: false }], configuracao: "parcial", testavel: true, teste: "nao_testado", nota: null },
      { id: "ia", nome: "IA (Anthropic)", variaveis: [{ nome: "ANTHROPIC_API_KEY", presente: true }], configuracao: "configurado", testavel: false, teste: "nao_testado", nota: "Teste ativo não executado: chamada à API é cobrada." },
    ],
  };

  const html = R.health(estadoBase({ view: "health", saude: saude, testesSaude: null }));
  ok("o aviso de configuração ≠ saúde está visível", html.indexOf("Configuração presente ≠ integração saudável") !== -1);
  ok("banco em falha é marcado", html.indexOf("ECONNREFUSED") !== -1);
  ok("pool indisponível não vira zero fake", html.indexOf("indisponivel") !== -1 || html.indexOf("indisponível") !== -1);
  ok("descartes da fila aparecem", html.indexOf("1 por fila cheia") !== -1);
  ok("integração parcial é distinguida", html.indexOf("parcial") !== -1);
  ok("variável ausente é marcada como ausente", html.indexOf("ML_CLIENT_SECRET: ausente") !== -1);
  ok("nunca testado é dito explicitamente", html.indexOf("não testado nesta sessão") !== -1);
  ok("integração sem teste ativo explica o porquê", html.indexOf("chamada à API é cobrada") !== -1);
  ok("botão de teste por integração existe", html.indexOf('data-cc-health-check="mercadolivre"') !== -1);
  ok("integração não testável não ganha botão", html.indexOf('data-cc-health-check="ia"') === -1);

  const comTeste = R.health(estadoBase({
    view: "health", saude: saude,
    testesSaude: { resultados: { mercadolivre: { resultado: "falhou", detalhe: "GET /sites/MLB → HTTP 500", latenciaMs: 900, executadoEm: new Date().toISOString() } } },
  }));
  ok("resultado do teste ativo substitui o 'não testado'", comTeste.indexOf("GET /sites/MLB → HTTP 500") !== -1);
}

console.log("\n▸ 10. Rotas degradam com honestidade");
{
  const html = R.routes(estadoBase({
    view: "routes",
    rotas: { ok: false, motivo: "introspecção do Express indisponível nesta versão", rotas: [] },
  }));
  ok("inventário indisponível é declarado", html.indexOf("Inventário indisponível") !== -1);
  ok("o motivo real é mostrado", html.indexOf("introspecção do Express indisponível") !== -1);
  ok("nada é inventado no lugar", html.indexOf("<table") === -1);

  const comRotas = R.routes(estadoBase({
    view: "routes",
    rotas: { ok: true, total: 2, rotas: [
      { metodo: "GET", caminho: "/bases", area: "bases", autenticacao: "sim", adminOnly: "nao", middlewares: ["authMiddleware"], introspeccao: "ok" },
      { metodo: "GET", caminho: "/x/:id", area: "x", autenticacao: "desconhecido", adminOnly: "desconhecido", middlewares: [], introspeccao: "parcial" },
    ] },
    rotasStats: [{ rota: "/bases", method: "GET", total: 40, erros: 12, lentas: 2, media: 300, p95: 900, ultima: new Date().toISOString() }],
  }));
  ok("estatísticas reais casam com a rota", comRotas.indexOf("12 (30%)") !== -1);
  ok("rota com muito erro é destacada", comRotas.indexOf("row--danger") !== -1);
  ok("rota sem estatística mostra travessão, não zero", comRotas.indexOf("<td class=\"num\">—</td>") !== -1);
  ok("auth desconhecida é dita como desconhecida", comRotas.indexOf("desconhecido") !== -1);
  ok("GET sem parâmetro ganha botão de teste", comRotas.indexOf('data-cc-action="test-get"') !== -1);
  ok("rota com :param NÃO ganha botão de teste", comRotas.split('data-cc-action="test-get"').length - 1 === 1);
}

console.log("\n▸ 11. Ferramentas: playground só GET");
{
  const html = R.tools(estadoBase({ view: "tools", saude: null }));
  ok("playground aceita GET", html.indexOf('data-cc-action="playground-run"') !== -1);
  ["POST", "PUT", "PATCH", "DELETE"].forEach((metodo) => {
    ok(`${metodo} aparece desabilitado`, new RegExp(">" + metodo + "</button>").test(html) && html.indexOf("disabled") !== -1);
  });
  ok("o motivo do bloqueio é explicado", html.indexOf("corromper dados de produção") !== -1);
  ok("as duas limpezas são separadas", html.indexOf("limpar cache local do navegador") !== -1 && html.indexOf("excluir histórico do servidor") !== -1);
  ok("o aviso de irreversibilidade existe", html.indexOf("não tem desfazer") !== -1);
  ok("o relatório de bug promete não incluir segredo", html.indexOf("Token, senha e payload sensível nunca entram") !== -1);
  ok("nenhuma parte da tela imprime o token", html.indexOf("assinaturaSecreta") === -1);
}

console.log("\n▸ 12. Marcações locais de erro");
{
  S.marcarErro("assinatura-1", "investigando");
  ok("marcação é gravada", S.lerMarcacoes()["assinatura-1"].situacao === "investigando");
  S.marcarErro("assinatura-1", null);
  ok("marcação é removida", S.lerMarcacoes()["assinatura-1"] === undefined);

  S.marcarErro("assinatura-2", "resolvido");
  const html = R.errors(estadoBase({
    view: "errors",
    erros: { grupos: [{ origem: "browser", tipo: "js-error", mensagem: "boom", rota: "dashboard.html", metodo: "-", status: null, total: 2, usuarios: 1, primeira: new Date().toISOString(), ultima: new Date().toISOString(), ultimoRequestId: null, stack: null, severidade: "alta", assinatura: "assinatura-2" }], total: 1 },
  }));
  ok("grupo marcado recebe a classe local", html.indexOf("is-resolvido") !== -1);
  ok("o painel avisa que a marcação é local", html.indexOf("marcações abaixo são locais") !== -1);
  ok("a cópia deixa claro que não vira issue no GitHub", html.indexOf("nem issue no GitHub") !== -1);
  ok("não existe integração real com o GitHub", html.indexOf("github.com") === -1);
  ok("grupo sem request id não oferece inspeção falsa", html.indexOf("sem request id") !== -1 || html.indexOf("data-cc-request") === -1);
  S.marcarErro("assinatura-2", null);
}

console.log(`\n${passou} verificações passaram. Control Center (front) OK.\n`);
