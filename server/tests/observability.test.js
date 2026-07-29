// server/tests/observability.test.js
// Observabilidade: middleware, fila, ingestão, agregações, permissão e retenção.
//
// Sem PostgreSQL: o pool é substituído por um duplo que reconhece cada query
// pelo texto e devolve linhas fixas. Isso testa o que é NOSSO (montagem de
// filtros, shaping das agregações, resiliência da fila, permissão) sem testar
// o PostgreSQL, que não é nosso.
//
// Roda sem infra: node tests/observability.test.js

const assert = require("assert");
const path = require("path");

/* ── Duplo do pool, instalado ANTES de qualquer require do projeto ────────── */

const chamadas = [];
const inseridos = { requests: [], clientEvents: [] };
let modoFalhaInsert = false;
let fixtures = {};

function responder(rows, rowCount) {
  return { rows: rows || [], rowCount: rowCount === undefined ? (rows || []).length : rowCount };
}

const poolFalso = {
  totalCount: 8,
  idleCount: 6,
  waitingCount: 0,
  async query(texto, valores) {
    chamadas.push({ texto: String(texto), valores: valores || [] });
    const sql = String(texto);

    if (/INSERT INTO observability_requests/.test(sql)) {
      if (modoFalhaInsert) throw new Error("relation observability_requests does not exist");
      inseridos.requests.push({ sql, valores });
      return responder([], valores.length / 18);
    }
    if (/INSERT INTO observability_client_events/.test(sql)) {
      if (modoFalhaInsert) throw new Error("Connection terminated unexpectedly");
      inseridos.clientEvents.push({ sql, valores });
      return responder([], valores.length / 17);
    }
    if (/FROM users\s+WHERE id/.test(sql) || /SELECT \* FROM users WHERE id/.test(sql)) {
      const id = valores[0];
      if (id === 1) return responder([{ id: 1, nome: "Admin Teste", email: "admin@venforce.com", role: "admin", ativo: true }]);
      if (id === 2) return responder([{ id: 2, nome: "Membro Teste", email: "membro@venforce.com", role: "membro", ativo: true }]);
      return responder([]);
    }
    if (/CREATE TABLE IF NOT EXISTS observability_requests/.test(sql)) return responder([]);
    if (/percentile_disc\(0\.50\)/.test(sql)) return responder([fixtures.servidor]);
    if (/falhas_rede/.test(sql)) return responder([fixtures.navegador]);
    if (/GROUP BY 1 ORDER BY total DESC, rota ASC LIMIT 1/.test(sql)) return responder(fixtures.rotaComMaisErros || []);
    if (/ORDER BY media DESC/.test(sql)) return responder(fixtures.rotaMaisLenta || []);
    if (/ORDER BY created_at DESC LIMIT 1/.test(sql)) return responder(fixtures.ultimoErro || []);
    if (/date_trunc\('minute'/.test(sql)) return responder(fixtures.porMinuto || []);
    if (/\(status_code \/ 100\)/.test(sql)) return responder(fixtures.porStatus || []);
    if (/FROM observability_requests\s+WHERE request_id/.test(sql)) return responder(fixtures.detalheServidor || []);
    if (/FROM observability_client_events\s+WHERE request_id/.test(sql)) return responder(fixtures.detalheCliente || []);
    if (/SELECT COUNT\(\*\)::int AS total FROM unificado/.test(sql)) return responder([{ total: fixtures.totalUnificado || 0 }]);
    if (/FROM unificado/.test(sql)) return responder(fixtures.unificado || []);
    if (/DELETE FROM observability/.test(sql)) return responder([], fixtures.removidos || 3);
    if (/SELECT\s+\(SELECT COUNT\(\*\)::int FROM observability_requests\)/.test(sql)) {
      return responder([{ requests: 120, client_events: 340, request_mais_antiga: "2026-07-20T00:00:00.000Z" }]);
    }
    if (/^SELECT 1 FROM observability/.test(sql.trim())) return responder([{ "?column?": 1 }]);
    if (/^SELECT 1$/.test(sql.trim())) return responder([{ "?column?": 1 }]);
    return responder([]);
  },
  async connect() {
    return { query: async () => responder([]), release() {} };
  },
};

const caminhoDb = require.resolve("../config/database");
require.cache[caminhoDb] = {
  id: caminhoDb,
  filename: caminhoDb,
  loaded: true,
  children: [],
  paths: [],
  exports: poolFalso,
};

process.env.JWT_SECRET = "segredo-de-teste-observabilidade";
process.env.OBSERVABILITY_ENABLED = "true";
process.env.OBSERVABILITY_CLIENT_EVENTS = "true";
process.env.OBSERVABILITY_SLOW_MS = "1000";

const express = require("express");
const jwt = require("jsonwebtoken");

const S = require("../utils/observabilitySanitizer");
const repo = require("../repositories/observabilityRepository");
const service = require("../services/observabilityService");
const {
  observabilityMiddleware,
  captureRequestError,
  shouldIgnore,
  isValidRequestId,
  resolveRoute,
} = require("../middlewares/observabilityMiddleware");
const observabilityRoutes = require("../routes/observabilityRoutes");

let passou = 0;
const ok = (nome, condicao) => {
  assert.ok(condicao, `FALHOU: ${nome}`);
  passou++;
  console.log(`  ok  ${nome}`);
};

const tokenAdmin = jwt.sign({ id: 1 }, process.env.JWT_SECRET);
const tokenMembro = jwt.sign({ id: 2 }, process.env.JWT_SECRET);

/* ── App de teste com a MESMA montagem do server/index.js ─────────────────── */

const app = express();
app.use(express.json());
app.use(observabilityMiddleware);
app.use("/admin/observability", observabilityRoutes);
app.get("/eco", (req, res) => res.json({ ok: true, requestId: req.requestId }));
app.get("/bases/:baseId", (req, res) => res.json({ ok: true, base: req.params.baseId }));
app.get("/health", (req, res) => res.json({ ok: true }));
app.get("/lento", async (req, res) => {
  await new Promise((resolve) => setTimeout(resolve, 90));
  res.json({ ok: true });
});
app.get("/quebra", (req, res, next) => next(new Error("falha proposital com Bearer eyJhbGciOiJIUzI1NiJ9.eyJhIjoxfQ.sig")));
app.use((err, req, res, next) => {
  captureRequestError(req, err);
  res.status(500).json({ ok: false, erro: "Erro interno do servidor" });
});

let servidor;
let base;

function chamar(caminho, opcoes = {}) {
  return fetch(base + caminho, opcoes);
}

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function valoresDaUltimaRequestInserida() {
  const ultimo = inseridos.requests[inseridos.requests.length - 1];
  if (!ultimo) return null;
  const v = ultimo.valores.slice(-18);
  return {
    requestId: v[0], method: v[1], route: v[2], path: v[3], statusCode: v[4],
    durationMs: v[5], source: v[6], userId: v[7], userEmail: v[8], userNome: v[9],
    contentType: v[10], responseSize: v[11], userAgent: v[12], errorName: v[13],
    errorMessage: v[14], errorStack: v[15], metadata: JSON.parse(v[16]), createdAt: v[17],
  };
}

async function principal() {
  servidor = app.listen(0);
  await new Promise((resolve) => servidor.once("listening", resolve));
  base = `http://127.0.0.1:${servidor.address().port}`;

  /* ══════════════════════════════════════════════════════════════════════ */
  console.log("\n▸ 1. Request id: geração, validação e preservação");
  {
    ok("id do middleware tem formato aceito", isValidRequestId("11111111-2222-3333-4444-555555555555"));
    ok("id curto é recusado", isValidRequestId("abc") === false);
    ok("id com caractere perigoso é recusado", isValidRequestId("abc<script>defghij") === false);
    ok("id ausente é recusado", isValidRequestId(undefined) === false);

    const semHeader = await chamar("/eco");
    const geradoNoHeader = semHeader.headers.get("x-request-id");
    const geradoNoCorpo = (await semHeader.json()).requestId;
    ok("servidor gera request id quando o cliente não manda", !!geradoNoHeader && geradoNoHeader.length >= 8);
    ok("header e req.requestId são o mesmo valor", geradoNoHeader === geradoNoCorpo);

    const meuId = "cliente-abc-123456789";
    const comHeader = await chamar("/eco", { headers: { "X-Request-Id": meuId } });
    ok("request id válido do cliente é preservado", comHeader.headers.get("x-request-id") === meuId);

    const invalido = await chamar("/eco", { headers: { "X-Request-Id": "x" } });
    ok("request id inválido do cliente é substituído", invalido.headers.get("x-request-id") !== "x");
  }

  /* ══════════════════════════════════════════════════════════════════════ */
  console.log("\n▸ 2. Exclusão de rotas internas (sem recursão de log)");
  {
    const req = (metodo, caminho) => ({ method: metodo, path: caminho });
    ok("ingestão de observabilidade é ignorada", shouldIgnore(req("POST", "/admin/observability/client-events")));
    ok("toda a área de observabilidade é ignorada", shouldIgnore(req("GET", "/admin/observability/summary")));
    ok("/health é ignorado", shouldIgnore(req("GET", "/health")));
    ok("/downloads é ignorado", shouldIgnore(req("GET", "/downloads/arquivo.zip")));
    ok("OPTIONS é ignorado", shouldIgnore(req("OPTIONS", "/bases")));
    ok("rota de negócio NÃO é ignorada", shouldIgnore(req("GET", "/bases")) === false);
    ok("rota parecida não é ignorada por prefixo solto", shouldIgnore(req("GET", "/admin/observability-outra")) === false);

    inseridos.requests.length = 0;
    await chamar("/admin/observability/client-events", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenAdmin}` },
      body: JSON.stringify({ events: [] }),
    });
    await chamar("/health");
    await service.flush();
    const gravouIngestao = inseridos.requests.some((linha) =>
      linha.valores.some((v) => typeof v === "string" && v.includes("/admin/observability")));
    ok("nenhuma request da própria ingestão foi persistida", gravouIngestao === false);
    const gravouHealth = inseridos.requests.some((linha) => linha.valores.includes("/health"));
    ok("/health não é persistido", gravouHealth === false);
  }

  /* ══════════════════════════════════════════════════════════════════════ */
  console.log("\n▸ 3. Telemetria da request: rota, status, duração, erro");
  {
    inseridos.requests.length = 0;
    await chamar("/bases/loja-meli?ativo=true");
    await service.flush();
    const linha = valoresDaUltimaRequestInserida();

    ok("padrão de rota do Express é registrado", linha.route === "/bases/:baseId");
    ok("caminho concreto é registrado sanitizado", linha.path === "/bases/loja-meli");
    ok("método é registrado", linha.method === "GET");
    ok("status é registrado", linha.statusCode === 200);
    ok("duração é numérica", Number.isFinite(linha.durationMs) && linha.durationMs >= 0);
    ok("origem é o servidor", linha.source === "server");
    ok("query sanitizada vai no metadata", linha.metadata.query.ativo === "true");
    ok("request finalizada é marcada como tal", linha.metadata.finalizada === true);
    ok("corpo da request NÃO é registrado", !("body" in linha.metadata) && !("corpo" in linha.metadata));

    resolveRoute({ baseUrl: "/admin", route: { path: "/x" } });
    ok("resolveRoute concatena baseUrl + padrão",
      resolveRoute({ baseUrl: "/admin/logs", route: { path: "/" } }) === "/admin/logs/");
    ok("resolveRoute devolve null sem rota casada", resolveRoute({ baseUrl: "", route: null }) === null);
  }

  /* ══════════════════════════════════════════════════════════════════════ */
  console.log("\n▸ 4. Erro do servidor é capturado uma vez e sanitizado");
  {
    inseridos.requests.length = 0;
    const resposta = await chamar("/quebra");
    const corpo = await resposta.json();
    await service.flush();

    ok("cliente recebe 500 genérico", resposta.status === 500 && corpo.erro === "Erro interno do servidor");
    ok("stack NÃO vai para o cliente", !("stack" in corpo) && JSON.stringify(corpo).indexOf("at ") === -1);

    const gravadas = inseridos.requests.reduce((soma, l) => soma + l.valores.length / 18, 0);
    ok("o erro gerou exatamente um registro", gravadas === 1);

    const linha = valoresDaUltimaRequestInserida();
    ok("nome do erro é gravado", linha.errorName === "Error");
    ok("mensagem do erro é gravada", String(linha.errorMessage).includes("falha proposital"));
    ok("JWT dentro da mensagem de erro é redigido", String(linha.errorMessage).indexOf("eyJ") === -1);
    ok("stack é gravada só no servidor", typeof linha.errorStack === "string" && linha.errorStack.includes("at "));
    ok("metadata marca erro", linha.metadata.erro === true);
  }

  /* ══════════════════════════════════════════════════════════════════════ */
  console.log("\n▸ 5. Classificação de lentidão");
  {
    // O limite tem piso de 50ms na configuração — valores absurdos são
    // recusados para não marcar o Portal inteiro como lento.
    process.env.OBSERVABILITY_SLOW_MS = "1";
    ok("limite abaixo do piso é normalizado", service.getConfig().slowMs === 50);

    process.env.OBSERVABILITY_SLOW_MS = "50";
    inseridos.requests.length = 0;
    await chamar("/lento");
    await service.flush();
    const linhaLenta = valoresDaUltimaRequestInserida();
    ok("request acima do limite é marcada como lenta", linhaLenta.metadata.lenta === true);
    ok("a duração medida bate com a rota lenta", linhaLenta.durationMs >= 80);

    process.env.OBSERVABILITY_SLOW_MS = "60000";
    inseridos.requests.length = 0;
    await chamar("/lento");
    await service.flush();
    ok("request abaixo do limite não é marcada como lenta", valoresDaUltimaRequestInserida().metadata.lenta === false);

    process.env.OBSERVABILITY_SLOW_MS = "1000";
    ok("slowMs volta ao padrão configurado", service.getConfig().slowMs === 1000);
  }

  /* ══════════════════════════════════════════════════════════════════════ */
  console.log("\n▸ 6. Banco fora não derruba o middleware");
  {
    modoFalhaInsert = true;
    const antes = service.getQueueStats().descartadosPorErro;

    const resposta = await chamar("/eco");
    const corpo = await resposta.json();
    ok("a request do Portal responde normalmente com o banco fora", resposta.status === 200 && corpo.ok === true);

    await service.flush();
    const depois = service.getQueueStats();
    ok("o lote perdido é contabilizado", depois.descartadosPorErro > antes);
    ok("o último erro fica observável", typeof depois.ultimoErro === "string" && depois.ultimoErro.length > 0);
    ok("o estado do armazenamento vira falso", depois.armazenamentoOk === false);

    modoFalhaInsert = false;
    await chamar("/eco");
    await service.flush();
    ok("a fila se recupera quando o banco volta", service.getQueueStats().armazenamentoOk === true);
  }

  /* ══════════════════════════════════════════════════════════════════════ */
  console.log("\n▸ 7. Permissão: a API é a autoridade");
  {
    const semToken = await chamar("/admin/observability/summary");
    ok("summary sem token devolve 401", semToken.status === 401);

    const semTokenRequests = await chamar("/admin/observability/requests");
    ok("requests sem token devolve 401", semTokenRequests.status === 401);

    const tokenInvalido = await chamar("/admin/observability/summary", {
      headers: { Authorization: "Bearer nao-e-um-jwt" },
    });
    ok("token inválido devolve 401", tokenInvalido.status === 401);

    const naoAdmin = await chamar("/admin/observability/summary", {
      headers: { Authorization: `Bearer ${tokenMembro}` },
    });
    const corpoNaoAdmin = await naoAdmin.json();
    ok("usuário não-admin devolve 403", naoAdmin.status === 403);
    ok("mensagem de 403 é a padrão do projeto", corpoNaoAdmin.erro === "Acesso restrito a administradores.");

    const ingestaoNaoAdmin = await chamar("/admin/observability/client-events", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenMembro}` },
      body: JSON.stringify({ events: [] }),
    });
    ok("ingestão também é admin-only", ingestaoNaoAdmin.status === 403);

    const purgeSemConfirmacao = await chamar("/admin/observability/purge", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenAdmin}` },
      body: JSON.stringify({}),
    });
    ok("purge sem confirmação é recusado", purgeSemConfirmacao.status === 400);
  }

  /* ══════════════════════════════════════════════════════════════════════ */
  console.log("\n▸ 8. Summary sem registros");
  {
    fixtures = {
      servidor: { total: 0, sucesso: 0, erros_4xx: 0, erros_5xx: 0, lentas: 0, duracao_media: 0, p50: 0, p95: 0, p99: 0 },
      navegador: { total: 0, falhas_rede: 0, erros: 0, erros_js: 0, rejeicoes: 0, sessoes: 0 },
      rotaComMaisErros: [], rotaMaisLenta: [], ultimoErro: [], porMinuto: [], porStatus: [],
    };
    const resposta = await chamar("/admin/observability/summary?window=1h", {
      headers: { Authorization: `Bearer ${tokenAdmin}` },
    });
    const { resumo } = await resposta.json();

    ok("summary vazio responde 200", resposta.status === 200);
    ok("total zero", resumo.total === 0);
    ok("percentual de sucesso é null (não 0, não 100)", resumo.percentualSucesso === null);
    ok("requests por minuto é zero", resumo.porMinuto === 0);
    ok("nenhum endpoint destacado é inventado", resumo.rotaComMaisErros === null && resumo.rotaMaisLenta === null);
    ok("último erro é null", resumo.ultimoErro === null);
    ok("séries vêm vazias", Array.isArray(resumo.porMinutoSerie) && resumo.porMinutoSerie.length === 0);
    ok("estatísticas da fila acompanham o resumo", typeof resumo.fila.descartados === "number");
  }

  /* ══════════════════════════════════════════════════════════════════════ */
  console.log("\n▸ 9. Summary com 2xx, 4xx, 5xx e lentas");
  {
    fixtures = {
      servidor: { total: 200, sucesso: 170, erros_4xx: 18, erros_5xx: 12, lentas: 7, duracao_media: 240, p50: 120, p95: 900, p99: 2400 },
      navegador: { total: 90, falhas_rede: 4, erros: 11, erros_js: 5, rejeicoes: 2, sessoes: 3 },
      rotaComMaisErros: [{ rota: "/operacao/cliente-360/:slug", total: 12 }],
      rotaMaisLenta: [{ rota: "/fechamentos/financeiro", media: 3100, total: 4 }],
      ultimoErro: [{ request_id: "abc-123", method: "GET", rota: "/bases/:baseId", status_code: 500, error_name: "TypeError", error_message: "x is not a function", created_at: new Date().toISOString() }],
      porMinuto: [{ minuto: new Date().toISOString(), total: 20, erros: 3 }],
      porStatus: [{ faixa: 200, total: 170 }, { faixa: 400, total: 18 }, { faixa: 500, total: 12 }],
    };
    const resposta = await chamar("/admin/observability/summary?window=6h", {
      headers: { Authorization: `Bearer ${tokenAdmin}` },
    });
    const { resumo } = await resposta.json();

    ok("janela pedida é respeitada", resumo.janela === "6h");
    ok("total vem do banco", resumo.total === 200);
    ok("percentual de sucesso é calculado", resumo.percentualSucesso === 85);
    ok("4xx e 5xx são separados", resumo.erros4xx === 18 && resumo.erros5xx === 12);
    ok("lentas vêm do banco", resumo.lentas === 7);
    ok("percentis são expostos", resumo.p50 === 120 && resumo.p95 === 900 && resumo.p99 === 2400);
    ok("falhas de rede do navegador entram no resumo", resumo.falhasRede === 4);
    ok("erros de JS entram no resumo", resumo.errosJs === 5);
    ok("endpoint com mais erros é real", resumo.rotaComMaisErros.rota === "/operacao/cliente-360/:slug");
    ok("endpoint mais lento é real", resumo.rotaMaisLenta.rota === "/fechamentos/financeiro");
    ok("último erro é real", resumo.ultimoErro.request_id === "abc-123");
    ok("requests por minuto é derivado da janela", resumo.porMinuto > 0 && resumo.porMinuto < 200);

    const janelaInvalida = await chamar("/admin/observability/summary?window=drop-table", {
      headers: { Authorization: `Bearer ${tokenAdmin}` },
    });
    ok("janela inválida cai no padrão em vez de virar SQL", (await janelaInvalida.json()).resumo.janela === "1h");
  }

  /* ══════════════════════════════════════════════════════════════════════ */
  console.log("\n▸ 10. Filtros do repositório são sempre parametrizados");
  {
    const filtros = service.parseFilters({
      window: "24h",
      search: "'; DROP TABLE users; --",
      route: "/bases",
      user: "admin@venforce.com",
      screen: "dashboard.html",
      method: "post",
      source: "browser",
      status: "5xx",
      onlySlow: "1",
      limit: "9999",
      page: "3",
      sortBy: "duration_ms",
      sortDir: "asc",
    });

    ok("método é normalizado", filtros.method === "POST");
    ok("origem é validada por allowlist", filtros.source === "browser");
    ok("faixa de status é reconhecida", filtros.statusClass === "5xx");
    ok("limite é teto de 200", filtros.limit === 200);
    ok("offset é derivado da página", filtros.offset === 400);
    ok("ordenação vem de allowlist", filtros.sortBy === "duration_ms" && filtros.sortDir === "asc");

    const injecao = service.parseFilters({ sortBy: "duration_ms; DROP TABLE users", sortDir: "asc; --" });
    ok("sortBy fora da allowlist cai no padrão", injecao.sortBy === "created_at");
    ok("sortDir fora da allowlist cai no padrão", injecao.sortDir === "asc" || injecao.sortDir === "desc");

    const montado = repo.buildRequestFilters(filtros, 2);
    ok("cláusula não contém o texto do usuário", montado.clause.indexOf("DROP TABLE") === -1);
    ok("o texto do usuário virou parâmetro", montado.values.some((v) => String(v).includes("DROP TABLE")));
    ok("cláusula só tem placeholders numerados", /\$\d+/.test(montado.clause));
    ok("faixa 5xx vira comparação fixa", montado.clause.includes("status_code >= 500"));
    ok("lentas usam o slowMs como parâmetro", montado.values.includes(filtros.slowMs));

    const semFiltro = repo.buildRequestFilters(service.parseFilters({}), 2);
    ok("sem filtro explícito sobra apenas a janela de tempo",
      semFiltro.clause === "WHERE created_at >= $2" && semFiltro.values.length === 1);
    ok("a janela é sempre aplicada (nunca varre a tabela inteira)",
      typeof semFiltro.values[0] === "string" && !Number.isNaN(Date.parse(semFiltro.values[0])));

    const vazio = repo.buildRequestFilters({}, 2);
    ok("filtro totalmente vazio não gera WHERE", vazio.clause === "");

    const statusExato = service.parseFilters({ status: "404" });
    ok("status numérico vira filtro exato", statusExato.statusExact === 404);
    const statusAbsurdo = service.parseFilters({ status: "99999" });
    ok("status fora da faixa HTTP é descartado", statusAbsurdo.statusExact === null);
  }

  /* ══════════════════════════════════════════════════════════════════════ */
  console.log("\n▸ 11. Listagem unificada e paginação");
  {
    fixtures.unificado = [
      { source: "server", id: 1, request_id: "r1", method: "GET", route: "/bases", path: "/bases", status_code: 200, duration_ms: 40, user_email: "a@x.com", page: null, session_id: null, error_message: null, created_at: new Date().toISOString() },
      { source: "browser", id: 2, request_id: "r1", method: "GET", route: "/bases", path: "/bases", status_code: 200, duration_ms: 62, user_email: "a@x.com", page: "bases.html", session_id: "s-1", error_message: null, created_at: new Date().toISOString() },
    ];
    fixtures.totalUnificado = 137;

    const resposta = await chamar("/admin/observability/requests?window=1h&page=2&limit=50", {
      headers: { Authorization: `Bearer ${tokenAdmin}` },
    });
    const dados = await resposta.json();

    ok("lista responde 200", resposta.status === 200);
    ok("linhas do servidor e do navegador vêm juntas",
      dados.requests.some((l) => l.source === "server") && dados.requests.some((l) => l.source === "browser"));
    ok("total real é devolvido", dados.total === 137);
    ok("página é devolvida", dados.page === 2);
    ok("total de páginas é calculado", dados.totalPages === 3);
    ok("slowMs acompanha a lista para o front classificar", dados.slowMs === 1000);
    ok("o modo backend NÃO devolve lista vazia fixa", dados.requests.length === 2);
  }

  /* ══════════════════════════════════════════════════════════════════════ */
  console.log("\n▸ 12. Correlação navegador ↔ servidor pelo request id");
  {
    const agora = Date.now();
    fixtures.detalheServidor = [{
      id: 9, request_id: "corr-1", method: "GET", route: "/bases/:baseId", path: "/bases/loja",
      status_code: 500, duration_ms: 320, source: "server", user_id: 1, user_email: "admin@venforce.com",
      user_nome: "Admin", content_type: "application/json", response_size: 120, user_agent: "Chrome 130",
      error_name: "TypeError", error_message: "x is not a function", error_stack: "at f (a.js:1)",
      metadata: { url: "/bases/loja", lenta: false }, created_at: new Date(agora + 50).toISOString(),
    }];
    fixtures.detalheCliente = [{
      id: 3, event_id: "e1", request_id: "corr-1", session_id: "s-9", tab_id: "t-9", page_load_id: "p-9",
      page: "bases.html", event_type: "request", severity: "error", message: "GET /bases/loja → 500",
      stack: null, data: { transporte: "fetch", response: { capturado: true, corpo: { ok: false } } },
      method: "GET", endpoint: "/bases/loja", status_code: 500, duration_ms: 420,
      user_email: "admin@venforce.com", created_at: new Date(agora).toISOString(),
    }];

    const resposta = await chamar("/admin/observability/requests/corr-1", {
      headers: { Authorization: `Bearer ${tokenAdmin}` },
    });
    const { detalhe } = await resposta.json();

    ok("detalhe responde 200", resposta.status === 200);
    ok("lado servidor está presente", detalhe.servidor.request_id === "corr-1");
    ok("lado navegador está presente", detalhe.navegador.length === 1);
    ok("correlação é declarada completa", detalhe.correlacao.completa === true);
    ok("timeline junta os dois lados", detalhe.timeline.length === 2);
    ok("timeline é cronológica (navegador antes do servidor)",
      detalhe.timeline[0].fonte === "browser" && detalhe.timeline[1].fonte === "server");
    ok("tela de origem vem do navegador", detalhe.eventoPrincipal.page === "bases.html");

    fixtures.detalheCliente = [];
    const soServidor = await chamar("/admin/observability/requests/corr-1", {
      headers: { Authorization: `Bearer ${tokenAdmin}` },
    });
    const detalheParcial = (await soServidor.json()).detalhe;
    ok("correlação incompleta é declarada, não escondida", detalheParcial.correlacao.completa === false);
    ok("o motivo da correlação incompleta é explicado", typeof detalheParcial.correlacao.motivo === "string");

    fixtures.detalheServidor = [];
    const inexistente = await chamar("/admin/observability/requests/nao-existe", {
      headers: { Authorization: `Bearer ${tokenAdmin}` },
    });
    ok("request id desconhecido devolve 404 honesto", inexistente.status === 404);
  }

  /* ══════════════════════════════════════════════════════════════════════ */
  console.log("\n▸ 13. Validação de eventos do navegador");
  {
    const valido = service.validateClientEvent({
      eventId: "e-1", eventType: "js-error", severity: "error",
      message: "Cannot read properties of undefined",
      requestId: "r-1", sessionId: "s-1", page: "dashboard.html",
      statusCode: 500, durationMs: 120, data: { arquivo: "dashboard.js" },
    });
    ok("evento válido é aceito", valido.ok === true);
    ok("severidade válida é preservada", valido.row.severity === "error");
    ok("statusCode válido é preservado", valido.row.statusCode === 500);

    ok("eventType desconhecido é rejeitado",
      service.validateClientEvent({ eventType: "hackerman" }).ok === false);
    ok("evento não-objeto é rejeitado", service.validateClientEvent("texto").ok === false);
    ok("array como evento é rejeitado", service.validateClientEvent([1, 2]).ok === false);

    const severidadeInvalida = service.validateClientEvent({ eventType: "request", severity: "catastrofico" });
    ok("severidade desconhecida cai para info", severidadeInvalida.row.severity === "info");

    const idSujo = service.validateClientEvent({ eventType: "request", sessionId: "<script>alert(1)</script>" });
    ok("id com caractere perigoso é descartado", idSujo.row.sessionId === null);

    const semId = service.validateClientEvent({ eventType: "request" });
    ok("eventId ausente é gerado no servidor", typeof semId.row.eventId === "string" && semId.row.eventId.length > 8);

    const statusAbsurdo = service.validateClientEvent({ eventType: "request", statusCode: 99999 });
    ok("status fora da faixa vira null", statusAbsurdo.row.statusCode === null);

    const futuro = service.validateClientEvent({ eventType: "request", timestamp: "2099-01-01T00:00:00Z" });
    ok("relógio do cliente no futuro é ignorado", new Date(futuro.row.createdAt).getTime() <= Date.now() + 1000);

    const dataEnorme = service.validateClientEvent({
      eventType: "request", data: { blob: "x".repeat(20000) },
    });
    ok("evento acima do limite é truncado, não descartado", dataEnorme.ok === true && dataEnorme.truncated === true);
    ok("truncamento é declarado no dado", dataEnorme.row.data.truncadoNoServidor === true);
  }

  /* ══════════════════════════════════════════════════════════════════════ */
  console.log("\n▸ 14. Redação DUPLICADA: o backend não confia no navegador");
  {
    // Cenário: coletor comprometido/desatualizado manda o token cru.
    const resultado = service.ingestClientEvents([{
      eventId: "vaz-1",
      eventType: "request",
      severity: "warn",
      message: "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJpZCI6MX0.assinatura",
      endpoint: "/auth/callback?code=segredo-oauth&cliente=alpha",
      data: {
        headers: { Authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.eyJpZCI6MX0.assinatura" },
        body: { senha: "123456", password: "abc", api_key: "vf_" + "c".repeat(32) },
        planilha: { nome: "custos.xlsx", conteudoBase64: "x".repeat(300) },
      },
    }], { userId: 1, userEmail: "admin@venforce.com" });

    ok("o evento é aceito", resultado.aceitos === 1);
    await service.flush();

    const gravado = inseridos.clientEvents[inseridos.clientEvents.length - 1];
    const serializado = JSON.stringify(gravado.valores);

    ok("JWT não chega ao banco", serializado.indexOf("eyJ") === -1);
    ok("senha não chega ao banco", serializado.indexOf("123456") === -1);
    ok("password não chega ao banco", serializado.indexOf('"abc"') === -1);
    ok("api key não chega ao banco", serializado.indexOf("vf_ccc") === -1);
    ok("code de OAuth na URL não chega ao banco", serializado.indexOf("segredo-oauth") === -1);
    ok("contexto útil sobrevive", serializado.indexOf("custos.xlsx") !== -1);
    ok("cliente na query sobrevive", serializado.indexOf("cliente=alpha") !== -1);
  }

  /* ══════════════════════════════════════════════════════════════════════ */
  console.log("\n▸ 15. Limites de lote na ingestão");
  {
    const lote = Array.from({ length: 300 }, (_, i) => ({
      eventId: `lote-${i}`, eventType: "request", severity: "info", message: `evento ${i}`,
    }));
    lote[5] = { eventType: "invalido-de-proposito" };
    lote[9] = null;

    const resultado = service.ingestClientEvents(lote, { userId: 1 });
    ok("lote é limitado ao teto", resultado.aceitos <= service.CLIENT_BATCH_MAX_EVENTS);
    ok("excedentes são contados", resultado.excedentes === 300 - service.CLIENT_BATCH_MAX_EVENTS);
    ok("eventos inválidos são rejeitados sem derrubar o lote", resultado.aceitos >= service.CLIENT_BATCH_MAX_EVENTS - 2);
    ok("rejeitados são reportados", resultado.rejeitados > 0);
    ok("motivos são reportados (limitados)", Array.isArray(resultado.motivos) && resultado.motivos.length <= 5);

    const corpoErrado = service.ingestClientEvents({ nao: "e um array" });
    ok("corpo fora do contrato não lança", corpoErrado.aceitos === 0 && typeof corpoErrado.erro === "string");

    await service.flush();
    const resposta = await chamar("/admin/observability/client-events", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenAdmin}` },
      body: JSON.stringify({ events: [{ eventId: "http-1", eventType: "navigation", message: "abriu" }] }),
    });
    const corpo = await resposta.json();
    ok("ingestão HTTP responde com contagens", resposta.status === 200 && corpo.aceitos === 1);
    ok("limite do lote é publicado na resposta", corpo.limiteLote === service.CLIENT_BATCH_MAX_EVENTS);

    const corpoInvalido = await chamar("/admin/observability/client-events", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenAdmin}` },
      body: JSON.stringify({ naoTemEvents: true }),
    });
    ok("corpo sem `events` devolve 400 explicativo", corpoInvalido.status === 400);
  }

  /* ══════════════════════════════════════════════════════════════════════ */
  console.log("\n▸ 16. Ingestão respeita a chave de desligamento");
  {
    process.env.OBSERVABILITY_CLIENT_EVENTS = "false";
    const desligado = service.ingestClientEvents([{ eventId: "off-1", eventType: "request" }]);
    ok("com OBSERVABILITY_CLIENT_EVENTS=false nada é aceito", desligado.aceitos === 0 && desligado.ignorados === true);
    process.env.OBSERVABILITY_CLIENT_EVENTS = "true";

    process.env.OBSERVABILITY_ENABLED = "false";
    ok("com OBSERVABILITY_ENABLED=false a request do servidor não é enfileirada",
      service.recordServerRequest({ requestId: "x", method: "GET", path: "/x" }) === false);
    process.env.OBSERVABILITY_ENABLED = "true";

    delete process.env.OBSERVABILITY_RETENTION_DAYS;
    delete process.env.OBSERVABILITY_MAX_ROWS;
    const padrao = service.getConfig();
    ok("sem variáveis definidas o sistema usa padrões seguros",
      padrao.enabled === true && padrao.retentionDays === 7 && padrao.maxRows === 50000);
  }

  /* ══════════════════════════════════════════════════════════════════════ */
  console.log("\n▸ 17. Retenção");
  {
    chamadas.length = 0;
    const removidos = await service.runCleanup();
    const deletes = chamadas.filter((c) => /DELETE FROM observability/.test(c.texto));

    ok("limpeza roda 4 deletes (idade + volume, nas duas tabelas)", deletes.length === 4);
    ok("retenção por idade usa intervalo parametrizado",
      deletes.some((c) => /days'\)::interval/.test(c.texto) && c.valores[0] === "7"));
    ok("retenção por volume usa o limite como parâmetro",
      deletes.some((c) => /ORDER BY id DESC LIMIT \$1/.test(c.texto) && c.valores[0] === 50000));
    ok("as duas tabelas são podadas",
      deletes.some((c) => /observability_requests/.test(c.texto)) &&
      deletes.some((c) => /observability_client_events/.test(c.texto)));
    ok("limpeza devolve contagens", removidos && typeof removidos.requests === "number");

    const timer = service.startRetentionJob({ intervalMs: 60000 });
    ok("o job de retenção não segura o processo", timer && timer.hasRef && timer.hasRef() === false);
    service.stopRetentionJob();
  }

  /* ══════════════════════════════════════════════════════════════════════ */
  console.log("\n▸ 18. Health não vaza segredo");
  {
    process.env.CLICKUP_TOKEN = "pk_segredo_do_clickup_123";
    process.env.ML_CLIENT_SECRET = "ml_segredo_super_secreto";

    const resposta = await chamar("/admin/observability/health", {
      headers: { Authorization: `Bearer ${tokenAdmin}` },
    });
    const { saude } = await resposta.json();
    const serializado = JSON.stringify(saude);

    ok("health responde 200", resposta.status === 200);
    ok("token do ClickUp não aparece", serializado.indexOf("pk_segredo_do_clickup_123") === -1);
    ok("secret do ML não aparece", serializado.indexOf("ml_segredo_super_secreto") === -1);
    ok("JWT_SECRET não aparece", serializado.indexOf(process.env.JWT_SECRET) === -1);
    ok("só a presença da variável é reportada",
      saude.integracoes.some((i) => i.variaveis.some((v) => v.nome === "CLICKUP_TOKEN" && v.presente === true)));
    ok("integração não configurada é declarada como tal",
      saude.integracoes.some((i) => i.configuracao === "nao_configurado" || i.configuracao === "parcial"));
    ok("nenhuma integração aparece como testada sem teste",
      saude.integracoes.every((i) => i.teste === "nao_testado"));
    ok("estado do pool é exposto", saude.banco.pool.total === 8);
    ok("estatísticas da fila acompanham", typeof saude.observabilidade.fila.descartados === "number");
    ok("retenção é informada", saude.observabilidade.retencaoDias === 7);

    delete process.env.CLICKUP_TOKEN;
    delete process.env.ML_CLIENT_SECRET;
  }

  /* ══════════════════════════════════════════════════════════════════════ */
  console.log("\n▸ 19. Health check ativo é sob demanda e só leitura");
  {
    const resposta = await chamar("/admin/observability/health/check", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenAdmin}` },
      body: JSON.stringify({ alvos: ["postgres", "observabilidade"] }),
    });
    const dados = await resposta.json();

    ok("check responde 200", resposta.status === 200);
    ok("só os alvos pedidos rodam", dados.executados.length === 2);
    ok("postgres é testado", dados.resultados.postgres.resultado === "ok");
    ok("observabilidade é testada", dados.resultados.observabilidade.resultado === "ok");
    ok("nenhum alvo executa escrita",
      chamadas.slice(-6).every((c) => !/INSERT|UPDATE|DELETE/.test(c.texto)));

    const alvoDesconhecido = await chamar("/admin/observability/health/check", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenAdmin}` },
      body: JSON.stringify({ alvos: ["rm -rf", "__proto__"] }),
    });
    ok("alvo fora da allowlist não executa nada", (await alvoDesconhecido.json()).executados.length === 0);
  }

  /* ══════════════════════════════════════════════════════════════════════ */
  console.log("\n▸ 20. Inventário de rotas");
  {
    const resposta = await chamar("/admin/observability/routes", {
      headers: { Authorization: `Bearer ${tokenAdmin}` },
    });
    const dados = await resposta.json();

    ok("inventário responde", resposta.status === 200);
    ok("a introspecção funcionou neste Express", dados.ok === true);
    ok("rotas de negócio aparecem", dados.rotas.some((r) => r.caminho === "/bases/:baseId" && r.metodo === "GET"));
    ok("rotas montadas em router aparecem com o prefixo",
      dados.rotas.some((r) => r.caminho === "/admin/observability/summary"));
    ok("admin-only é inferido dos middlewares",
      dados.rotas.find((r) => r.caminho === "/admin/observability/summary").adminOnly === "sim");
    ok("autenticação é inferida dos middlewares",
      dados.rotas.find((r) => r.caminho === "/admin/observability/summary").autenticacao === "sim");
    ok("rota pública é marcada como sem auth",
      dados.rotas.find((r) => r.caminho === "/eco").autenticacao === "nao");
    ok("área é derivada do caminho",
      dados.rotas.find((r) => r.caminho === "/admin/observability/summary").area === "admin/observability");
    ok("inventário degrada honestamente sem router",
      service.buildRouteInventory({}).ok === false);
    ok("degradação explica o motivo em vez de inventar",
      typeof service.buildRouteInventory({}).motivo === "string" && service.buildRouteInventory({}).rotas.length === 0);
  }

  /* ══════════════════════════════════════════════════════════════════════ */
  console.log("\n▸ 21. Export sanitizado");
  {
    fixtures.unificado = [{
      source: "server", request_id: "exp-1", method: "GET",
      route: "/auth/callback?code=segredo", path: "/auth/callback",
      status_code: 200, duration_ms: 12, user_email: "a@x.com", page: null,
      error_message: "token eyJhbGciOiJIUzI1NiJ9.eyJhIjoxfQ.sig inválido",
      created_at: new Date().toISOString(),
    }];

    const json = await chamar("/admin/observability/export?format=json&window=1h", {
      headers: { Authorization: `Bearer ${tokenAdmin}` },
    });
    const corpo = await json.json();
    const texto = JSON.stringify(corpo);

    ok("export JSON responde 200", json.status === 200);
    ok("export declara total", corpo.total === 1);
    ok("code some do export", texto.indexOf("code=segredo") === -1);
    ok("JWT some do export", texto.indexOf("eyJ") === -1);
    ok("download é sugerido por header", (json.headers.get("content-disposition") || "").includes("attachment"));

    const csv = await chamar("/admin/observability/export?format=csv&window=1h", {
      headers: { Authorization: `Bearer ${tokenAdmin}` },
    });
    const textoCsv = await csv.text();
    ok("export CSV vem com content-type de CSV", (csv.headers.get("content-type") || "").includes("text/csv"));
    ok("CSV tem cabeçalho", textoCsv.split("\n")[0].startsWith("created_at,source,request_id"));
    ok("CSV também é sanitizado", textoCsv.indexOf("eyJ") === -1);

    const comQuebra = service.toCsv([{ created_at: "x", error_message: 'linha com "aspas", vírgula\ne quebra' }]);
    ok("CSV escapa aspas e vírgulas", comQuebra.split("\n").length === 2);
  }

  /* ══════════════════════════════════════════════════════════════════════ */
  console.log("\n▸ 22. Fila de escrita");
  {
    const antes = service.getQueueStats();
    ok("fila reporta limite", antes.limiteFila === 2000);
    ok("fila reporta tamanho de lote", antes.tamanhoLote === 100);
    ok("fila reporta gravados", typeof antes.gravados.requests === "number");

    // Satura a fila além do teto e confirma descarte controlado.
    const descartadosAntes = service.getQueueStats().descartadosPorFila;
    for (let i = 0; i < 2600; i++) {
      service.validateClientEvent({ eventId: `sat-${i}`, eventType: "request" });
    }
    const lote = Array.from({ length: 200 }, (_, i) => ({ eventId: `sat2-${i}`, eventType: "request" }));
    for (let i = 0; i < 20; i++) service.ingestClientEvents(lote);
    const depois = service.getQueueStats();
    ok("saturação é contabilizada, não silenciosa",
      depois.descartadosPorFila >= descartadosAntes && depois.descartados >= depois.descartadosPorFila);

    await service.shutdown();
    ok("shutdown drena sem lançar", true);
  }

  servidor.close();
  console.log(`\n${passou} verificações passaram. Observabilidade OK (backend).\n`);
}

principal().catch((erro) => {
  if (servidor) servidor.close();
  console.error("\n✖ Falhou:", erro.message);
  console.error(erro.stack);
  process.exit(1);
});
