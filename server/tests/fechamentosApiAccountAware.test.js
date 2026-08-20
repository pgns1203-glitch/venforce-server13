// server/tests/fechamentosApiAccountAware.test.js
//
// M8 — Frontend account-aware (Portal/fechamentos-api.js).
//
// Portal/fechamentos-api.js é um script de browser sem module.exports (ver
// docs/CENTRAL_VENDAS_V3_ARQUITETURA.md seção 9.6, mesma limitação já
// registrada no hardening M1/M2 para este mesmo arquivo). Este teste carrega
// o arquivo REAL num contexto `vm` com um DOM/localStorage/fetch mínimos —
// não simula eventos de clique: chama as funções de wiring diretamente
// (trocarContexto/onContaChange/executarSincronizacao/pollSyncRun/
// retomarSyncEmAndamento/executarImportacao), que é o que os listeners de
// wireStatic() acabam chamando. Funções top-level (`function foo(){}`) viram
// propriedades do objeto global do contexto vm — acessíveis depois de
// carregar o script. `F` é `const` (não vira propriedade global sozinho),
// então um segundo script minúsculo o expõe via `this.__F = F`.
//
// GET /operacao/central-vendas/:slug é sempre mockado para responder
// { ok:false } — isso evita exercitar toda a renderização pesada de
// payload (fora do escopo deste teste, que é só wiring de conta) sem
// esconder nada: renderAll() já trata "!F.rawPayload?.ok" como um estado
// leve (branch 3), nunca chamando renderFechamentoSection/renderOrdersPanel.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

let checks = 0;
function ok(label, cond) { assert.ok(cond, `FALHOU: ${label}`); checks += 1; }
function eq(label, actual, expected) {
  assert.deepStrictEqual(actual, expected, `FALHOU: ${label} — recebido ${JSON.stringify(actual)}, esperado ${JSON.stringify(expected)}`);
  checks += 1;
}

function criarElementoGenerico() {
  const attrs = {};
  const classes = new Set();
  return {
    hidden: false, value: "", disabled: false, _html: "", _text: "",
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = v == null ? "" : String(v); },
    get textContent() { return this._text; },
    set textContent(v) { this._text = v == null ? "" : String(v); },
    dataset: {},
    classList: {
      add: (...ns) => ns.forEach((n) => classes.add(n)),
      remove: (...ns) => ns.forEach((n) => classes.delete(n)),
      toggle: (n, force) => { if (force === undefined) { classes.has(n) ? classes.delete(n) : classes.add(n); } else if (force) classes.add(n); else classes.delete(n); },
      contains: (n) => classes.has(n),
    },
    setAttribute(k, v) { attrs[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null; },
    removeAttribute(k) { delete attrs[k]; },
    addEventListener() {}, removeEventListener() {},
    appendChild() {}, focus() {}, click() {},
    closest: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
  };
}

function criarDocumentoMock() {
  const cache = new Map();
  return {
    getElementById(id) {
      if (!cache.has(id)) cache.set(id, criarElementoGenerico());
      return cache.get(id);
    },
    body: criarElementoGenerico(),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {},
    _cache: cache,
  };
}

function criarLocalStorageMock(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
}

// Fetch mock: roteia por prefixo de URL, registra toda chamada (URL + init)
// em `log` para asserções, e responde conforme `handlers` (ordenados —
// primeiro prefixo que casa vence). Cada teste monta seus próprios handlers.
function serializeBody(body) {
  if (body && typeof body.entries === 'function' && typeof body.append === 'function') {
    // FormData: representa como "chave=valor;chave2=valor2" para asserções simples.
    return Array.from(body.entries()).map(([k, v]) => `${k}=${v}`).join(';');
  }
  return body ? String(body) : null;
}

function criarFetchMock(handlers, log) {
  return async function fetchMock(url, init = {}) {
    log.push({ url: String(url), method: init.method || 'GET', body: serializeBody(init.body), signal: init.signal || null });
    // Casa pelo ÚLTIMO handler cujo prefixo aparece na URL (não o primeiro):
    // rotas mais específicas (ex.: /sync-runs) são substring de uma rota
    // mais genérica (/operacao/central-vendas/) — a convenção nestes testes
    // é listar handlers do mais genérico para o mais específico.
    let melhor = null;
    for (const [prefix, handler] of handlers) {
      if (String(url).includes(prefix)) melhor = handler;
    }
    if (melhor) return melhor(url, init);
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
}

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
}

// Roteia as 3 formas de /sync-runs (criar via POST, listar via GET ?query,
// pollar 1 run via GET /sync-runs/:id) sem depender de ordem de prefixo —
// registrado sob o único prefixo "/sync-runs" (ver criarFetchMock: último
// handler cujo prefixo aparece na URL vence, então isto precisa vir DEPOIS
// do handler genérico de /operacao/central-vendas/ na lista de handlers).
function syncRunsHandler({ onCreate, onPoll, onList }) {
  return (url, init) => {
    const u = String(url);
    if (init.method === "POST") return onCreate(u, init);
    if (/\/sync-runs\/\d+/.test(u)) return onPoll(u, init);
    return onList(u, init);
  };
}

const SRC = fs.readFileSync(path.join(__dirname, "..", "..", "Portal", "fechamentos-api.js"), "utf8");

function bootScript({ handlers = [], log = [], token = "tok-teste" } = {}) {
  const sandbox = {
    console,
    setTimeout, clearTimeout,
    URLSearchParams, AbortController,
    FormData: global.FormData,
    document: criarDocumentoMock(),
    window: { location: { replace() {} } },
    localStorage: criarLocalStorageMock({ "vf-token": token }),
    fetch: criarFetchMock(handlers, log),
    CSS: { escape: (s) => String(s) },
    requestAnimationFrame: (cb) => cb(),
  };
  vm.createContext(sandbox);
  new vm.Script(SRC, { filename: "fechamentos-api.js" }).runInContext(sandbox);
  // F é const (não vira propriedade global) — expõe por referência. As
  // funções (function declarations) já viram propriedades do sandbox.
  new vm.Script("this.__F = F;", { filename: "expose-F.js" }).runInContext(sandbox);
  return sandbox;
}

async function flush() {
  // Deixa promises pendentes (fetch mock + .then encadeados) resolverem.
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

async function run() {
  // ── 1 conta: auto-seleciona e as chamadas levam seu id ──
  {
    const log = [];
    const contas = [{ id: 501, nome: "ML Loja A", marketplace: "meli", is_primary: true, ativo: true }];
    const sandbox = bootScript({
      log,
      handlers: [
        ["/contas?marketplace=meli", () => jsonResponse(200, { ok: true, contas })],
        ["/operacao/central-vendas/", () => jsonResponse(200, { ok: false, erro: "sem dados neste teste" })],
        ["/sync-runs", () => jsonResponse(202, { ok: true, run: { id: 1, status: "queued" } })],
      ],
    });
    const F = sandbox.__F;
    F.cliente = { id: 1, nome: "Cliente A", slug: "cliente-a" };
    F.periodo = { mode: "mes_atual", dateFrom: "2026-08-01", dateTo: "2026-08-31" };

    await sandbox.trocarContexto();
    await flush();

    eq("1conta: F.contas tem 1 conta", F.contas.length, 1);
    ok("1conta: auto-selecionada", F.clienteConta?.id === 501);
    const getCall = log.find((c) => c.url.includes("/operacao/central-vendas/cliente-a?"));
    ok("1conta: GET central-vendas foi chamado", !!getCall);
    ok("1conta: GET leva clienteContaId=501", getCall.url.includes("clienteContaId=501"));
    console.log("  ✓ 1 conta: auto-seleciona e as chamadas levam seu id");
  }

  // ── 2 contas: exige escolha; nenhum GET/sync é disparado para conta arbitrária ──
  {
    const log = [];
    const contas = [
      { id: 10, nome: "ML 1", marketplace: "meli", is_primary: true, ativo: true },
      { id: 11, nome: "ML 2", marketplace: "meli", is_primary: false, ativo: true },
    ];
    const sandbox = bootScript({
      log,
      handlers: [
        ["/contas?marketplace=meli", () => jsonResponse(200, { ok: true, contas })],
        ["/operacao/central-vendas/", () => jsonResponse(200, { ok: false, erro: "nao deveria ser chamado" })],
      ],
    });
    const F = sandbox.__F;
    F.cliente = { id: 1, nome: "Cliente A", slug: "cliente-a" };
    F.periodo = { mode: "mes_atual", dateFrom: "2026-08-01", dateTo: "2026-08-31" };

    await sandbox.trocarContexto();
    await flush();

    eq("2contas: F.contas tem 2", F.contas.length, 2);
    eq("2contas: nenhuma conta pré-selecionada (nunca contas[0])", F.clienteConta, null);
    const getCall = log.find((c) => c.url.includes("/operacao/central-vendas/cliente-a?"));
    ok("2contas: GET NUNCA disparado sem escolha explicita", !getCall);

    // Tentar sincronizar/importar sem conta escolhida também não deve chamar o backend financeiro.
    await sandbox.executarSincronizacao();
    await flush();
    const syncCall = log.find((c) => c.url.includes("/sync-runs") && c.method === "POST");
    ok("2contas: POST /sync-runs NUNCA disparado sem conta escolhida", !syncCall);

    console.log("  ✓ 2 contas: exige escolha explícita, nenhum GET/sync dispara para conta arbitrária");
  }

  // ── troca A→B: resposta atrasada de A não substitui B ──
  {
    const log = [];
    const contas = [
      { id: 10, nome: "ML A", marketplace: "meli", is_primary: true, ativo: true },
      { id: 11, nome: "ML B", marketplace: "meli", is_primary: false, ativo: true },
    ];
    let resolveA;
    const pendenteA = new Promise((r) => { resolveA = r; });
    const sandbox = bootScript({
      log,
      handlers: [
        ["/contas?marketplace=meli", () => jsonResponse(200, { ok: true, contas })],
        ["/operacao/central-vendas/", async (url) => {
          if (url.includes("clienteContaId=10")) { await pendenteA; return jsonResponse(200, { ok: true, motor: { status: "persistido" }, resumo: {}, produtos: {}, pedidos: [], periodo: {}, cliente: {}, dono: "A" }); }
          return jsonResponse(200, { ok: true, motor: { status: "persistido" }, resumo: {}, produtos: {}, pedidos: [], periodo: {}, cliente: {}, dono: "B" });
        }],
      ],
    });
    const F = sandbox.__F;
    F.cliente = { id: 1, nome: "Cliente A", slug: "cliente-a" };
    F.periodo = { mode: "mes_atual", dateFrom: "2026-08-01", dateTo: "2026-08-31" };
    await sandbox.trocarContexto();
    await flush();
    eq("trocaAB: 2 contas, nenhuma selecionada ainda", F.clienteConta, null);

    sandbox.onContaChange("10"); // dispara GET(A) que fica pendente (pendenteA)
    await flush();
    ok("trocaAB: conta A selecionada", F.clienteConta?.id === 10);

    sandbox.onContaChange("11"); // troca para B ANTES de A responder
    await flush();
    ok("trocaAB: conta B selecionada", F.clienteConta?.id === 11);
    eq("trocaAB: payload apos B ja resolvido e o de B", F.rawPayload?.dono, "B");

    resolveA(); // A finalmente responde
    await flush();
    eq("trocaAB: resposta atrasada de A NUNCA sobrescreve B", F.rawPayload?.dono, "B");
    eq("trocaAB: conta continua B", F.clienteConta?.id, 11);
    console.log("  ✓ troca A→B: resposta atrasada de A não substitui B");
  }

  // ── sync: POST /sync-runs recebe a conta correta ──
  {
    const log = [];
    const contas = [{ id: 77, nome: "ML Unica", marketplace: "meli", is_primary: true, ativo: true }];
    const sandbox = bootScript({
      log,
      handlers: [
        ["/contas?marketplace=meli", () => jsonResponse(200, { ok: true, contas })],
        ["/operacao/central-vendas/", () => jsonResponse(200, { ok: false })],
        ["/sync-runs", syncRunsHandler({
          onCreate: () => jsonResponse(202, { ok: true, run: { id: 555, status: "queued" } }),
          onPoll: () => jsonResponse(200, { ok: true, run: { id: 555, status: "queued" }, sources: [] }),
          onList: () => jsonResponse(200, { ok: true, runs: [] }),
        })],
      ],
    });
    const F = sandbox.__F;
    F.cliente = { id: 1, nome: "Cliente A", slug: "cliente-a" };
    F.periodo = { mode: "mes_atual", dateFrom: "2026-08-01", dateTo: "2026-08-31" };
    await sandbox.trocarContexto();
    await flush();

    await sandbox.executarSincronizacao();
    await flush();
    const post = log.find((c) => c.url.includes("/sync-runs") && c.method === "POST");
    ok("sync: POST /sync-runs disparado", !!post);
    const body = JSON.parse(post.body);
    eq("sync: body leva clienteContaId correto", body.clienteContaId, 77);
    eq("sync: F.sync.clienteContaId gravado", F.sync.clienteContaId, 77);
    sandbox.pararPollingSync(); // limpa o timer real de retry (poll fica "queued" de propósito)
    console.log("  ✓ sync: POST /sync-runs recebe a conta correta");
  }

  // ── retomada: listagem usa clienteContaId + período ──
  {
    const log = [];
    const contas = [
      { id: 10, nome: "ML A", marketplace: "meli", is_primary: true, ativo: true },
      { id: 11, nome: "ML B", marketplace: "meli", is_primary: false, ativo: true },
    ];
    const sandbox = bootScript({
      log,
      handlers: [
        ["/contas?marketplace=meli", () => jsonResponse(200, { ok: true, contas })],
        ["/operacao/central-vendas/", () => jsonResponse(200, { ok: false })],
        ["/sync-runs", syncRunsHandler({
          onCreate: () => jsonResponse(202, { ok: true, run: { id: 999, status: "queued" } }),
          onPoll: () => jsonResponse(200, { ok: true, run: { id: 999, status: "running" }, sources: [] }),
          onList: () => jsonResponse(200, { ok: true, runs: [{ id: 999, status: "running" }] }),
        })],
      ],
    });
    const F = sandbox.__F;
    F.cliente = { id: 1, nome: "Cliente A", slug: "cliente-a" };
    F.periodo = { mode: "mes_atual", dateFrom: "2026-08-01", dateTo: "2026-08-31" };
    await sandbox.trocarContexto();
    await flush();
    sandbox.onContaChange("11");
    await flush();

    const listagem = log.find((c) => c.url.includes("/sync-runs?"));
    ok("retomada: GET /sync-runs (listagem) chamado", !!listagem);
    ok("retomada: leva clienteContaId=11", listagem.url.includes("clienteContaId=11"));
    ok("retomada: leva dateFrom/dateTo do periodo aberto", listagem.url.includes("dateFrom=2026-08-01") && listagem.url.includes("dateTo=2026-08-31"));
    eq("retomada: F.sync aponta pro run retomado da conta certa", F.sync.runId, 999);
    eq("retomada: F.sync.clienteContaId == conta ativa", F.sync.clienteContaId, 11);
    sandbox.pararPollingSync(); // limpa o timer real de retry (poll fica "running" de propósito)
    console.log("  ✓ retomada: listagem/retomada usa clienteContaId + período");
  }

  // ── importação: envia a conta correta ──
  {
    const log = [];
    const contas = [{ id: 42, nome: "ML Unica", marketplace: "meli", is_primary: true, ativo: true }];
    const sandbox = bootScript({
      log,
      handlers: [
        ["/contas?marketplace=meli", () => jsonResponse(200, { ok: true, contas })],
        ["/operacao/central-vendas/", (url) => (url.includes("importar-vendas") ? jsonResponse(201, { ok: true, pedidosPersistidos: 3 }) : jsonResponse(200, { ok: false }))],
      ],
    });
    const F = sandbox.__F;
    F.cliente = { id: 1, nome: "Cliente A", slug: "cliente-a" };
    F.periodo = { mode: "mes_atual", dateFrom: "2026-08-01", dateTo: "2026-08-31" };
    await sandbox.trocarContexto();
    await flush();
    F.arquivoImport = { name: "vendas.xlsx" }; // FormData real aceita qualquer Blob-like em teste sem File real
    await sandbox.executarImportacao();
    await flush();

    const post = log.find((c) => c.url.includes("importar-vendas"));
    ok("import: POST importar-vendas chamado", !!post);
    ok("import: body (FormData) contem clienteContaId=42", String(post.body).includes("42"));
    console.log("  ✓ importação: envia a conta correta");
  }

  // ── legado: cliente sem cliente_contas continua funcionando (clienteContaId nunca enviado) ──
  {
    const log = [];
    const sandbox = bootScript({
      log,
      handlers: [
        ["/contas?marketplace=meli", () => jsonResponse(200, { ok: true, contas: [] })],
        ["/operacao/central-vendas/", () => jsonResponse(200, { ok: true, motor: { status: "persistido" }, resumo: {}, produtos: {}, pedidos: [], periodo: {}, cliente: {} })],
      ],
    });
    const F = sandbox.__F;
    F.cliente = { id: 9, nome: "Cliente Legado", slug: "cliente-legado" };
    F.periodo = { mode: "mes_atual", dateFrom: "2026-08-01", dateTo: "2026-08-31" };
    await sandbox.trocarContexto();
    await flush();

    eq("legado: 0 contas", F.contas.length, 0);
    eq("legado: nenhuma conta selecionada", F.clienteConta, null);
    const getCall = log.find((c) => c.url.includes("/operacao/central-vendas/cliente-legado?"));
    ok("legado: GET ainda e chamado normalmente (fallback do backend)", !!getCall);
    ok("legado: clienteContaId NUNCA enviado", !getCall.url.includes("clienteContaId"));
    ok("legado: payload carregado com sucesso", F.rawPayload?.ok === true);
    console.log("  ✓ legado: cliente sem cliente_contas continua funcionando, sem enviar clienteContaId");
  }

  console.log(`fechamentosApiAccountAware.test.js: ${checks} verificacoes OK`);
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
