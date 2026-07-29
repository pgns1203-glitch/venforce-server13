/*
 * VenForce — Coletor de observabilidade do navegador (v2)
 *
 * O que mudou em relação à v1 e por quê:
 *  - sessionStorage → IndexedDB. sessionStorage é isolado por aba e some ao
 *    fechar: o Control Center aberto em outra aba nunca via o erro que
 *    aconteceu no dashboard. IndexedDB é compartilhado pela origem e sobrevive
 *    a F5 e a fechar/reabrir a aba.
 *  - 100 → ~1000 eventos, com poda por idade e por volume.
 *  - fetch + XMLHttpRequest + window.error + unhandledrejection + console.error
 *    (opcional) + navegação + request lenta.
 *  - BroadcastChannel sincroniza abas em tempo real.
 *  - Envio em lote para POST /admin/observability/client-events, com fila
 *    local quando o servidor está fora.
 *
 * Invariantes:
 *  - Uma falha aqui NUNCA pode quebrar uma tela do Portal.
 *  - A response original nunca é consumida — só clones.
 *  - O JWT nunca entra em nenhum evento.
 */
(function () {
  "use strict";

  if (window.VFDebugClient && window.VFDebugClient.version === "2.0.0") return;

  var VERSION = "2.0.0";

  var TOKEN_KEY = "vf-token";
  var USER_KEY = "vf-user";
  var ENABLED_KEY = "vf-debug-enabled";
  var CONFIG_KEY = "vf-debug-config";
  var SESSION_KEY = "vf-debug-session";
  var TAB_KEY = "vf-debug-tab";
  var SIGNAL_KEY = "vf-debug-signal";
  var LEGACY_LOG_KEY = "vf-debug-logs";
  var LEGACY_MIGRATED_KEY = "vf-debug-legacy-migrado";
  var API_BASE_KEY = "vf-api-base";

  var DB_NAME = "venforce-debug";
  var DB_VERSION = 1;
  var STORE = "events";
  var CHANNEL_NAME = "vf-debug-events";

  var DEFAULT_API_BASE = "https://venforce-server.onrender.com";
  var INGEST_PATH = "/admin/observability/client-events";

  var MAX_EVENTS = 1000;
  var MAX_TEXT_CHARS = 1500;
  var MAX_RESPONSE_BYTES = 50000;
  var SYNC_BATCH = 25;
  var SYNC_INTERVAL_MS = 8000;
  var SYNC_MAX_BACKOFF_MS = 120000;
  var TRIM_EVERY = 40;

  var DEFAULT_CONFIG = {
    captureConsole: false,
    captureNavigation: true,
    slowMs: 1500,
    sync: true
  };

  /* ============================================================
   * SANITIZAÇÃO (espelho de server/utils/observabilitySanitizer.js)
   * O backend sanitiza de novo — isto reduz o que sai da máquina.
   * ============================================================ */

  var SENSITIVE_KEY_PARTS = [
    "authorization",
    "cookie",
    "setcookie",
    "token",
    "accesstoken",
    "refreshtoken",
    "apikey",
    "xapikey",
    "password",
    "senha",
    "secret",
    "clientsecret",
    "credential",
    "privatekey"
  ];

  // Exato, não substring: "code" por substring destruiria status_code.
  var SENSITIVE_KEY_EXACT = ["code", "jwt", "auth"];

  var REDACTED = "[redacted]";

  function normalizeKey(key) {
    return String(key == null ? "" : key).toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function isSensitiveKey(key) {
    var normalized = normalizeKey(key);
    if (!normalized) return false;
    if (SENSITIVE_KEY_EXACT.indexOf(normalized) !== -1) return true;
    for (var i = 0; i < SENSITIVE_KEY_PARTS.length; i++) {
      if (normalized.indexOf(SENSITIVE_KEY_PARTS[i]) !== -1) return true;
    }
    return false;
  }

  function looksSensitiveValue(value) {
    if (typeof value !== "string") return false;
    var text = value.trim();
    if (!text) return false;
    if (/^Bearer\s+\S/i.test(text)) return true;
    if (/^Basic\s+\S/i.test(text)) return true;
    if (/^eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\./.test(text)) return true;
    if (/^vf_[a-f0-9]{16,}$/i.test(text)) return true;
    if (/^(sk|pk|ghp|gho|glpat|xoxb|xoxp)[-_][A-Za-z0-9_-]{16,}$/i.test(text)) return true;
    if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) return true;
    return text.length > 120 && !/\s/.test(text) && /^[A-Za-z0-9._~+/=-]+$/.test(text);
  }

  function maskValue(value) {
    if (value === null || value === undefined) return null;
    if (typeof value !== "string") return REDACTED;
    var text = value.trim();
    if (!text) return null;
    if (/^Bearer\s+/i.test(text)) return "Bearer " + REDACTED;
    if (/^Basic\s+/i.test(text)) return "Basic " + REDACTED;
    return REDACTED;
  }

  // Segredos EMBUTIDOS em texto livre (mensagens de erro, stacks, URLs coladas
  // em log). looksSensitiveValue só decide sobre o valor inteiro.
  var PADROES_EMBUTIDOS = [
    [/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer " + REDACTED],
    [/Basic\s+[A-Za-z0-9+/=]{8,}/gi, "Basic " + REDACTED],
    [/\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*/g, REDACTED],
    [/\bvf_[a-f0-9]{16,}\b/gi, REDACTED],
    [/\b(?:sk|pk|ghp|gho|glpat|xoxb|xoxp)[-_][A-Za-z0-9_-]{16,}\b/gi, REDACTED],
    [/\bAPP_USR-[A-Za-z0-9-]{8,}/gi, REDACTED],
    [/\bTG-[A-Za-z0-9-]{8,}/gi, REDACTED],
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, REDACTED]
  ];

  function scrubSecrets(text) {
    var saida = String(text);
    for (var i = 0; i < PADROES_EMBUTIDOS.length; i++) {
      saida = saida.replace(PADROES_EMBUTIDOS[i][0], PADROES_EMBUTIDOS[i][1]);
    }
    return saida.replace(
      /\b(authorization|token|access_token|refresh_token|api_?key|password|senha|secret|client_secret|credential|code|jwt)=([^\s&"']{3,})/gi,
      function (todo, chave) { return chave + "=" + REDACTED; }
    );
  }

  function truncate(value, max) {
    var limit = max || MAX_TEXT_CHARS;
    var text = String(value == null ? "" : value);
    if (text.length <= limit) return text;
    return text.slice(0, limit) + "…[truncado " + (text.length - limit) + " chars]";
  }

  var FORBIDDEN_KEYS = ["__proto__", "constructor", "prototype"];

  function sanitize(value, depth, seen) {
    var level = depth || 0;
    var visited = seen || [];

    if (value === null || value === undefined) return null;

    var type = typeof value;
    if (type === "string") {
      return looksSensitiveValue(value) ? maskValue(value) : truncate(scrubSecrets(value));
    }
    if (type === "number") return isFinite(value) ? value : String(value);
    if (type === "boolean") return value;
    if (type === "function") return "[function]";
    if (type === "symbol" || type === "bigint") return String(value);

    if (value instanceof Date) return value.toISOString();
    if (typeof Error !== "undefined" && value instanceof Error) {
      return {
        name: String(value.name || "Error"),
        message: truncate(value.message, 400),
        stack: value.stack ? truncate(String(value.stack).split("\n").slice(0, 12).join("\n"), 3000) : null
      };
    }
    if (typeof Blob !== "undefined" && value instanceof Blob) {
      return { tipo: "blob", bytes: value.size, contentType: value.type || null };
    }
    if (typeof File !== "undefined" && value instanceof File) return summarizeFile(value);
    if (typeof ArrayBuffer !== "undefined" && value instanceof ArrayBuffer) {
      return { tipo: "arrayBuffer", bytes: value.byteLength };
    }
    if (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView && ArrayBuffer.isView(value)) {
      return { tipo: "typedArray", bytes: value.byteLength };
    }

    if (level >= 6) return "[profundidade máxima]";
    if (visited.indexOf(value) !== -1) return "[circular]";
    visited = visited.concat([value]);

    if (Object.prototype.toString.call(value) === "[object Array]") {
      var slice = value.slice(0, 50);
      var arr = [];
      for (var i = 0; i < slice.length; i++) arr.push(sanitize(slice[i], level + 1, visited));
      if (value.length > 50) arr.push("[+" + (value.length - 50) + " itens omitidos]");
      return arr;
    }

    if (type !== "object") return truncate(String(value));

    var out = {};
    var keys = Object.keys(value);
    var count = 0;
    for (var k = 0; k < keys.length; k++) {
      var key = keys[k];
      if (FORBIDDEN_KEYS.indexOf(key) !== -1) continue;
      if (count >= 40) {
        out["[omitido]"] = keys.length - count + " chaves adicionais";
        break;
      }
      count++;
      out[key] = isSensitiveKey(key) ? maskValue(value[key]) : sanitize(value[key], level + 1, visited);
    }
    return out;
  }

  function summarizeFile(file) {
    if (!file) return null;
    var name = String(file.name || "arquivo").replace(/[^\w.\- ]+/g, "_").slice(0, 120);
    var dot = name.lastIndexOf(".");
    return {
      arquivo: name,
      extensao: dot > 0 ? name.slice(dot + 1).toLowerCase() : null,
      tipo: file.type || null,
      bytes: typeof file.size === "number" ? file.size : null
      // conteúdo binário nunca é lido nem armazenado
    };
  }

  function sanitizeUrl(raw) {
    var text = String(raw == null ? "" : raw);
    if (!text) return "";
    var url;
    try {
      url = new URL(text, window.location.href);
    } catch (e) {
      return looksSensitiveValue(text) ? REDACTED : truncate(text, 512);
    }
    var chaves = [];
    url.searchParams.forEach(function (v, k) {
      if (chaves.indexOf(k) === -1) chaves.push(k);
    });
    for (var i = 0; i < chaves.length; i++) {
      var chave = chaves[i];
      var valores = url.searchParams.getAll(chave);
      var sensivel = isSensitiveKey(chave);
      for (var j = 0; j < valores.length && !sensivel; j++) {
        if (looksSensitiveValue(valores[j])) sensivel = true;
      }
      if (sensivel) {
        url.searchParams.delete(chave);
        url.searchParams.set(chave, REDACTED);
      }
    }
    url.pathname = url.pathname.split("/").map(function (segmento) {
      if (!segmento) return segmento;
      var decodificado = segmento;
      try { decodificado = decodeURIComponent(segmento); } catch (e) { /* segmento inválido */ }
      return looksSensitiveValue(decodificado) ? REDACTED : segmento;
    }).join("/");
    url.username = "";
    url.password = "";
    url.hash = "";
    // Uma URL relativa continua relativa: transformar "/bases" em
    // "http://host/bases" polui a coluna endpoint e quebra o agrupamento.
    var relativa = !/^[a-z][a-z0-9+.-]*:/i.test(text) && text.indexOf("//") !== 0;
    return truncate(relativa ? url.pathname + url.search : url.toString(), 512);
  }

  function endpointFromUrl(raw) {
    try {
      var url = new URL(String(raw || ""), window.location.href);
      var limpo = sanitizeUrl(url.toString());
      var parsed = new URL(limpo, window.location.href);
      return parsed.pathname + parsed.search;
    } catch (e) {
      return sanitizeUrl(raw);
    }
  }

  function sanitizeHeaders(headers) {
    var out = {};
    if (!headers) return out;
    var keys = Object.keys(headers);
    for (var i = 0; i < keys.length && i < 40; i++) {
      var key = keys[i];
      if (FORBIDDEN_KEYS.indexOf(key) !== -1) continue;
      var value = headers[key];
      out[key] = isSensitiveKey(key) || looksSensitiveValue(value) ? maskValue(value) : truncate(value, 300);
    }
    return out;
  }

  /* ============================================================
   * ESTADO / IDENTIDADE
   * ============================================================ */

  var runtime = {
    indexedDb: "verificando",
    broadcastChannel: false,
    installedFetch: false,
    installedXhr: false,
    installedErrors: false,
    lastSyncAt: null,
    lastSyncError: null,
    lastSyncCount: 0,
    pending: 0,
    writes: 0,
    droppedLocal: 0,
    memoryFallback: false
  };

  function readJson(storage, key, fallback) {
    try {
      var raw = storage.getItem(key);
      if (!raw) return fallback;
      var parsed = JSON.parse(raw);
      return parsed === null || parsed === undefined ? fallback : parsed;
    } catch (e) {
      return fallback;
    }
  }

  function readUser() {
    return readJson(localStorage, USER_KEY, {}) || {};
  }

  function isAdminUser() {
    return String((readUser() || {}).role || "").toLowerCase() === "admin";
  }

  function hasToken() {
    try { return !!localStorage.getItem(TOKEN_KEY); } catch (e) { return false; }
  }

  function getConfig() {
    var stored = readJson(localStorage, CONFIG_KEY, {}) || {};
    return {
      captureConsole: stored.captureConsole === true,
      captureNavigation: stored.captureNavigation !== false,
      slowMs: typeof stored.slowMs === "number" && stored.slowMs >= 200 ? stored.slowMs : DEFAULT_CONFIG.slowMs,
      sync: stored.sync !== false
    };
  }

  function setConfig(patch) {
    var next = Object.assign({}, getConfig(), patch || {});
    try { localStorage.setItem(CONFIG_KEY, JSON.stringify(next)); } catch (e) { /* storage cheio */ }
    return next;
  }

  function uuid() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
      if (window.crypto && window.crypto.getRandomValues) {
        var bytes = new Uint8Array(16);
        window.crypto.getRandomValues(bytes);
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        var hex = [];
        for (var i = 0; i < 16; i++) hex.push((bytes[i] + 0x100).toString(16).slice(1));
        return hex.slice(0, 4).join("") + "-" + hex.slice(4, 6).join("") + "-" +
          hex.slice(6, 8).join("") + "-" + hex.slice(8, 10).join("") + "-" + hex.slice(10).join("");
      }
    } catch (e) { /* fallback abaixo */ }
    return "id-" + Date.now().toString(36) + "-" + Math.random().toString(16).slice(2, 10);
  }

  var sessionId = (function () {
    try {
      var atual = localStorage.getItem(SESSION_KEY);
      if (atual && /^[A-Za-z0-9_.:-]{8,120}$/.test(atual)) return atual;
      var novo = "s-" + uuid();
      localStorage.setItem(SESSION_KEY, novo);
      return novo;
    } catch (e) {
      return "s-" + uuid();
    }
  })();

  var tabId = (function () {
    try {
      var atual = sessionStorage.getItem(TAB_KEY);
      if (atual) return atual;
      var novo = "t-" + uuid();
      sessionStorage.setItem(TAB_KEY, novo);
      return novo;
    } catch (e) {
      return "t-" + uuid();
    }
  })();

  var pageLoadId = "p-" + uuid();

  function currentPage() {
    var page = (window.location.pathname || "").split("/").pop();
    return page || "portal";
  }

  function apiBase() {
    try {
      var override = localStorage.getItem(API_BASE_KEY);
      if (override) return String(override).replace(/\/+$/, "");
    } catch (e) { /* segue com o padrão */ }
    return DEFAULT_API_BASE;
  }

  function isIngestUrl(url) {
    return String(url || "").indexOf(INGEST_PATH) !== -1;
  }

  function isObservabilityUrl(url) {
    return String(url || "").indexOf("/admin/observability") !== -1;
  }

  function isEnabled() {
    try { return localStorage.getItem(ENABLED_KEY) === "true"; } catch (e) { return false; }
  }

  function isActive() {
    return isAdminUser() && hasToken() && isEnabled();
  }

  /* ============================================================
   * ARMAZENAMENTO LOCAL (IndexedDB + fallback em memória)
   * ============================================================ */

  var memoryEvents = [];
  var dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve) {
      var resolvido = false;
      function terminar(db, estado) {
        if (resolvido) return;
        resolvido = true;
        runtime.indexedDb = estado;
        runtime.memoryFallback = !db;
        resolve(db);
      }

      if (typeof indexedDB === "undefined" || !indexedDB) return terminar(null, "indisponivel");

      var pedido;
      try {
        pedido = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (e) {
        return terminar(null, "bloqueado");
      }

      pedido.onupgradeneeded = function () {
        try {
          var db = pedido.result;
          if (!db.objectStoreNames.contains(STORE)) {
            var store = db.createObjectStore(STORE, { keyPath: "eventId" });
            store.createIndex("ts", "ts");
            store.createIndex("requestId", "requestId");
            store.createIndex("sessionId", "sessionId");
            store.createIndex("synced", "synced");
          }
        } catch (e) { /* onerror trata */ }
      };
      pedido.onsuccess = function () { terminar(pedido.result, "ok"); };
      pedido.onerror = function () { terminar(null, "bloqueado"); };
      pedido.onblocked = function () { terminar(null, "bloqueado"); };

      setTimeout(function () { terminar(null, "timeout"); }, 4000);
    });
    return dbPromise;
  }

  function withStore(mode, executor) {
    return openDb().then(function (db) {
      if (!db) return executor(null);
      return new Promise(function (resolve) {
        var tx;
        try {
          tx = db.transaction(STORE, mode);
        } catch (e) {
          return resolve(executor(null));
        }
        var store = tx.objectStore(STORE);
        var resultado;
        try {
          resultado = executor(store);
        } catch (e) {
          resultado = null;
        }
        tx.oncomplete = function () { resolve(resultado); };
        tx.onerror = function () { resolve(resultado); };
        tx.onabort = function () { resolve(resultado); };
      });
    }).catch(function () {
      return executor(null);
    });
  }

  function putEvent(evento) {
    return withStore("readwrite", function (store) {
      if (!store) {
        memoryEvents.push(evento);
        if (memoryEvents.length > MAX_EVENTS) {
          runtime.droppedLocal += memoryEvents.length - MAX_EVENTS;
          memoryEvents = memoryEvents.slice(-MAX_EVENTS);
        }
        return evento;
      }
      try { store.put(evento); } catch (e) { /* quota */ }
      return evento;
    });
  }

  function readAllEvents() {
    return withStore("readonly", function (store) {
      if (!store) return memoryEvents.slice();
      var saida = [];
      try {
        var pedido = store.index("ts").openCursor(null, "prev");
        pedido.onsuccess = function () {
          var cursor = pedido.result;
          if (!cursor || saida.length >= MAX_EVENTS) return;
          saida.push(cursor.value);
          cursor.continue();
        };
      } catch (e) { /* devolve o que tiver */ }
      return saida;
    }).then(function (linhas) {
      var lista = linhas || [];
      return lista.slice().sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
    });
  }

  function getEvents(options) {
    var opts = options || {};
    return readAllEvents().then(function (linhas) {
      var filtradas = linhas;
      if (opts.requestId) {
        filtradas = filtradas.filter(function (e) { return e.requestId === opts.requestId; });
      }
      if (opts.sessionId) {
        filtradas = filtradas.filter(function (e) { return e.sessionId === opts.sessionId; });
      }
      if (opts.eventType) {
        filtradas = filtradas.filter(function (e) { return e.eventType === opts.eventType; });
      }
      if (opts.onlyUnsynced) {
        filtradas = filtradas.filter(function (e) { return e.synced !== 1; });
      }
      var limite = opts.limit || MAX_EVENTS;
      return filtradas.slice(0, limite);
    });
  }

  function markSynced(ids) {
    if (!ids || !ids.length) return Promise.resolve(0);
    return withStore("readwrite", function (store) {
      if (!store) {
        for (var i = 0; i < memoryEvents.length; i++) {
          if (ids.indexOf(memoryEvents[i].eventId) !== -1) memoryEvents[i].synced = 1;
        }
        return ids.length;
      }
      ids.forEach(function (id) {
        try {
          var pedido = store.get(id);
          pedido.onsuccess = function () {
            var atual = pedido.result;
            if (!atual) return;
            atual.synced = 1;
            try { store.put(atual); } catch (e) { /* ignora */ }
          };
        } catch (e) { /* ignora */ }
      });
      return ids.length;
    });
  }

  function trimStore() {
    return readAllEvents().then(function (linhas) {
      if (linhas.length <= MAX_EVENTS) return 0;
      var excedentes = linhas.slice(MAX_EVENTS);
      return withStore("readwrite", function (store) {
        if (!store) {
          memoryEvents = memoryEvents.slice(-MAX_EVENTS);
          return excedentes.length;
        }
        excedentes.forEach(function (evento) {
          try { store.delete(evento.eventId); } catch (e) { /* ignora */ }
        });
        return excedentes.length;
      });
    });
  }

  function clearLocal() {
    memoryEvents = [];
    return withStore("readwrite", function (store) {
      if (!store) return true;
      try { store.clear(); } catch (e) { /* ignora */ }
      return true;
    }).then(function () {
      broadcast({ tipo: "limpo" });
      return true;
    });
  }

  /* ============================================================
   * CANAL ENTRE ABAS
   * ============================================================ */

  var channel = null;
  var listeners = [];

  try {
    if (typeof BroadcastChannel !== "undefined") {
      channel = new BroadcastChannel(CHANNEL_NAME);
      runtime.broadcastChannel = true;
      channel.onmessage = function (mensagem) {
        notificar(mensagem && mensagem.data);
      };
    }
  } catch (e) {
    channel = null;
  }

  // Fallback cross-tab sem BroadcastChannel: sinal mínimo no localStorage.
  // Nunca o payload — só o aviso de que existe evento novo no IndexedDB.
  window.addEventListener("storage", function (evento) {
    if (evento.key !== SIGNAL_KEY || !evento.newValue) return;
    try {
      notificar(JSON.parse(evento.newValue));
    } catch (e) { /* sinal corrompido */ }
  });

  function broadcast(mensagem) {
    var payload = Object.assign({ em: Date.now(), tabId: tabId }, mensagem || {});
    try { if (channel) channel.postMessage(payload); } catch (e) { /* canal fechado */ }
    if (!channel) {
      try { localStorage.setItem(SIGNAL_KEY, JSON.stringify(payload)); } catch (e) { /* quota */ }
    }
    try {
      window.dispatchEvent(new CustomEvent("vf-debug-event", { detail: payload }));
    } catch (e) { /* CustomEvent indisponível */ }
    notificar(payload);
  }

  function notificar(payload) {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](payload); } catch (e) { /* listener quebrado não trava os outros */ }
    }
  }

  function subscribe(fn) {
    if (typeof fn !== "function") return function () {};
    listeners.push(fn);
    return function () {
      var index = listeners.indexOf(fn);
      if (index !== -1) listeners.splice(index, 1);
    };
  }

  /* ============================================================
   * REGISTRO DE EVENTOS
   * ============================================================ */

  function record(evento) {
    if (!isActive()) return Promise.resolve(null);

    var completo = {
      eventId: evento.eventId || uuid(),
      requestId: evento.requestId || null,
      sessionId: sessionId,
      tabId: tabId,
      pageLoadId: pageLoadId,
      page: currentPage(),
      eventType: evento.eventType,
      severity: evento.severity || "info",
      message: evento.message ? truncate(scrubSecrets(String(evento.message).replace(/\s+/g, " ").trim()), 500) : null,
      stack: evento.stack ? truncate(scrubSecrets(String(evento.stack).split("\n").slice(0, 12).join("\n")), 3000) : null,
      method: evento.method || null,
      endpoint: evento.endpoint || null,
      statusCode: typeof evento.statusCode === "number" ? evento.statusCode : null,
      durationMs: typeof evento.durationMs === "number" ? Math.round(evento.durationMs) : null,
      data: sanitize(evento.data || {}),
      timestamp: new Date().toISOString(),
      ts: Date.now(),
      synced: 0
    };

    runtime.writes++;

    return putEvent(completo).then(function () {
      broadcast({ tipo: "evento", eventId: completo.eventId, eventType: completo.eventType });
      if (runtime.writes % TRIM_EVERY === 0) trimStore();
      agendarSync();
      return completo;
    }).catch(function () {
      return null;
    });
  }

  /* ============================================================
   * SINCRONIZAÇÃO COM O BACKEND
   * ============================================================ */

  var syncTimer = null;
  var syncing = false;
  var backoffMs = 0;

  function agendarSync(atrasoMs) {
    if (!getConfig().sync) return;
    if (syncTimer) return;
    var atraso = typeof atrasoMs === "number" ? atrasoMs : (backoffMs || SYNC_INTERVAL_MS);
    syncTimer = setTimeout(function () {
      syncTimer = null;
      sync();
    }, atraso);
  }

  function sync(options) {
    var opts = options || {};
    if (syncing) return Promise.resolve({ enviados: 0, motivo: "sync em andamento" });
    if (!isActive()) return Promise.resolve({ enviados: 0, motivo: "coletor inativo" });
    if (!getConfig().sync && !opts.force) return Promise.resolve({ enviados: 0, motivo: "sync desligado" });

    syncing = true;
    return getEvents({ onlyUnsynced: true, limit: SYNC_BATCH }).then(function (pendentes) {
      runtime.pending = pendentes.length;
      if (!pendentes.length) {
        syncing = false;
        backoffMs = 0;
        return { enviados: 0 };
      }

      var token = localStorage.getItem(TOKEN_KEY);
      if (!token) {
        syncing = false;
        runtime.lastSyncError = "sem token";
        return { enviados: 0, motivo: "sem token" };
      }

      var corpo = JSON.stringify({
        events: pendentes.map(function (evento) {
          return {
            eventId: evento.eventId,
            requestId: evento.requestId,
            sessionId: evento.sessionId,
            tabId: evento.tabId,
            pageLoadId: evento.pageLoadId,
            page: evento.page,
            eventType: evento.eventType,
            severity: evento.severity,
            message: evento.message,
            stack: evento.stack,
            method: evento.method,
            endpoint: evento.endpoint,
            statusCode: evento.statusCode,
            durationMs: evento.durationMs,
            data: evento.data,
            timestamp: evento.timestamp
          };
        })
      });

      // originalFetch: a própria ingestão nunca pode ser capturada.
      return originalFetch.call(window, apiBase() + INGEST_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: corpo,
        keepalive: opts.keepalive === true && corpo.length < 60000
      }).then(function (resposta) {
        if (!resposta.ok) throw new Error("HTTP " + resposta.status);
        return resposta.json().catch(function () { return {}; });
      }).then(function (dados) {
        return markSynced(pendentes.map(function (e) { return e.eventId; })).then(function () {
          runtime.lastSyncAt = new Date().toISOString();
          runtime.lastSyncError = null;
          runtime.lastSyncCount = dados && typeof dados.aceitos === "number" ? dados.aceitos : pendentes.length;
          runtime.pending = Math.max(0, runtime.pending - pendentes.length);
          backoffMs = 0;
          syncing = false;
          broadcast({ tipo: "sync", enviados: pendentes.length });
          if (pendentes.length === SYNC_BATCH) agendarSync(500);
          return { enviados: pendentes.length, resposta: dados };
        });
      }).catch(function (erro) {
        // Evento continua local e marcado como não sincronizado: nada se perde
        // quando o servidor está fora.
        syncing = false;
        runtime.lastSyncError = truncate(erro && erro.message ? erro.message : "falha de sync", 200);
        backoffMs = Math.min(backoffMs ? backoffMs * 2 : SYNC_INTERVAL_MS, SYNC_MAX_BACKOFF_MS);
        agendarSync(backoffMs);
        return { enviados: 0, erro: runtime.lastSyncError };
      });
    }).catch(function (erro) {
      syncing = false;
      runtime.lastSyncError = truncate(erro && erro.message ? erro.message : "falha ao ler fila", 200);
      return { enviados: 0, erro: runtime.lastSyncError };
    });
  }

  /* ============================================================
   * CAPTURA — fetch
   * ============================================================ */

  var originalFetch = (window.fetch && window.fetch.__vfOriginalFetch) ||
    (typeof window.fetch === "function" ? window.fetch.bind(window) : null);

  function headersToObject(headers) {
    var out = {};
    if (!headers) return out;
    try {
      if (typeof Headers !== "undefined" && headers instanceof Headers) {
        headers.forEach(function (value, key) { out[key] = value; });
        return out;
      }
      if (Object.prototype.toString.call(headers) === "[object Array]") {
        headers.forEach(function (par) {
          if (par && par.length >= 2) out[par[0]] = par[1];
        });
        return out;
      }
      if (typeof headers === "object") {
        Object.keys(headers).forEach(function (key) { out[key] = headers[key]; });
      }
    } catch (e) {
      return {};
    }
    return out;
  }

  function summarizeBody(body, headers) {
    if (body === null || body === undefined) return null;

    if (typeof FormData !== "undefined" && body instanceof FormData) {
      var form = { formData: true, campos: {} };
      try {
        body.forEach(function (value, key) {
          form.campos[key] = (typeof File !== "undefined" && value instanceof File)
            ? summarizeFile(value)
            : (isSensitiveKey(key) ? REDACTED : truncate(String(value), 200));
        });
      } catch (e) {
        form.campos = { erro: "FormData não inspecionável" };
      }
      return form;
    }

    if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) {
      var params = {};
      body.forEach(function (value, key) {
        params[key] = isSensitiveKey(key) ? REDACTED : truncate(value, 200);
      });
      return params;
    }

    if (typeof Blob !== "undefined" && body instanceof Blob) {
      return { tipo: "blob", bytes: body.size, contentType: body.type || null, capturado: false };
    }
    if (typeof ArrayBuffer !== "undefined" && body instanceof ArrayBuffer) {
      return { tipo: "arrayBuffer", bytes: body.byteLength, capturado: false };
    }
    if (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView && ArrayBuffer.isView(body)) {
      return { tipo: "typedArray", bytes: body.byteLength, capturado: false };
    }
    if (typeof ReadableStream !== "undefined" && body instanceof ReadableStream) {
      return { tipo: "stream", capturado: false, motivo: "stream não é lido para não consumir o corpo" };
    }

    if (typeof body === "string") {
      var texto = truncate(body, MAX_TEXT_CHARS);
      var contentType = "";
      Object.keys(headers || {}).forEach(function (key) {
        if (String(key).toLowerCase() === "content-type") contentType = String(headers[key]);
      });
      if (contentType.indexOf("json") !== -1 || /^[[{]/.test(body.trim())) {
        try { return sanitize(JSON.parse(body)); } catch (e) { return texto; }
      }
      return texto;
    }

    return { tipo: typeof body, capturado: false };
  }

  function isTextLike(contentType) {
    var tipo = String(contentType || "").toLowerCase();
    if (!tipo) return true;
    return tipo.indexOf("json") !== -1 || tipo.indexOf("text") !== -1 ||
      tipo.indexOf("html") !== -1 || tipo.indexOf("xml") !== -1 ||
      tipo.indexOf("javascript") !== -1 || tipo.indexOf("form-urlencoded") !== -1;
  }

  function captureResponseBody(response) {
    // Trabalha SEMPRE em clone: a response original chega intacta à tela.
    var contentType = "";
    var contentLength = 0;
    try {
      contentType = (response.headers && response.headers.get("content-type")) || "";
      contentLength = Number((response.headers && response.headers.get("content-length")) || 0);
    } catch (e) { /* headers opacos */ }

    if (response.type === "opaque" || response.type === "opaqueredirect") {
      return Promise.resolve({ capturado: false, motivo: "response opaca (CORS)", contentType: contentType });
    }
    if (contentLength && contentLength > MAX_RESPONSE_BYTES) {
      return Promise.resolve({
        capturado: false,
        truncado: true,
        motivo: "response maior que o limite de captura",
        bytes: contentLength,
        contentType: contentType
      });
    }
    if (!isTextLike(contentType)) {
      return Promise.resolve({
        capturado: false,
        motivo: "response não textual",
        contentType: contentType
      });
    }

    var clone;
    try {
      clone = response.clone();
    } catch (e) {
      return Promise.resolve({ capturado: false, motivo: "response não pôde ser clonada" });
    }

    return clone.text().then(function (texto) {
      var truncado = texto.length > MAX_TEXT_CHARS;
      var recorte = truncate(texto, MAX_TEXT_CHARS);
      if (contentType.indexOf("json") !== -1) {
        try {
          return { capturado: true, truncado: truncado, contentType: contentType, corpo: sanitize(JSON.parse(texto)) };
        } catch (e) {
          return { capturado: true, truncado: truncado, contentType: contentType, corpo: recorte, jsonInvalido: true };
        }
      }
      return { capturado: true, truncado: truncado, contentType: contentType, corpo: recorte };
    }).catch(function () {
      return { capturado: false, motivo: "falha ao ler o clone da response" };
    });
  }

  function buildDebugHeaders(requestId) {
    return {
      "X-Request-Id": requestId,
      "X-VF-Debug-Session": sessionId,
      "X-VF-Debug-Tab": tabId
    };
  }

  function installFetch() {
    if (!originalFetch) return false;
    if (window.fetch && window.fetch.__vfDebugWrapped) return true;

    function vfFetch(input, init) {
      if (!isActive()) return originalFetch.call(window, input, init);

      var url = "";
      try {
        url = (typeof Request !== "undefined" && input instanceof Request) ? input.url : String(input || "");
      } catch (e) { url = ""; }

      if (isObservabilityUrl(url)) return originalFetch.call(window, input, init);

      var requestId = uuid();
      var opcoes = init || {};
      var metodo = String(
        opcoes.method || ((typeof Request !== "undefined" && input instanceof Request) ? input.method : "GET")
      ).toUpperCase();

      var headersEntrada = (typeof Request !== "undefined" && input instanceof Request)
        ? headersToObject(input.headers)
        : {};
      var headersInit = headersToObject(opcoes.headers);
      var headers = Object.assign({}, headersEntrada, headersInit);

      var corpoResumo = Object.prototype.hasOwnProperty.call(opcoes, "body")
        ? summarizeBody(opcoes.body, headers)
        : ((typeof Request !== "undefined" && input instanceof Request)
          ? { tipo: "Request", capturado: false, motivo: "corpo de Request não é lido para não consumir o stream" }
          : null);

      var novoInput = input;
      var novoInit = opcoes;
      try {
        var debugHeaders = buildDebugHeaders(requestId);
        if (typeof Request !== "undefined" && input instanceof Request) {
          var mesclados = new Headers(input.headers);
          Object.keys(debugHeaders).forEach(function (k) { mesclados.set(k, debugHeaders[k]); });
          novoInput = new Request(input, { headers: mesclados });
        } else {
          var finais = new Headers();
          Object.keys(headers).forEach(function (k) {
            try { finais.set(k, headers[k]); } catch (e) { /* header inválido */ }
          });
          Object.keys(debugHeaders).forEach(function (k) { finais.set(k, debugHeaders[k]); });
          novoInit = Object.assign({}, opcoes, { headers: finais });
        }
      } catch (e) {
        // Se por qualquer motivo não der para anexar headers, a chamada segue
        // exatamente como o Portal a escreveu.
        novoInput = input;
        novoInit = opcoes;
      }

      var inicio = agora();
      var endpoint = endpointFromUrl(url);
      var pendente = true;
      var config = getConfig();

      var alarmeLento = setTimeout(function () {
        if (!pendente) return;
        record({
          eventType: "slow-request",
          severity: "warn",
          requestId: requestId,
          method: metodo,
          endpoint: endpoint,
          message: "Request passou de " + config.slowMs + "ms sem responder",
          data: { limiteMs: config.slowMs, estado: "pendente" }
        });
      }, config.slowMs);

      return originalFetch.call(window, novoInput, novoInit).then(function (response) {
        pendente = false;
        clearTimeout(alarmeLento);
        var duracao = agora() - inicio;
        var serverRequestId = null;
        try {
          serverRequestId = response.headers && response.headers.get("x-request-id");
        } catch (e) { /* header não exposto */ }

        captureResponseBody(response).then(function (resumoResponse) {
          record({
            eventType: "request",
            severity: response.status >= 500 ? "error" : response.status >= 400 ? "warn" : "info",
            requestId: serverRequestId || requestId,
            method: metodo,
            endpoint: endpoint,
            statusCode: response.status,
            durationMs: duracao,
            message: metodo + " " + endpoint + " → " + response.status,
            data: {
              transporte: "fetch",
              url: sanitizeUrl(url),
              requestIdCliente: requestId,
              requestIdServidor: serverRequestId || null,
              correlacionado: !!serverRequestId,
              contentType: resumoResponse.contentType || null,
              headers: sanitizeHeaders(headers),
              request: corpoResumo,
              response: resumoResponse,
              redirecionado: response.redirected === true,
              ok: response.ok === true
            }
          });
        });

        // A response original é devolvida sem nenhuma leitura prévia.
        return response;
      }).catch(function (erro) {
        pendente = false;
        clearTimeout(alarmeLento);
        var duracao = agora() - inicio;
        var abortada = erro && (erro.name === "AbortError");
        record({
          eventType: "network-error",
          severity: abortada ? "warn" : "error",
          requestId: requestId,
          method: metodo,
          endpoint: endpoint,
          statusCode: 0,
          durationMs: duracao,
          message: abortada ? "Request cancelada (AbortError)" : (erro && erro.message ? erro.message : "falha de rede"),
          stack: erro && erro.stack ? erro.stack : null,
          data: {
            transporte: "fetch",
            url: sanitizeUrl(url),
            cancelada: !!abortada,
            headers: sanitizeHeaders(headers),
            request: corpoResumo,
            causaProvavel: abortada
              ? "AbortController na própria tela"
              : "rede, CORS, DNS, cold start do servidor ou servidor fora"
          }
        });
        throw erro;
      });
    }

    vfFetch.__vfDebugWrapped = true;
    vfFetch.__vfOriginalFetch = originalFetch;
    window.fetch = vfFetch;
    runtime.installedFetch = true;
    return true;
  }

  /* ============================================================
   * CAPTURA — XMLHttpRequest
   * ============================================================ */

  var originalXhrOpen = null;
  var originalXhrSend = null;

  function installXhr() {
    if (typeof XMLHttpRequest === "undefined") return false;
    if (XMLHttpRequest.prototype.open && XMLHttpRequest.prototype.open.__vfDebugWrapped) return true;

    originalXhrOpen = XMLHttpRequest.prototype.open;
    originalXhrSend = XMLHttpRequest.prototype.send;

    function vfOpen(method, url) {
      try {
        this.__vfDebug = {
          method: String(method || "GET").toUpperCase(),
          url: String(url || ""),
          requestId: uuid(),
          inicio: null
        };
      } catch (e) { /* objeto congelado */ }
      return originalXhrOpen.apply(this, arguments);
    }

    function vfSend(body) {
      var meta = this.__vfDebug;
      if (!meta || !isActive() || isObservabilityUrl(meta.url)) {
        return originalXhrSend.apply(this, arguments);
      }

      meta.inicio = agora();
      var xhr = this;
      var endpoint = endpointFromUrl(meta.url);
      var corpoResumo = summarizeBody(body, {});

      try {
        var debugHeaders = buildDebugHeaders(meta.requestId);
        Object.keys(debugHeaders).forEach(function (chave) {
          try { xhr.setRequestHeader(chave, debugHeaders[chave]); } catch (e) { /* header rejeitado */ }
        });
      } catch (e) { /* segue sem correlação */ }

      var registrado = false;
      function registrar(tipo, mensagem) {
        if (registrado) return;
        registrado = true;
        var duracao = agora() - meta.inicio;
        var serverRequestId = null;
        var contentType = null;
        try {
          serverRequestId = xhr.getResponseHeader("X-Request-Id");
          contentType = xhr.getResponseHeader("Content-Type");
        } catch (e) { /* headers indisponíveis */ }

        var status = Number(xhr.status || 0);
        record({
          eventType: tipo,
          severity: tipo !== "request" ? "error" : status >= 500 ? "error" : status >= 400 ? "warn" : "info",
          requestId: serverRequestId || meta.requestId,
          method: meta.method,
          endpoint: endpoint,
          statusCode: status,
          durationMs: duracao,
          message: mensagem || (meta.method + " " + endpoint + " → " + status),
          data: {
            transporte: "xhr",
            url: sanitizeUrl(meta.url),
            requestIdCliente: meta.requestId,
            requestIdServidor: serverRequestId || null,
            correlacionado: !!serverRequestId,
            contentType: contentType,
            request: corpoResumo,
            response: resumirRespostaXhr(xhr, contentType)
          }
        });
      }

      xhr.addEventListener("load", function () { registrar("request"); });
      xhr.addEventListener("error", function () { registrar("network-error", "Falha de rede no XMLHttpRequest"); });
      xhr.addEventListener("timeout", function () { registrar("network-error", "Timeout no XMLHttpRequest"); });
      xhr.addEventListener("abort", function () { registrar("network-error", "XMLHttpRequest cancelado"); });

      return originalXhrSend.apply(this, arguments);
    }

    vfOpen.__vfDebugWrapped = true;
    XMLHttpRequest.prototype.open = vfOpen;
    XMLHttpRequest.prototype.send = vfSend;
    runtime.installedXhr = true;
    return true;
  }

  function resumirRespostaXhr(xhr, contentType) {
    try {
      if (xhr.responseType && xhr.responseType !== "" && xhr.responseType !== "text" && xhr.responseType !== "json") {
        return { capturado: false, motivo: "responseType " + xhr.responseType + " não é textual" };
      }
      if (!isTextLike(contentType)) {
        return { capturado: false, motivo: "response não textual", contentType: contentType };
      }
      var texto = xhr.responseType === "json" ? JSON.stringify(xhr.response) : String(xhr.responseText || "");
      if (texto.length > MAX_RESPONSE_BYTES) {
        return { capturado: false, truncado: true, motivo: "response maior que o limite", bytes: texto.length };
      }
      if (String(contentType || "").indexOf("json") !== -1) {
        try {
          return { capturado: true, contentType: contentType, corpo: sanitize(JSON.parse(texto)) };
        } catch (e) {
          return { capturado: true, contentType: contentType, corpo: truncate(texto), jsonInvalido: true };
        }
      }
      return { capturado: true, contentType: contentType, corpo: truncate(texto) };
    } catch (e) {
      return { capturado: false, motivo: "response do XHR não pôde ser lida" };
    }
  }

  /* ============================================================
   * CAPTURA — erros globais
   * ============================================================ */

  var originalConsoleError = null;

  function installErrorHandlers() {
    if (runtime.installedErrors) return true;

    window.addEventListener("error", function (evento) {
      if (!isActive()) return;

      // Erro de carregamento de recurso (script/img/css): evento.message é vazio
      // e o alvo é um elemento.
      if (evento && evento.target && evento.target !== window && evento.target.tagName) {
        record({
          eventType: "js-error",
          severity: "warn",
          message: "Falha ao carregar recurso <" + String(evento.target.tagName).toLowerCase() + ">",
          data: {
            recurso: sanitizeUrl(evento.target.src || evento.target.href || ""),
            tag: String(evento.target.tagName).toLowerCase()
          }
        });
        return;
      }

      record({
        eventType: "js-error",
        severity: "error",
        message: evento && evento.message ? evento.message : "Erro JavaScript",
        stack: evento && evento.error && evento.error.stack ? evento.error.stack : null,
        data: {
          arquivo: sanitizeUrl(evento && evento.filename ? evento.filename : ""),
          linha: evento ? evento.lineno : null,
          coluna: evento ? evento.colno : null,
          nome: evento && evento.error && evento.error.name ? String(evento.error.name) : null
        }
      });
    }, true);

    window.addEventListener("unhandledrejection", function (evento) {
      if (!isActive()) return;
      var motivo = evento ? evento.reason : null;
      var mensagem = motivo && motivo.message ? motivo.message : String(motivo);
      record({
        eventType: "unhandled-rejection",
        severity: "error",
        message: mensagem,
        stack: motivo && motivo.stack ? motivo.stack : null,
        data: {
          tipo: motivo && motivo.name ? String(motivo.name) : typeof motivo,
          valor: sanitize(motivo)
        }
      });
    });

    // Só console.error — os demais métodos de console não são interceptados.
    if (console && typeof console.error === "function" && !console.error.__vfDebugWrapped) {
      originalConsoleError = console.error.bind(console);
      var dentro = false;
      var vfConsoleError = function () {
        var args = Array.prototype.slice.call(arguments);
        try {
          if (!dentro && isActive() && getConfig().captureConsole) {
            dentro = true;
            record({
              eventType: "console-error",
              severity: "error",
              message: args.map(function (a) {
                return a && a.message ? a.message : (typeof a === "string" ? a : JSON.stringify(sanitize(a)));
              }).join(" ").slice(0, 500),
              stack: args.find(function (a) { return a && a.stack; }) ? args.find(function (a) { return a && a.stack; }).stack : null,
              data: { argumentos: sanitize(args) }
            });
            dentro = false;
          }
        } catch (e) {
          dentro = false;
        }
        return originalConsoleError.apply(null, args);
      };
      vfConsoleError.__vfDebugWrapped = true;
      console.error = vfConsoleError;
    }

    if (getConfig().captureNavigation) {
      record({
        eventType: "navigation",
        severity: "info",
        message: "Carregou " + currentPage(),
        data: {
          url: sanitizeUrl(window.location.href),
          referrer: sanitizeUrl(document.referrer || ""),
          viewport: window.innerWidth + "x" + window.innerHeight
        }
      });
    }

    window.addEventListener("pagehide", function () {
      // keepalive garante o envio mesmo com a aba fechando.
      sync({ keepalive: true }).catch(function () {});
    });

    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") sync().catch(function () {});
    });

    runtime.installedErrors = true;
    return true;
  }

  function agora() {
    return (window.performance && window.performance.now) ? window.performance.now() : Date.now();
  }

  /* ============================================================
   * MIGRAÇÃO DO STORAGE ANTIGO (vf-debug-logs)
   * ============================================================ */

  function readLegacyLogs() {
    var saida = [];
    [sessionStorage, localStorage].forEach(function (storage) {
      var lista = readJson(storage, LEGACY_LOG_KEY, []);
      if (Object.prototype.toString.call(lista) === "[object Array]") saida = saida.concat(lista);
    });
    return saida;
  }

  function migrateLegacyLogs() {
    try {
      if (localStorage.getItem(LEGACY_MIGRATED_KEY) === "true") return Promise.resolve(0);
      var antigos = readLegacyLogs();
      if (!antigos.length) {
        localStorage.setItem(LEGACY_MIGRATED_KEY, "true");
        return Promise.resolve(0);
      }

      var promessas = antigos.slice(-MAX_EVENTS).map(function (antigo) {
        var evento = {
          eventId: "legacy-" + (antigo.id || uuid()),
          requestId: null,
          sessionId: "legado",
          tabId: "legado",
          pageLoadId: "legado",
          page: antigo.screen || "portal",
          eventType: Number(antigo.status) === 0 ? "network-error" : "request",
          severity: Number(antigo.status) >= 500 ? "error" : Number(antigo.status) >= 400 ? "warn" : "info",
          message: truncate(antigo.description || "", 500),
          stack: null,
          method: String(antigo.method || "GET").toUpperCase(),
          endpoint: sanitizeUrl(antigo.endpoint || ""),
          statusCode: Number(antigo.status) || 0,
          durationMs: Number(antigo.duration) || null,
          data: sanitize({ legado: true, request: antigo.payload || null, response: antigo.response || null, erro: antigo.error || null }),
          timestamp: antigo.timestamp || new Date().toISOString(),
          ts: antigo.timestamp ? Date.parse(antigo.timestamp) || Date.now() : Date.now(),
          // Registros do storage antigo não têm request id: não há como
          // correlacioná-los com o servidor, então não são sincronizados.
          synced: 1
        };
        return putEvent(evento);
      });

      return Promise.all(promessas).then(function () {
        localStorage.setItem(LEGACY_MIGRATED_KEY, "true");
        try {
          sessionStorage.removeItem(LEGACY_LOG_KEY);
          localStorage.removeItem(LEGACY_LOG_KEY);
        } catch (e) { /* ignora */ }
        broadcast({ tipo: "migracao", total: promessas.length });
        return promessas.length;
      });
    } catch (e) {
      return Promise.resolve(0);
    }
  }

  /* ============================================================
   * ATIVAÇÃO
   * ============================================================ */

  function syncUrlFlag() {
    try {
      var valor = new URLSearchParams(window.location.search || "").get("vf_debug");
      if (valor === "0" || valor === "false" || valor === "off") {
        localStorage.setItem(ENABLED_KEY, "false");
      }
      if ((valor === "1" || valor === "true" || valor === "on") && isAdminUser() && hasToken()) {
        localStorage.setItem(ENABLED_KEY, "true");
      }
    } catch (e) { /* URL não define o estado se falhar */ }
  }

  function install() {
    try {
      installFetch();
      installXhr();
      installErrorHandlers();
      migrateLegacyLogs();
      agendarSync(1500);
      return true;
    } catch (e) {
      return false;
    }
  }

  function enable() {
    if (!isAdminUser() || !hasToken()) return false;
    try { localStorage.setItem(ENABLED_KEY, "true"); } catch (e) { return false; }
    install();
    broadcast({ tipo: "estado", ativo: true });
    return true;
  }

  function disable() {
    try { localStorage.setItem(ENABLED_KEY, "false"); } catch (e) { /* ignora */ }
    // Os wrappers continuam instalados, mas viram passthrough por isActive().
    broadcast({ tipo: "estado", ativo: false });
    return true;
  }

  /* ============================================================
   * FERRAMENTAS DE TESTE CONTROLADO
   * ============================================================ */

  function emitTestError() {
    var erro = new Error("Erro de TESTE disparado pelo Control Center — nenhum sistema foi afetado");
    erro.name = "VFDebugTestError";
    return record({
      eventType: "test",
      severity: "error",
      message: erro.message,
      stack: erro.stack,
      data: { teste: true, origem: "control-center", afetaProducao: false }
    });
  }

  function runTestRequest() {
    var alvo = apiBase() + "/health";
    var inicio = agora();
    // Endpoint público de leitura: não altera nada no servidor.
    return originalFetch.call(window, alvo, { method: "GET", headers: buildDebugHeaders(uuid()) })
      .then(function (resposta) {
        return record({
          eventType: "test",
          severity: resposta.ok ? "info" : "warn",
          method: "GET",
          endpoint: "/health",
          statusCode: resposta.status,
          durationMs: agora() - inicio,
          message: "Teste controlado GET /health → " + resposta.status,
          data: { teste: true, origem: "control-center", afetaProducao: false }
        }).then(function () {
          return { ok: resposta.ok, status: resposta.status, duracaoMs: Math.round(agora() - inicio) };
        });
      })
      .catch(function (erro) {
        return record({
          eventType: "test",
          severity: "error",
          method: "GET",
          endpoint: "/health",
          statusCode: 0,
          durationMs: agora() - inicio,
          message: "Teste controlado GET /health falhou: " + (erro && erro.message ? erro.message : "erro"),
          data: { teste: true, origem: "control-center", afetaProducao: false }
        }).then(function () {
          return { ok: false, status: 0, erro: erro && erro.message ? erro.message : "erro" };
        });
      });
  }

  /* ============================================================
   * DIAGNÓSTICO / EXPORT
   * ============================================================ */

  function getStats() {
    return getEvents({ limit: MAX_EVENTS }).then(function (eventos) {
      var porTipo = {};
      var naoSincronizados = 0;
      var sessoes = {};
      var abas = {};
      var paginas = {};
      for (var i = 0; i < eventos.length; i++) {
        var e = eventos[i];
        porTipo[e.eventType] = (porTipo[e.eventType] || 0) + 1;
        if (e.synced !== 1) naoSincronizados++;
        if (e.sessionId) sessoes[e.sessionId] = (sessoes[e.sessionId] || 0) + 1;
        if (e.tabId) abas[e.tabId] = (abas[e.tabId] || 0) + 1;
        if (e.page) paginas[e.page] = (paginas[e.page] || 0) + 1;
      }
      runtime.pending = naoSincronizados;

      var base = {
        total: eventos.length,
        naoSincronizados: naoSincronizados,
        porTipo: porTipo,
        sessoes: sessoes,
        abas: abas,
        paginas: paginas,
        maisAntigo: eventos.length ? eventos[eventos.length - 1].timestamp : null,
        maisRecente: eventos.length ? eventos[0].timestamp : null,
        limite: MAX_EVENTS
      };

      if (navigator.storage && typeof navigator.storage.estimate === "function") {
        return navigator.storage.estimate().then(function (estimativa) {
          base.armazenamento = {
            usadoMb: estimativa.usage ? Math.round((estimativa.usage / 1048576) * 100) / 100 : null,
            cotaMb: estimativa.quota ? Math.round((estimativa.quota / 1048576) * 100) / 100 : null
          };
          return base;
        }).catch(function () { return base; });
      }
      return base;
    });
  }

  function getRuntimeInfo() {
    return {
      version: VERSION,
      ativo: isActive(),
      admin: isAdminUser(),
      token: hasToken(),
      habilitado: isEnabled(),
      sessionId: sessionId,
      tabId: tabId,
      pageLoadId: pageLoadId,
      apiBase: apiBase(),
      indexedDb: runtime.indexedDb,
      broadcastChannel: runtime.broadcastChannel,
      fetchInterceptado: runtime.installedFetch,
      xhrInterceptado: runtime.installedXhr,
      errosInterceptados: runtime.installedErrors,
      ultimoSync: runtime.lastSyncAt,
      ultimoSyncErro: runtime.lastSyncError,
      pendentes: runtime.pending,
      descartadosLocal: runtime.droppedLocal,
      config: getConfig(),
      limiteEventos: MAX_EVENTS
    };
  }

  function exportEvents() {
    return getEvents({ limit: MAX_EVENTS }).then(function (eventos) {
      return {
        geradoEm: new Date().toISOString(),
        runtime: getRuntimeInfo(),
        total: eventos.length,
        // Já estão sanitizados na gravação; sanitiza de novo no export por
        // garantia (o arquivo sai da máquina).
        eventos: eventos.map(function (e) { return sanitize(e); })
      };
    });
  }

  /* ============================================================
   * BOOT
   * ============================================================ */

  syncUrlFlag();

  window.VFDebugClient = {
    version: VERSION,
    maxEvents: MAX_EVENTS,
    legacyLogKey: LEGACY_LOG_KEY,
    // estado
    isActive: isActive,
    isAdmin: isAdminUser,
    hasToken: hasToken,
    isEnabled: isEnabled,
    getRuntimeInfo: getRuntimeInfo,
    getConfig: getConfig,
    setConfig: setConfig,
    ids: { sessionId: sessionId, tabId: tabId, pageLoadId: pageLoadId },
    apiBase: apiBase,
    // ciclo de vida
    install: install,
    enable: enable,
    disable: disable,
    // dados
    getEvents: getEvents,
    getStats: getStats,
    clearLocal: clearLocal,
    exportEvents: exportEvents,
    readLegacyLogs: readLegacyLogs,
    record: record,
    // sincronização
    sync: sync,
    // eventos entre abas
    subscribe: subscribe,
    broadcast: broadcast,
    // testes controlados
    emitTestError: emitTestError,
    runTestRequest: runTestRequest,
    // sanitização (o Control Center reaproveita para renderizar com segurança)
    sanitize: sanitize,
    sanitizeUrl: sanitizeUrl,
    isSensitiveKey: isSensitiveKey,
    looksSensitiveValue: looksSensitiveValue,
    maskValue: maskValue,
    SENSITIVE_KEY_PARTS: SENSITIVE_KEY_PARTS,
    SENSITIVE_KEY_EXACT: SENSITIVE_KEY_EXACT
  };

  // Abre o IndexedDB mesmo com o coletor desligado: o Control Center precisa
  // ler o histórico já gravado para mostrar "somente dados locais".
  openDb();

  if (isActive()) install();
})();
