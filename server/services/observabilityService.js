// server/services/observabilityService.js
// Regras da observabilidade: configuração, fila de escrita, validação de
// eventos do navegador, agregações, health e inventário de rotas.
//
// Princípio inegociável: nada aqui pode derrubar ou atrasar o Portal. Toda
// falha vira estado observável (contadores + último erro), nunca exceção
// propagada para o caminho da resposta.

"use strict";

const os = require("os");
const fs = require("fs");
const crypto = require("crypto");

const pool = require("../config/database");
const repo = require("../repositories/observabilityRepository");
const S = require("../utils/observabilitySanitizer");

/* ============================================================
 * CONFIGURAÇÃO
 * ============================================================ */

function readBool(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return !["false", "0", "off", "no"].includes(String(raw).trim().toLowerCase());
}

function readInt(name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = parseInt(process.env[name], 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function getConfig() {
  return {
    enabled: readBool("OBSERVABILITY_ENABLED", true),
    retentionDays: readInt("OBSERVABILITY_RETENTION_DAYS", 7, { min: 1, max: 365 }),
    maxRows: readInt("OBSERVABILITY_MAX_ROWS", 50000, { min: 1000, max: 5000000 }),
    slowMs: readInt("OBSERVABILITY_SLOW_MS", 1000, { min: 50, max: 120000 }),
    captureStack: readBool("OBSERVABILITY_CAPTURE_STACK", true),
    clientEvents: readBool("OBSERVABILITY_CLIENT_EVENTS", true),
  };
}

const QUEUE_MAX = 2000;
const QUEUE_BATCH = 100;
const QUEUE_INTERVAL_MS = 2000;
const CLIENT_BATCH_MAX_EVENTS = 200;
const CLIENT_EVENT_MAX_BYTES = 8 * 1024;

const WINDOWS = {
  "15m": 15 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
};

const CLIENT_EVENT_TYPES = new Set([
  "request",
  "network-error",
  "slow-request",
  "js-error",
  "unhandled-rejection",
  "console-error",
  "parse-error",
  "navigation",
  "test",
]);

const SEVERITIES = new Set(["info", "warn", "error"]);

/* ============================================================
 * FILA DE ESCRITA
 * ============================================================ */

const queue = {
  requests: [],
  clientEvents: [],
  dropped: 0,
  droppedByOverflow: 0,
  droppedByError: 0,
  written: { requests: 0, clientEvents: 0 },
  failures: 0,
  lastError: null,
  lastErrorAt: null,
  lastFlushAt: null,
  storageReady: null,
  timer: null,
  flushing: false,
};

function markStorageReady(ready, error) {
  queue.storageReady = ready;
  if (!ready && error) {
    queue.lastError = S.sanitizeMessage(error.message || String(error), 300);
    queue.lastErrorAt = new Date().toISOString();
  }
}

function scheduleFlush() {
  if (queue.timer) return;
  queue.timer = setTimeout(() => {
    queue.timer = null;
    flush().catch(() => {});
  }, QUEUE_INTERVAL_MS);
  if (typeof queue.timer.unref === "function") queue.timer.unref();
}

function enqueue(kind, row) {
  const bucket = queue[kind];
  if (bucket.length >= QUEUE_MAX) {
    queue.dropped += 1;
    queue.droppedByOverflow += 1;
    return false;
  }
  bucket.push(row);
  if (bucket.length >= QUEUE_BATCH) {
    flush().catch(() => {});
  } else {
    scheduleFlush();
  }
  return true;
}

async function flush() {
  if (queue.flushing) return;
  if (!queue.requests.length && !queue.clientEvents.length) return;
  queue.flushing = true;

  const requests = queue.requests.splice(0, QUEUE_BATCH);
  const events = queue.clientEvents.splice(0, QUEUE_BATCH);

  try {
    if (requests.length) {
      await repo.insertRequests(requests);
      queue.written.requests += requests.length;
    }
    if (events.length) {
      const inserted = await repo.insertClientEvents(events);
      queue.written.clientEvents += inserted;
    }
    queue.failures = 0;
    queue.lastFlushAt = new Date().toISOString();
    markStorageReady(true);
  } catch (err) {
    // Lote perdido de propósito: reenfileirar sem limite transformaria uma
    // indisponibilidade do banco em vazamento de memória no processo.
    queue.failures += 1;
    queue.dropped += requests.length + events.length;
    queue.droppedByError += requests.length + events.length;
    markStorageReady(false, err);
    if (queue.failures <= 3 || queue.failures % 50 === 0) {
      console.error(
        `[observability] falha ao gravar lote (${queue.failures}ª): ${err.message}`
      );
    }
  } finally {
    queue.flushing = false;
    if (queue.requests.length || queue.clientEvents.length) scheduleFlush();
  }
}

function getQueueStats() {
  return {
    pendentes: queue.requests.length + queue.clientEvents.length,
    pendentesRequests: queue.requests.length,
    pendentesEventos: queue.clientEvents.length,
    descartados: queue.dropped,
    descartadosPorFila: queue.droppedByOverflow,
    descartadosPorErro: queue.droppedByError,
    gravados: { ...queue.written },
    falhasConsecutivas: queue.failures,
    ultimoErro: queue.lastError,
    ultimoErroEm: queue.lastErrorAt,
    ultimoFlushEm: queue.lastFlushAt,
    limiteFila: QUEUE_MAX,
    tamanhoLote: QUEUE_BATCH,
    armazenamentoOk: queue.storageReady,
  };
}

async function shutdown() {
  if (queue.timer) {
    clearTimeout(queue.timer);
    queue.timer = null;
  }
  try {
    await flush();
  } catch {
    /* encerramento nunca falha por causa de log */
  }
}

/* ============================================================
 * INGESTÃO — SERVIDOR
 * ============================================================ */

function recordServerRequest(payload) {
  const config = getConfig();
  if (!config.enabled) return false;

  return enqueue("requests", {
    requestId: payload.requestId,
    method: payload.method,
    route: payload.route,
    path: payload.path,
    statusCode: payload.statusCode,
    durationMs: payload.durationMs,
    source: "server",
    userId: payload.userId ?? null,
    userEmail: payload.userEmail ?? null,
    userNome: payload.userNome ?? null,
    contentType: payload.contentType ?? null,
    responseSize: payload.responseSize ?? null,
    userAgent: payload.userAgent ?? null,
    errorName: payload.errorName ?? null,
    errorMessage: payload.errorMessage ?? null,
    errorStack: config.captureStack ? payload.errorStack ?? null : null,
    metadata: payload.metadata || {},
    createdAt: payload.createdAt || new Date().toISOString(),
  });
}

/* ============================================================
 * INGESTÃO — NAVEGADOR
 * ============================================================ */

function normalizeId(value, maxLength = 80) {
  const text = String(value == null ? "" : value).trim();
  if (!text) return null;
  if (!/^[A-Za-z0-9_.:-]{1,120}$/.test(text)) return null;
  return text.slice(0, maxLength);
}

function validateClientEvent(raw, context = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, motivo: "evento não é objeto" };
  }

  const eventType = String(raw.eventType || raw.type || "").trim();
  if (!CLIENT_EVENT_TYPES.has(eventType)) {
    return { ok: false, motivo: `eventType inválido: ${eventType.slice(0, 40)}` };
  }

  const eventId = normalizeId(raw.eventId) || crypto.randomUUID();
  const severityRaw = String(raw.severity || "info").toLowerCase();
  const severity = SEVERITIES.has(severityRaw) ? severityRaw : "info";

  let truncated = false;
  let serializedSize = 0;
  try {
    serializedSize = Buffer.byteLength(JSON.stringify(raw.data ?? {}), "utf8");
  } catch {
    serializedSize = CLIENT_EVENT_MAX_BYTES + 1;
  }

  let data = raw.data;
  if (serializedSize > CLIENT_EVENT_MAX_BYTES) {
    truncated = true;
    data = {
      truncadoNoServidor: true,
      bytesOriginais: serializedSize,
      resumo: S.sanitizeValue(raw.data, { maxDepth: 2, maxString: 400, maxArray: 5, maxKeys: 12 }),
    };
  }

  const statusCode = Number.isFinite(Number(raw.statusCode)) ? Number(raw.statusCode) : null;
  const durationMs = Number.isFinite(Number(raw.durationMs)) ? Math.round(Number(raw.durationMs)) : null;

  const createdAt = (() => {
    const parsed = raw.timestamp ? new Date(raw.timestamp) : null;
    if (!parsed || Number.isNaN(parsed.getTime())) return new Date().toISOString();
    // Relógio do cliente não define o passado/futuro do servidor.
    const now = Date.now();
    const value = parsed.getTime();
    if (value > now + 60_000 || value < now - 7 * 24 * 60 * 60 * 1000) {
      return new Date().toISOString();
    }
    return parsed.toISOString();
  })();

  return {
    ok: true,
    truncated,
    row: {
      eventId,
      requestId: normalizeId(raw.requestId),
      sessionId: normalizeId(raw.sessionId),
      tabId: normalizeId(raw.tabId),
      pageLoadId: normalizeId(raw.pageLoadId),
      page: S.sanitizeMessage(raw.page, 120),
      eventType,
      severity,
      message: S.sanitizeMessage(raw.message, 500),
      stack: getConfig().captureStack ? S.sanitizeStack(raw.stack) : null,
      data: S.sanitizeValue(data, { maxDepth: 5, maxString: 1500, maxArray: 30, maxKeys: 40 }) || {},
      method: S.sanitizeMessage(raw.method, 12),
      endpoint: raw.endpoint ? S.sanitizeUrl(raw.endpoint) : null,
      statusCode: statusCode !== null && statusCode >= 0 && statusCode <= 599 ? statusCode : null,
      durationMs: durationMs !== null && durationMs >= 0 && durationMs < 3_600_000 ? durationMs : null,
      userId: context.userId ?? null,
      userEmail: context.userEmail ?? null,
      createdAt,
    },
  };
}

function ingestClientEvents(events, context = {}) {
  const config = getConfig();
  if (!config.enabled || !config.clientEvents) {
    return { aceitos: 0, rejeitados: 0, truncados: 0, ignorados: true, motivo: "ingestão desabilitada" };
  }

  if (!Array.isArray(events)) {
    return { aceitos: 0, rejeitados: 0, truncados: 0, erro: "corpo deve conter um array `events`" };
  }

  const lote = events.slice(0, CLIENT_BATCH_MAX_EVENTS);
  const excedentes = Math.max(0, events.length - lote.length);

  let aceitos = 0;
  let rejeitados = excedentes;
  let truncados = 0;
  const motivos = [];

  for (const raw of lote) {
    const validated = validateClientEvent(raw, context);
    if (!validated.ok) {
      rejeitados += 1;
      if (motivos.length < 5) motivos.push(validated.motivo);
      continue;
    }
    if (validated.truncated) truncados += 1;
    if (enqueue("clientEvents", validated.row)) {
      aceitos += 1;
    } else {
      rejeitados += 1;
      if (motivos.length < 5) motivos.push("fila de escrita saturada");
    }
  }

  return { aceitos, rejeitados, truncados, excedentes, motivos };
}

/* ============================================================
 * LEITURA — janelas e filtros
 * ============================================================ */

function resolveWindow(value) {
  const key = WINDOWS[value] ? value : "1h";
  return { key, ms: WINDOWS[key], since: new Date(Date.now() - WINDOWS[key]).toISOString() };
}

function parseFilters(query = {}) {
  const config = getConfig();
  const janela = resolveWindow(query.window);

  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), 200);
  const page = Math.max(parseInt(query.page, 10) || 1, 1);

  const statusRaw = String(query.status || "").trim().toLowerCase();
  const statusExactCandidate = parseInt(statusRaw, 10);

  const parseIso = (value) => {
    if (typeof value !== "string" || !value.trim()) return null;
    const data = new Date(value);
    return Number.isNaN(data.getTime()) ? null : data.toISOString();
  };

  return {
    window: janela.key,
    since: parseIso(query.since) || janela.since,
    until: parseIso(query.until),
    method: /^[A-Za-z]{3,7}$/.test(String(query.method || "")) ? String(query.method).toUpperCase() : null,
    source: ["server", "browser"].includes(String(query.source || "")) ? String(query.source) : null,
    route: typeof query.route === "string" && query.route.trim() ? query.route.trim().slice(0, 200) : null,
    screen: typeof query.screen === "string" && query.screen.trim() ? query.screen.trim().slice(0, 120) : null,
    user: typeof query.user === "string" && query.user.trim() ? query.user.trim().slice(0, 160) : null,
    requestId: typeof query.requestId === "string" && query.requestId.trim()
      ? query.requestId.trim().slice(0, 120)
      : null,
    sessionId: typeof query.sessionId === "string" && query.sessionId.trim()
      ? query.sessionId.trim().slice(0, 120)
      : null,
    statusClass: ["success", "4xx", "5xx", "network"].includes(statusRaw) ? statusRaw : null,
    statusExact: Number.isFinite(statusExactCandidate) && statusExactCandidate >= 100 && statusExactCandidate <= 599
      ? statusExactCandidate
      : null,
    onlyErrors: String(query.onlyErrors) === "true" || String(query.onlyErrors) === "1",
    onlySlow: String(query.onlySlow) === "true" || String(query.onlySlow) === "1",
    slowMs: config.slowMs,
    search: typeof query.search === "string" && query.search.trim() ? query.search.trim().slice(0, 120) : null,
    sortBy: Object.keys(repo.SORT_COLUMNS).includes(String(query.sortBy)) ? String(query.sortBy) : "created_at",
    sortDir: String(query.sortDir).toLowerCase() === "asc" ? "asc" : "desc",
    limit,
    offset: (page - 1) * limit,
    pageNumber: page,
  };
}

async function getSummary(query = {}) {
  const config = getConfig();
  const janela = resolveWindow(query.window);
  const dados = await repo.getSummary({ since: janela.since, slowMs: config.slowMs });

  const servidor = dados.servidor || {};
  const navegador = dados.navegador || {};
  const total = Number(servidor.total || 0);
  const sucesso = Number(servidor.sucesso || 0);
  const minutos = Math.max(1, janela.ms / 60000);

  return {
    janela: janela.key,
    desde: janela.since,
    slowMs: config.slowMs,
    total,
    porMinuto: Math.round((total / minutos) * 100) / 100,
    percentualSucesso: total ? Math.round((sucesso / total) * 1000) / 10 : null,
    erros4xx: Number(servidor.erros_4xx || 0),
    erros5xx: Number(servidor.erros_5xx || 0),
    falhasRede: Number(navegador.falhas_rede || 0),
    errosNavegador: Number(navegador.erros || 0),
    errosJs: Number(navegador.erros_js || 0),
    rejeicoesNaoTratadas: Number(navegador.rejeicoes || 0),
    eventosNavegador: Number(navegador.total || 0),
    sessoes: Number(navegador.sessoes || 0),
    duracaoMedia: Number(servidor.duracao_media || 0),
    p50: Number(servidor.p50 || 0),
    p95: Number(servidor.p95 || 0),
    p99: Number(servidor.p99 || 0),
    lentas: Number(servidor.lentas || 0),
    rotaComMaisErros: dados.rotaComMaisErros,
    rotaMaisLenta: dados.rotaMaisLenta,
    ultimoErro: dados.ultimoErro,
    porMinutoSerie: dados.porMinuto,
    porStatus: dados.porStatus,
    fila: getQueueStats(),
  };
}

async function listRequests(query = {}) {
  const filtros = parseFilters(query);
  const { rows, total } = await repo.listRequests(filtros);
  return {
    filtros: {
      window: filtros.window,
      since: filtros.since,
      limit: filtros.limit,
      page: filtros.pageNumber,
      sortBy: filtros.sortBy,
      sortDir: filtros.sortDir,
    },
    total,
    page: filtros.pageNumber,
    totalPages: Math.max(1, Math.ceil(total / filtros.limit)),
    slowMs: filtros.slowMs,
    requests: rows,
  };
}

async function getRequestDetail(requestId) {
  const id = String(requestId || "").trim().slice(0, 120);
  if (!id) return null;

  const { server, client } = await repo.getRequestDetail(id);
  if (!server.length && !client.length) return null;

  const timeline = [];
  for (const row of client) {
    timeline.push({
      fonte: "browser",
      em: row.created_at,
      tipo: row.event_type,
      severidade: row.severity,
      titulo: row.message || row.event_type,
      pagina: row.page,
      duracao: row.duration_ms,
      status: row.status_code,
    });
  }
  for (const row of server) {
    timeline.push({
      fonte: "server",
      em: row.created_at,
      tipo: "request",
      severidade: row.status_code >= 500 ? "error" : row.status_code >= 400 ? "warn" : "info",
      titulo: `${row.method} ${row.route || row.path} → ${row.status_code}`,
      duracao: row.duration_ms,
      status: row.status_code,
    });
  }
  timeline.sort((a, b) => new Date(a.em) - new Date(b.em));

  const principal = server[0] || null;
  const eventoRequest = client.find((row) => row.event_type === "request" || row.event_type === "network-error") || null;

  return {
    requestId: id,
    servidor: principal,
    servidorDuplicados: server.length > 1 ? server.slice(1) : [],
    navegador: client,
    eventoPrincipal: eventoRequest,
    timeline,
    correlacao: {
      temServidor: !!principal,
      temNavegador: client.length > 0,
      completa: !!principal && client.length > 0,
      motivo: !principal
        ? "sem registro no servidor (request não chegou, foi ignorada pelo middleware ou o histórico expirou)"
        : !client.length
          ? "sem eventos de navegador (debug desligado, outro dispositivo ou evento ainda não sincronizado)"
          : null,
    },
  };
}

function errorSignature(grupo) {
  return crypto
    .createHash("sha1")
    .update(`${grupo.origem}|${grupo.tipo}|${grupo.rota}|${grupo.mensagem}`)
    .digest("hex")
    .slice(0, 16);
}

async function getErrors(query = {}) {
  const janela = resolveWindow(query.window);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 60, 1), 200);
  const dados = await repo.getErrorGroups({ since: janela.since, limit });

  const grupos = [];

  for (const row of dados.servidor) {
    const grupo = {
      origem: "server",
      tipo: row.tipo,
      mensagem: row.mensagem,
      rota: row.rota,
      metodo: row.method,
      status: row.status_code,
      total: row.total,
      usuarios: row.usuarios,
      primeira: row.primeira,
      ultima: row.ultima,
      ultimoRequestId: row.ultimo_request_id,
      stack: row.stack,
      severidade: row.status_code >= 500 || row.tipo !== `HTTP ${row.status_code}` ? "alta" : "media",
    };
    grupo.assinatura = errorSignature(grupo);
    grupos.push(grupo);
  }

  for (const row of dados.navegador) {
    const grupo = {
      origem: "browser",
      tipo: row.tipo,
      mensagem: row.mensagem,
      rota: row.rota,
      metodo: row.method,
      status: row.status_code,
      total: row.total,
      usuarios: row.usuarios,
      primeira: row.primeira,
      ultima: row.ultima,
      ultimoRequestId: row.ultimo_request_id,
      stack: row.stack,
      severidade: row.tipo === "js-error" || row.tipo === "unhandled-rejection" ? "alta" : "media",
    };
    grupo.assinatura = errorSignature(grupo);
    grupos.push(grupo);
  }

  grupos.sort((a, b) => b.total - a.total || new Date(b.ultima) - new Date(a.ultima));

  return { janela: janela.key, desde: janela.since, total: grupos.length, grupos };
}

async function getRouteStats(query = {}) {
  const config = getConfig();
  const janela = resolveWindow(query.window);
  return repo.getRouteStats({ since: janela.since, slowMs: config.slowMs });
}

async function getSessions(query = {}) {
  const janela = resolveWindow(query.window);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 30, 1), 100);
  return repo.getSessions({ since: janela.since, limit });
}

/* ============================================================
 * HEALTH
 * ============================================================ */

const INTEGRACOES = [
  {
    id: "postgres",
    nome: "PostgreSQL",
    envs: ["DATABASE_URL"],
    testavel: true,
  },
  {
    id: "jwt",
    nome: "Autenticação JWT",
    envs: ["JWT_SECRET"],
    testavel: false,
    nota: "Sem JWT_SECRET o servidor usa um segredo local de desenvolvimento.",
  },
  {
    id: "mercadolivre",
    nome: "Mercado Livre",
    envs: ["ML_CLIENT_ID", "ML_CLIENT_SECRET", "ML_REDIRECT_URI"],
    testavel: true,
  },
  {
    id: "google_drive",
    nome: "Google Drive",
    envs: ["GOOGLE_APPLICATION_CREDENTIALS", "GOOGLE_DRIVE_FOLDER_ID"],
    testavel: true,
  },
  {
    id: "clickup",
    nome: "ClickUp",
    envs: ["CLICKUP_TOKEN"],
    testavel: true,
  },
  {
    id: "ia",
    nome: "IA (Anthropic)",
    envs: ["ANTHROPIC_API_KEY"],
    testavel: false,
    nota: "Teste ativo não executado: chamada à API é cobrada.",
  },
  {
    id: "firebase_externo",
    nome: "Integração Firebase externa",
    envs: ["EXTERNAL_FIREBASE_SYNC_KEY"],
    testavel: false,
  },
];

function describeIntegrations() {
  return INTEGRACOES.map((item) => {
    const faltando = item.envs.filter((name) => !String(process.env[name] || "").trim());
    return {
      id: item.id,
      nome: item.nome,
      // Nunca o valor — apenas o nome da variável e se ela existe.
      variaveis: item.envs.map((name) => ({
        nome: name,
        presente: !!String(process.env[name] || "").trim(),
      })),
      configuracao: faltando.length === 0 ? "configurado" : faltando.length === item.envs.length ? "nao_configurado" : "parcial",
      testavel: item.testavel,
      teste: "nao_testado",
      nota: item.nota || null,
    };
  });
}

async function getHealth() {
  const config = getConfig();
  const memoria = process.memoryUsage();

  const banco = { status: "falha", latenciaMs: null, erro: null, pool: null };
  try {
    banco.latenciaMs = await repo.ping();
    banco.status = "saudavel";
  } catch (err) {
    banco.erro = S.sanitizeMessage(err.message, 240);
  }

  try {
    banco.pool = {
      total: typeof pool.totalCount === "number" ? pool.totalCount : null,
      ociosas: typeof pool.idleCount === "number" ? pool.idleCount : null,
      aguardando: typeof pool.waitingCount === "number" ? pool.waitingCount : null,
    };
  } catch {
    banco.pool = null;
  }

  let armazenamento = null;
  if (banco.status === "saudavel") {
    try {
      armazenamento = await repo.getStorageStats();
    } catch (err) {
      armazenamento = { erro: S.sanitizeMessage(err.message, 240) };
    }
  }

  const statusGeral = banco.status === "saudavel"
    ? (getQueueStats().falhasConsecutivas > 0 ? "atencao" : "saudavel")
    : "atencao";

  return {
    statusGeral,
    api: {
      status: "saudavel",
      uptimeSegundos: Math.round(process.uptime()),
      node: process.version,
      ambiente: process.env.NODE_ENV || "development",
      plataforma: `${process.platform} ${process.arch}`,
      horaServidor: new Date().toISOString(),
      versao: process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || process.env.APP_VERSION || null,
      memoria: {
        rssMb: Math.round((memoria.rss / 1024 / 1024) * 10) / 10,
        heapUsadoMb: Math.round((memoria.heapUsed / 1024 / 1024) * 10) / 10,
        heapTotalMb: Math.round((memoria.heapTotal / 1024 / 1024) * 10) / 10,
        sistemaLivreMb: Math.round((os.freemem() / 1024 / 1024) * 10) / 10,
      },
    },
    banco,
    observabilidade: {
      habilitada: config.enabled,
      eventosNavegador: config.clientEvents,
      capturaStack: config.captureStack,
      retencaoDias: config.retentionDays,
      maxLinhas: config.maxRows,
      slowMs: config.slowMs,
      armazenamento,
      fila: getQueueStats(),
    },
    integracoes: describeIntegrations(),
  };
}

async function fetchComTimeout(url, options = {}, timeoutMs = 4000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

const HEALTH_CHECKS = {
  async postgres() {
    const latencia = await repo.ping();
    return { resultado: "ok", detalhe: `SELECT 1 respondeu em ${latencia}ms`, latenciaMs: latencia };
  },

  async observabilidade() {
    const inicio = Date.now();
    await pool.query("SELECT 1 FROM observability_requests LIMIT 1");
    await pool.query("SELECT 1 FROM observability_client_events LIMIT 1");
    return {
      resultado: "ok",
      detalhe: "tabelas de observabilidade legíveis (somente leitura)",
      latenciaMs: Date.now() - inicio,
    };
  },

  async mercadolivre() {
    if (!process.env.ML_CLIENT_ID) {
      return { resultado: "nao_configurado", detalhe: "ML_CLIENT_ID ausente" };
    }
    const inicio = Date.now();
    // Endpoint público e somente leitura: valida rede/DNS sem usar credencial.
    const resp = await fetchComTimeout("https://api.mercadolibre.com/sites/MLB");
    return {
      resultado: resp.ok ? "ok" : "falhou",
      detalhe: `GET /sites/MLB → HTTP ${resp.status}`,
      latenciaMs: Date.now() - inicio,
    };
  },

  async clickup() {
    const token = String(process.env.CLICKUP_TOKEN || "").trim();
    if (!token) return { resultado: "nao_configurado", detalhe: "CLICKUP_TOKEN ausente" };
    const inicio = Date.now();
    const resp = await fetchComTimeout("https://api.clickup.com/api/v2/user", {
      headers: { Authorization: token },
    });
    return {
      resultado: resp.ok ? "ok" : "falhou",
      detalhe: `GET /v2/user → HTTP ${resp.status}`,
      latenciaMs: Date.now() - inicio,
    };
  },

  async google_drive() {
    const caminho = String(process.env.GOOGLE_APPLICATION_CREDENTIALS || "").trim();
    if (!caminho) {
      return { resultado: "nao_configurado", detalhe: "GOOGLE_APPLICATION_CREDENTIALS ausente" };
    }
    if (!fs.existsSync(caminho)) {
      return { resultado: "falhou", detalhe: "arquivo de credencial não encontrado no caminho configurado" };
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(caminho, "utf8"));
      // Só a forma da credencial é reportada — nenhum campo é devolvido.
      const camposEsperados = ["client_email", "private_key", "project_id"];
      const faltando = camposEsperados.filter((campo) => !parsed[campo]);
      return faltando.length
        ? { resultado: "falhou", detalhe: `credencial sem campos: ${faltando.join(", ")}` }
        : { resultado: "ok", detalhe: "credencial legível e com os campos esperados" };
    } catch {
      return { resultado: "falhou", detalhe: "credencial ilegível ou JSON inválido" };
    }
  },
};

async function runHealthChecks(alvos) {
  const pedidos = Array.isArray(alvos) && alvos.length
    ? alvos.filter((alvo) => Object.prototype.hasOwnProperty.call(HEALTH_CHECKS, alvo))
    : Object.keys(HEALTH_CHECKS);

  const resultados = {};
  for (const alvo of pedidos) {
    const inicio = Date.now();
    try {
      resultados[alvo] = { ...(await HEALTH_CHECKS[alvo]()), executadoEm: new Date().toISOString() };
    } catch (err) {
      resultados[alvo] = {
        resultado: "falhou",
        detalhe: S.sanitizeMessage(err?.name === "AbortError" ? "timeout" : err?.message, 240),
        latenciaMs: Date.now() - inicio,
        executadoEm: new Date().toISOString(),
      };
    }
  }

  return {
    disponiveis: Object.keys(HEALTH_CHECKS),
    executados: pedidos,
    resultados,
  };
}

/* ============================================================
 * INVENTÁRIO DE ROTAS (introspecção defensiva do Express)
 * ============================================================ */

const AUTH_HANDLERS = new Set(["authMiddleware", "apiKeyMiddleware", "externalApiKeyMiddleware"]);
const ADMIN_HANDLERS = new Set(["requireAdmin"]);

function extractMountPath(layer) {
  if (!layer || !layer.regexp) return null;
  if (layer.regexp.fast_slash) return "";
  const origem = layer.regexp.source;
  const casado = origem.match(/^\^\\\/(.*?)\\\/\?\(\?=\\\/\|\$\)\$?$/);
  if (!casado) return null;
  const bruto = casado[1].replace(/\\\//g, "/").replace(/\\\./g, ".");
  if (/[()[\]?+*]/.test(bruto)) return null;
  return `/${bruto}`;
}

function collectLayer(layer, prefix, herdados, saida, profundidade) {
  if (profundidade > 8) return;

  if (layer.route && layer.route.path !== undefined) {
    const handlers = (layer.route.stack || []).map((item) => item.name || "");
    const nomes = [...herdados, ...handlers];
    const caminhos = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];

    for (const caminho of caminhos) {
      const completo = `${prefix}${caminho}`.replace(/\/{2,}/g, "/") || "/";
      for (const [metodo, ativo] of Object.entries(layer.route.methods || {})) {
        if (!ativo || metodo === "_all") continue;
        saida.push({
          metodo: metodo.toUpperCase(),
          caminho: prefix === null ? `desconhecido${caminho}` : completo,
          area: areaDoCaminho(prefix === null ? caminho : completo),
          autenticacao: prefix === null
            ? "desconhecido"
            : nomes.some((nome) => AUTH_HANDLERS.has(nome)) ? "sim" : "nao",
          adminOnly: prefix === null
            ? "desconhecido"
            : nomes.some((nome) => ADMIN_HANDLERS.has(nome)) ? "sim" : "nao",
          middlewares: nomes.filter(Boolean).slice(0, 8),
          introspeccao: prefix === null ? "parcial" : "ok",
        });
      }
    }
    return;
  }

  if (layer.name === "router" && layer.handle && Array.isArray(layer.handle.stack)) {
    const montagem = extractMountPath(layer);
    const novoPrefixo = montagem === null ? null : `${prefix || ""}${montagem}`;
    const nomeHandlers = [...herdados];
    for (const sub of layer.handle.stack) {
      // Middlewares aplicados com router.use() antes das rotas são herdados.
      if (!sub.route && sub.name && sub.name !== "router" && sub.regexp && sub.regexp.fast_slash) {
        nomeHandlers.push(sub.name);
        continue;
      }
      collectLayer(sub, novoPrefixo, nomeHandlers, saida, profundidade + 1);
    }
  }
}

function areaDoCaminho(caminho) {
  const limpo = String(caminho || "").split("?")[0];
  const partes = limpo.split("/").filter(Boolean);
  if (!partes.length) return "raiz";
  if (partes[0] === "admin") return partes[1] ? `admin/${partes[1]}` : "admin";
  return partes[0];
}

function buildRouteInventory(app) {
  const router = app && (app._router || (app.router && Array.isArray(app.router.stack) ? app.router : null));
  if (!router || !Array.isArray(router.stack)) {
    return {
      ok: false,
      motivo: "introspecção do Express indisponível nesta versão — inventário não pode ser gerado",
      rotas: [],
    };
  }

  const saida = [];
  try {
    for (const layer of router.stack) {
      collectLayer(layer, "", [], saida, 0);
    }
  } catch (err) {
    return {
      ok: false,
      motivo: S.sanitizeMessage(`falha ao percorrer a stack do Express: ${err.message}`, 240),
      rotas: saida,
    };
  }

  const vistos = new Set();
  const rotas = saida.filter((rota) => {
    const chave = `${rota.metodo} ${rota.caminho}`;
    if (vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  });

  rotas.sort((a, b) => a.caminho.localeCompare(b.caminho) || a.metodo.localeCompare(b.metodo));

  return { ok: true, total: rotas.length, rotas };
}

/* ============================================================
 * EXPORT
 * ============================================================ */

const EXPORT_COLUMNS = [
  "created_at",
  "source",
  "request_id",
  "method",
  "route",
  "status_code",
  "duration_ms",
  "user_email",
  "page",
  "error_message",
];

function toCsv(rows) {
  const escapar = (valor) => {
    if (valor === null || valor === undefined) return "";
    const texto = String(valor).replace(/\r?\n/g, " ");
    return /[",;]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
  };
  const linhas = [EXPORT_COLUMNS.join(",")];
  for (const row of rows) {
    linhas.push(EXPORT_COLUMNS.map((coluna) => escapar(row[coluna])).join(","));
  }
  return linhas.join("\n");
}

async function exportRequests(query = {}) {
  const filtros = parseFilters(query);
  filtros.limit = Math.min(Math.max(parseInt(query.limit, 10) || 5000, 1), 20000);
  const rows = await repo.exportRequests(filtros);
  return rows.map((row) => ({
    ...row,
    route: S.sanitizeUrl(row.route),
    path: S.sanitizeUrl(row.path),
    error_message: S.sanitizeMessage(row.error_message, 300),
  }));
}

/* ============================================================
 * RETENÇÃO
 * ============================================================ */

let retentionTimer = null;

async function runCleanup() {
  const config = getConfig();
  if (!config.enabled) return null;
  try {
    const removidos = await repo.cleanup({
      retentionDays: config.retentionDays,
      maxRows: config.maxRows,
    });
    markStorageReady(true);
    return removidos;
  } catch (err) {
    markStorageReady(false, err);
    console.error("[observability] limpeza de retenção falhou:", err.message);
    return null;
  }
}

function startRetentionJob({ intervalMs = 6 * 60 * 60 * 1000 } = {}) {
  if (retentionTimer) return retentionTimer;
  retentionTimer = setInterval(() => {
    runCleanup().catch(() => {});
  }, intervalMs);
  if (typeof retentionTimer.unref === "function") retentionTimer.unref();
  return retentionTimer;
}

function stopRetentionJob() {
  if (retentionTimer) {
    clearInterval(retentionTimer);
    retentionTimer = null;
  }
}

async function purge({ before }) {
  const limite = before ? new Date(before) : new Date();
  if (Number.isNaN(limite.getTime())) throw new Error("data limite inválida");
  const removidos = await repo.purge({ before: limite.toISOString() });
  return { ...removidos, antesDe: limite.toISOString() };
}

module.exports = {
  // config
  getConfig,
  resolveWindow,
  parseFilters,
  WINDOWS,
  CLIENT_EVENT_TYPES,
  CLIENT_BATCH_MAX_EVENTS,
  CLIENT_EVENT_MAX_BYTES,
  // escrita
  recordServerRequest,
  ingestClientEvents,
  validateClientEvent,
  flush,
  shutdown,
  getQueueStats,
  // leitura
  getSummary,
  listRequests,
  getRequestDetail,
  getErrors,
  getRouteStats,
  getSessions,
  exportRequests,
  toCsv,
  EXPORT_COLUMNS,
  // health / rotas
  getHealth,
  runHealthChecks,
  buildRouteInventory,
  extractMountPath,
  // retenção
  runCleanup,
  startRetentionJob,
  stopRetentionJob,
  purge,
};
