// server/tests/observabilityCollector.test.js
// Executa o coletor REAL do navegador (Portal/vf-debug-client.js) dentro do
// Node, com um shim mínimo de DOM. Não é um teste "de string": o arquivo é
// carregado e exercitado de verdade.
//
// O que isto protege:
//  - a response original NUNCA é consumida pelo coletor (regressão que
//    quebraria toda tela que faz .json() depois do fetch);
//  - headers de correlação são anexados sem alterar a chamada;
//  - erros de rede, JS e promises rejeitadas viram evento;
//  - o histórico passa de 100 registros e sobrevive ao "reload";
//  - nenhum token entra no evento gravado.
//
// Roda sem infra: node tests/observabilityCollector.test.js

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

/* ============================================================
 * SHIM DE NAVEGADOR
 * ============================================================ */

function criarStorage() {
  const dados = new Map();
  return {
    getItem: (k) => (dados.has(String(k)) ? dados.get(String(k)) : null),
    setItem: (k, v) => { dados.set(String(k), String(v)); },
    removeItem: (k) => { dados.delete(String(k)); },
    clear: () => dados.clear(),
    get length() { return dados.size; },
  };
}

const ouvintesJanela = {};

globalThis.window = globalThis;
globalThis.localStorage = criarStorage();
globalThis.sessionStorage = criarStorage();
globalThis.location = {
  href: "http://portal.local/dashboard.html",
  pathname: "/dashboard.html",
  search: "",
  origin: "http://portal.local",
};
globalThis.innerWidth = 1440;
globalThis.innerHeight = 900;
globalThis.document = {
  referrer: "",
  visibilityState: "visible",
  readyState: "complete",
  addEventListener() {},
  removeEventListener() {},
  querySelector() { return null; },
  createElement() { return { style: {}, dataset: {}, setAttribute() {}, click() {} }; },
  head: { appendChild() {} },
  body: { appendChild() {}, removeChild() {} },
  documentElement: { appendChild() {} },
};
globalThis.addEventListener = (tipo, fn) => {
  (ouvintesJanela[tipo] = ouvintesJanela[tipo] || []).push(fn);
};
globalThis.removeEventListener = () => {};
globalThis.dispatchEvent = (evento) => {
  (ouvintesJanela[evento.type] || []).forEach((fn) => fn(evento));
  return true;
};

// BroadcastChannel existe no Node e seguraria o event loop. Removendo, também
// exercitamos o caminho de fallback (sinal por localStorage).
delete globalThis.BroadcastChannel;

// indexedDB não existe no Node: o coletor deve cair no armazenamento em
// memória em vez de quebrar.
assert.strictEqual(typeof globalThis.indexedDB, "undefined", "shim assume Node sem indexedDB");

/* ── fetch controlado ─────────────────────────────────────────────────────── */

const chamadasFetch = [];
let respostaProgramada = null;
let erroProgramado = null;

function respostaJson(corpo, opcoes = {}) {
  return new Response(JSON.stringify(corpo), {
    status: opcoes.status || 200,
    headers: Object.assign({ "content-type": "application/json" }, opcoes.headers || {}),
  });
}

globalThis.fetch = async function fetchFalso(input, init) {
  const url = input && input.url ? input.url : String(input);
  const headers = {};
  const fonte = (init && init.headers) || (input && input.headers) || null;
  if (fonte && typeof fonte.forEach === "function") {
    fonte.forEach((valor, chave) => { headers[chave.toLowerCase()] = valor; });
  } else if (fonte) {
    Object.keys(fonte).forEach((chave) => { headers[chave.toLowerCase()] = fonte[chave]; });
  }
  chamadasFetch.push({ url, metodo: (init && init.method) || "GET", headers, body: init && init.body });

  if (erroProgramado) {
    const erro = erroProgramado;
    erroProgramado = null;
    throw erro;
  }
  const resposta = respostaProgramada || respostaJson({ ok: true, bases: [{ slug: "loja" }] }, {
    headers: { "x-request-id": "servidor-req-001" },
  });
  respostaProgramada = null;
  return resposta;
};

/* ── sessão de admin com debug ligado e sync desligado ────────────────────── */

localStorage.setItem("vf-user", JSON.stringify({ id: 1, nome: "Admin", email: "admin@venforce.com", role: "admin" }));
localStorage.setItem("vf-token", "eyJhbGciOiJIUzI1NiJ9.eyJpZCI6MX0.assinaturaSecreta");
localStorage.setItem("vf-debug-enabled", "true");
localStorage.setItem("vf-debug-config", JSON.stringify({ sync: false, captureConsole: false }));
localStorage.setItem("vf-api-base", "https://api.teste.local");

// Registro no formato ANTIGO (sessionStorage), para testar a migração.
sessionStorage.setItem("vf-debug-logs", JSON.stringify([{
  id: "antigo-1", timestamp: new Date(Date.now() - 60000).toISOString(), screen: "bases.html",
  method: "GET", endpoint: "/bases", status: 500, duration: 900, description: "erro antigo",
}]));

/* ── carga do coletor real ────────────────────────────────────────────────── */

const caminhoColetor = path.join(__dirname, "..", "..", "Portal", "vf-debug-client.js");
vm.runInThisContext(fs.readFileSync(caminhoColetor, "utf8"), { filename: caminhoColetor });

const VF = globalThis.VFDebugClient;
const proximoTick = () => new Promise((resolve) => setTimeout(resolve, 15));

async function principal() {
  console.log("\n▸ 1. Boot do coletor");
  {
    ok("coletor expõe a API", VF && VF.version === "2.0.0");
    ok("coletor está ativo (admin + token + flag)", VF.isActive() === true);
    ok("fetch foi interceptado", typeof globalThis.fetch === "function" && globalThis.fetch.__vfDebugWrapped === true);

    await proximoTick();
    const runtime = VF.getRuntimeInfo();
    ok("sem IndexedDB o coletor declara o fallback", runtime.indexedDb === "indisponivel");
    ok("sem BroadcastChannel o coletor declara o fallback", runtime.broadcastChannel === false);
    ok("session id é gerado e persistido", /^s-/.test(runtime.sessionId));
    ok("tab id é distinto do session id", /^t-/.test(runtime.tabId) && runtime.tabId !== runtime.sessionId);
    ok("page load id é distinto da aba", /^p-/.test(runtime.pageLoadId) && runtime.pageLoadId !== runtime.tabId);
    ok("API base respeita o override local", runtime.apiBase === "https://api.teste.local");
    ok("limite de eventos é 1000, não 100", runtime.limiteEventos === 1000);
  }

  console.log("\n▸ 2. Migração do storage antigo (vf-debug-logs)");
  {
    await proximoTick();
    const eventos = await VF.getEvents({ limit: 500 });
    const legado = eventos.find((e) => e.eventId === "legacy-antigo-1");
    ok("registro antigo foi migrado", !!legado);
    ok("registro migrado mantém endpoint e status", legado.endpoint === "/bases" && legado.statusCode === 500);
    ok("registro migrado não é reenviado ao servidor (sem request id)", legado.synced === 1);
    ok("o storage antigo foi esvaziado", sessionStorage.getItem("vf-debug-logs") === null);
    ok("a chave antiga não volta a ser usada", localStorage.getItem("vf-debug-logs") === null);
  }

  console.log("\n▸ 3. A response original NUNCA é consumida");
  {
    const antes = (await VF.getEvents({ limit: 500 })).length;
    const resposta = await fetch("https://api.teste.local/bases");

    // Este é o teste que impede a regressão mais cara possível: se o coletor
    // ler o corpo da response original, TODA tela do Portal quebra.
    ok("bodyUsed continua falso após a interceptação", resposta.bodyUsed === false);
    const corpo = await resposta.json();
    ok("a tela consegue ler o JSON normalmente", corpo.ok === true && corpo.bases[0].slug === "loja");
    ok("o status chega intacto", resposta.status === 200);

    await proximoTick();
    const eventos = await VF.getEvents({ limit: 500 });
    ok("a request virou evento", eventos.length > antes);

    const evento = eventos.find((e) => e.eventType === "request" && e.endpoint === "/bases");
    ok("evento tem método e endpoint", evento.method === "GET" && evento.endpoint === "/bases");
    ok("evento tem status", evento.statusCode === 200);
    ok("evento tem duração medida", typeof evento.durationMs === "number" && evento.durationMs >= 0);
    ok("evento tem tela de origem", evento.page === "dashboard.html");
    ok("o coletor capturou a response por CLONE", evento.data.response.capturado === true);
    ok("o corpo clonado foi sanitizado e guardado", evento.data.response.corpo.ok === true);
  }

  console.log("\n▸ 4. Headers de correlação");
  {
    const ultima = chamadasFetch[chamadasFetch.length - 1];
    ok("X-Request-Id é enviado", !!ultima.headers["x-request-id"]);
    ok("X-VF-Debug-Session é enviado", ultima.headers["x-vf-debug-session"] === VF.ids.sessionId);
    ok("X-VF-Debug-Tab é enviado", ultima.headers["x-vf-debug-tab"] === VF.ids.tabId);

    const eventos = await VF.getEvents({ limit: 500 });
    const evento = eventos.find((e) => e.eventType === "request" && e.endpoint === "/bases");
    ok("o request id do SERVIDOR vira a chave de correlação", evento.requestId === "servidor-req-001");
    ok("o id do cliente fica registrado para auditoria", evento.data.requestIdCliente === ultima.headers["x-request-id"]);
    ok("a correlação é declarada", evento.data.correlacionado === true);
  }

  console.log("\n▸ 5. Nada de token nos eventos");
  {
    respostaProgramada = respostaJson({ ok: false, erro: "Token inválido ou expirado" }, { status: 401 });
    await fetch("https://api.teste.local/operacao/cliente-360/alpha?access_token=eyJhbGciOiJIUzI1NiJ9.eyJhIjoxfQ.zzz", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.eyJpZCI6MX0.assinaturaSecreta",
        "x-api-key": "vf_" + "d".repeat(32),
      },
      body: JSON.stringify({ senha: "minha-senha-123", password: "outra", cliente: "alpha", margem: 0.18 }),
    }).catch(() => {});

    await proximoTick();
    const eventos = await VF.getEvents({ limit: 500 });
    const evento = eventos.find((e) => e.endpoint && e.endpoint.indexOf("cliente-360") !== -1);
    const serializado = JSON.stringify(evento);

    ok("evento 401 foi registrado", evento && evento.statusCode === 401);
    ok("severidade de 4xx é warn", evento.severity === "warn");
    ok("Authorization não aparece", serializado.indexOf("assinaturaSecreta") === -1);
    ok("nenhum JWT aparece", serializado.indexOf("eyJ") === -1);
    ok("x-api-key não aparece", serializado.indexOf("vf_dddd") === -1);
    ok("senha no body não aparece", serializado.indexOf("minha-senha-123") === -1);
    ok("password no body não aparece", serializado.indexOf('"outra"') === -1);
    ok("access_token na URL não aparece", evento.endpoint.indexOf("eyJ") === -1);
    ok("contexto útil sobrevive", evento.data.request.cliente === "alpha" && evento.data.request.margem === 0.18);
    ok("a mensagem de erro do servidor sobrevive", serializado.indexOf("Token inválido ou expirado") !== -1);
  }

  console.log("\n▸ 6. Falha de rede");
  {
    erroProgramado = new TypeError("Failed to fetch");
    let lancou = false;
    try {
      await fetch("https://api.teste.local/metricas/resumo");
    } catch (e) {
      lancou = true;
      ok("o erro continua chegando à tela (não é engolido)", e.message === "Failed to fetch");
    }
    ok("o fetch rejeitou como rejeitaria sem o coletor", lancou === true);

    await proximoTick();
    const eventos = await VF.getEvents({ limit: 500 });
    const evento = eventos.find((e) => e.eventType === "network-error");
    ok("falha de rede virou evento", !!evento);
    ok("status 0 marca ausência de resposta HTTP", evento.statusCode === 0);
    ok("severidade é erro", evento.severity === "error");
    ok("a causa provável é explicada", typeof evento.data.causaProvavel === "string");
  }

  console.log("\n▸ 7. Requests canceladas e responses não textuais");
  {
    const abortError = new Error("The operation was aborted");
    abortError.name = "AbortError";
    erroProgramado = abortError;
    await fetch("https://api.teste.local/ads/relatorio").catch(() => {});
    await proximoTick();

    let eventos = await VF.getEvents({ limit: 500 });
    const cancelada = eventos.find((e) => e.data && e.data.cancelada === true);
    ok("request cancelada é distinguida de erro de rede", !!cancelada && cancelada.severity === "warn");

    respostaProgramada = new Response("PNG-BINARIO", {
      status: 200, headers: { "content-type": "image/png" },
    });
    await fetch("https://api.teste.local/imagem.png");
    await proximoTick();

    eventos = await VF.getEvents({ limit: 500 });
    const binaria = eventos.find((e) => e.endpoint === "/imagem.png");
    ok("response binária não é convertida em texto", binaria.data.response.capturado === false);
    ok("o motivo da não captura é explícito", binaria.data.response.motivo === "response não textual");

    respostaProgramada = new Response(JSON.stringify({ grande: true }), {
      status: 200, headers: { "content-type": "application/json", "content-length": "900000" },
    });
    await fetch("https://api.teste.local/relatorio-gigante");
    await proximoTick();

    eventos = await VF.getEvents({ limit: 500 });
    const gigante = eventos.find((e) => e.endpoint === "/relatorio-gigante");
    ok("response acima do limite não é serializada", gigante.data.response.capturado === false);
    ok("o truncamento é declarado", gigante.data.response.truncado === true);
    ok("o tamanho conhecido é registrado", gigante.data.response.bytes === 900000);
  }

  console.log("\n▸ 8. A própria observabilidade não é capturada");
  {
    const antes = (await VF.getEvents({ limit: 1000 })).length;
    await fetch("https://api.teste.local/admin/observability/client-events", { method: "POST", body: "{}" });
    await proximoTick();
    const depois = (await VF.getEvents({ limit: 1000 })).length;
    ok("chamadas de observabilidade não geram evento (sem recursão)", depois === antes);
  }

  console.log("\n▸ 9. Erros de JavaScript e promises rejeitadas");
  {
    const erroJs = new Error("Cannot read properties of undefined (reading 'slug')");
    globalThis.dispatchEvent({
      type: "error",
      message: erroJs.message,
      filename: "http://portal.local/dashboard.js",
      lineno: 42,
      colno: 7,
      error: erroJs,
      target: globalThis,
    });

    globalThis.dispatchEvent({
      type: "unhandledrejection",
      reason: new Error("Falha ao carregar cliente 360"),
    });

    await proximoTick();
    const eventos = await VF.getEvents({ limit: 500 });

    const js = eventos.find((e) => e.eventType === "js-error");
    ok("erro de JavaScript é capturado", !!js);
    ok("mensagem do erro é preservada", js.message.indexOf("Cannot read properties") === 0);
    ok("arquivo e linha são registrados", js.data.arquivo.indexOf("dashboard.js") !== -1 && js.data.linha === 42);
    ok("stack é registrada", typeof js.stack === "string" && js.stack.length > 0);

    const rejeicao = eventos.find((e) => e.eventType === "unhandled-rejection");
    ok("promise rejeitada é capturada", !!rejeicao);
    ok("mensagem da rejeição é preservada", rejeicao.message === "Falha ao carregar cliente 360");
    ok("severidade de rejeição é erro", rejeicao.severity === "error");

    const navegacao = eventos.find((e) => e.eventType === "navigation");
    ok("navegação é registrada como evento leve", !!navegacao && navegacao.page === "dashboard.html");
  }

  console.log("\n▸ 10. console.error é opcional");
  {
    const antes = (await VF.getEvents({ limit: 1000 })).filter((e) => e.eventType === "console-error").length;
    console.error("[teste] erro de console ignorado por configuração");
    await proximoTick();
    const meio = (await VF.getEvents({ limit: 1000 })).filter((e) => e.eventType === "console-error").length;
    ok("com captureConsole=false nada é gravado", meio === antes);

    VF.setConfig({ captureConsole: true });
    console.error("[teste] erro de console capturado");
    await proximoTick();
    const depois = (await VF.getEvents({ limit: 1000 })).filter((e) => e.eventType === "console-error").length;
    ok("com captureConsole=true o erro vira evento", depois === meio + 1);
    ok("console.error continua funcionando (não foi engolido)", typeof console.error === "function");
    VF.setConfig({ captureConsole: false });
  }

  console.log("\n▸ 11. Histórico passa de 100 e sobrevive ao reload");
  {
    for (let i = 0; i < 150; i++) {
      await VF.record({
        eventType: "request", severity: "info", method: "GET",
        endpoint: "/lote/" + i, statusCode: 200, durationMs: 10,
        message: "evento de volume " + i,
      });
    }
    const eventos = await VF.getEvents({ limit: 1000 });
    ok("mais de 100 eventos são mantidos", eventos.length > 100);
    ok("os eventos de volume estão lá", eventos.filter((e) => e.endpoint && e.endpoint.indexOf("/lote/") === 0).length === 150);
    ok("a ordenação é do mais recente para o mais antigo", eventos[0].ts >= eventos[eventos.length - 1].ts);

    // "Reload" = novo pageLoadId, mesmo armazenamento. O histórico continua.
    const stats = await VF.getStats();
    ok("as estatísticas enxergam o histórico", stats.total > 100);
    ok("as sessões são contabilizadas", Object.keys(stats.sessoes).length >= 1);
    ok("as páginas são contabilizadas", Object.keys(stats.paginas).length >= 1);
    ok("o não-sincronizado é contado", typeof stats.naoSincronizados === "number" && stats.naoSincronizados > 0);
  }

  console.log("\n▸ 12. Sincronização resiliente");
  {
    VF.setConfig({ sync: true });

    respostaProgramada = respostaJson({ ok: false, erro: "servidor fora" }, { status: 503 });
    const falha = await VF.sync({ force: true });
    ok("sync com servidor fora não lança", falha && falha.enviados === 0);
    ok("o erro de sync fica visível", typeof VF.getRuntimeInfo().ultimoSyncErro === "string");

    const pendentesAposFalha = await VF.getEvents({ onlyUnsynced: true, limit: 1000 });
    ok("nenhum evento é perdido quando o servidor está fora", pendentesAposFalha.length > 0);

    respostaProgramada = respostaJson({ ok: true, aceitos: 25, rejeitados: 0, truncados: 0 });
    const sucesso = await VF.sync({ force: true });
    ok("sync bem-sucedido reporta o envio", sucesso.enviados > 0);
    ok("o erro anterior é limpo", VF.getRuntimeInfo().ultimoSyncErro === null);

    const chamada = chamadasFetch[chamadasFetch.length - 1];
    ok("o lote vai para o endpoint de ingestão", chamada.url.indexOf("/admin/observability/client-events") !== -1);
    ok("o lote vai autenticado", String(chamada.headers.authorization || "").indexOf("Bearer ") === 0);
    const enviado = JSON.parse(chamada.body);
    ok("o lote respeita o tamanho máximo", enviado.events.length <= 25);
    ok("o lote não carrega o JWT dentro dos eventos", JSON.stringify(enviado.events).indexOf("assinaturaSecreta") === -1);

    VF.setConfig({ sync: false });
  }

  console.log("\n▸ 13. Testes controlados e limpeza");
  {
    await VF.emitTestError();
    await proximoTick();
    let eventos = await VF.getEvents({ limit: 1000 });
    const teste = eventos.find((e) => e.eventType === "test" && e.severity === "error");
    ok("o erro de teste é registrado", !!teste);
    ok("o erro de teste se identifica como teste", teste.data.teste === true && teste.data.afetaProducao === false);

    respostaProgramada = respostaJson({ ok: true });
    const resultado = await VF.runTestRequest();
    ok("o teste controlado bate em /health", resultado.status === 200);
    ok("o teste controlado não altera nada", chamadasFetch[chamadasFetch.length - 1].metodo === "GET");

    const exportado = await VF.exportEvents();
    ok("export local traz runtime + eventos", exportado.total > 0 && !!exportado.runtime);
    ok("export local não contém token", JSON.stringify(exportado).indexOf("assinaturaSecreta") === -1);

    await VF.clearLocal();
    eventos = await VF.getEvents({ limit: 1000 });
    ok("limpar cache local esvazia só o navegador", eventos.length === 0);
  }

  console.log("\n▸ 14. Desligar o coletor devolve o fetch original");
  {
    VF.disable();
    ok("coletor fica inativo", VF.isActive() === false);

    respostaProgramada = respostaJson({ ok: true });
    const resposta = await fetch("https://api.teste.local/bases");
    ok("a chamada continua funcionando com o debug desligado", (await resposta.json()).ok === true);

    await proximoTick();
    const eventos = await VF.getEvents({ limit: 1000 });
    ok("nada é gravado com o coletor desligado", eventos.length === 0);

    const ultima = chamadasFetch[chamadasFetch.length - 1];
    ok("headers de debug não são mais anexados", !ultima.headers["x-vf-debug-session"]);

    VF.enable();
    ok("religar o coletor volta a capturar", VF.isActive() === true);
  }

  console.log("\n▸ 15. Não-admin não coleta");
  {
    localStorage.setItem("vf-user", JSON.stringify({ id: 2, nome: "Membro", role: "membro" }));
    ok("sem role de admin o coletor fica inativo", VF.isActive() === false);
    ok("enable() é recusado para não-admin", VF.enable() === false);

    respostaProgramada = respostaJson({ ok: true });
    await fetch("https://api.teste.local/bases");
    await proximoTick();
    ok("nenhum evento é gravado para não-admin", (await VF.getEvents({ limit: 100 })).length === 0);

    localStorage.removeItem("vf-token");
    localStorage.setItem("vf-user", JSON.stringify({ id: 1, role: "admin" }));
    ok("admin sem token também fica inativo", VF.isActive() === false);
  }

  console.log(`\n${passou} verificações passaram. Coletor do navegador OK.\n`);
  // Encerra explicitamente: o coletor agenda timers de backoff de sync.
  process.exit(0);
}

principal().catch((erro) => {
  console.error("\n✖ Falhou:", erro.message);
  console.error(erro.stack);
  process.exit(1);
});
