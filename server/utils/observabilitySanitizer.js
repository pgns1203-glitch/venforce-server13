// server/utils/observabilitySanitizer.js
// Autoridade final de redação da observabilidade.
//
// O navegador já sanitiza antes de enviar, mas nada que chega pela rede é
// confiável: tudo passa por aqui de novo antes de ir para o PostgreSQL e antes
// de sair em qualquer resposta administrativa.

"use strict";

// Casamento por SUBSTRING no nome normalizado da chave.
const SENSITIVE_KEY_PARTS = [
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
  "privatekey",
];

// Casamento EXATO. `code` e `jwt` são curtos demais para substring: mascarar
// por substring quebraria `status_code`, `error_code`, `zip_code` etc.
const SENSITIVE_KEY_EXACT = [
  "code",
  "jwt",
  "auth",
];

const REDACTED = "[redacted]";

const DEFAULT_LIMITS = {
  maxDepth: 6,
  maxString: 2000,
  maxArray: 50,
  maxKeys: 60,
};

// Chaves que nunca são reconstruídas em objetos sanitizados (prototype pollution).
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function normalizeKey(key) {
  return String(key == null ? "" : key).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isSensitiveKey(key) {
  const normalized = normalizeKey(key);
  if (!normalized) return false;
  if (SENSITIVE_KEY_EXACT.includes(normalized)) return true;
  return SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part));
}

function looksSensitiveValue(value) {
  if (typeof value !== "string") return false;
  const text = value.trim();
  if (!text) return false;
  if (/^Bearer\s+\S/i.test(text)) return true;
  if (/^Basic\s+\S/i.test(text)) return true;
  // JWT: header.payload.signature
  if (/^eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\./.test(text)) return true;
  if (/^vf_[a-f0-9]{16,}$/i.test(text)) return true;
  if (/^(sk|pk|ghp|gho|glpat|xoxb|xoxp)[-_][A-Za-z0-9_-]{16,}$/i.test(text)) return true;
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) return true;
  // Blob opaco muito longo sem espaços: provável credencial serializada.
  return text.length > 120 && !/\s/.test(text) && /^[A-Za-z0-9._~+/=-]+$/.test(text);
}

// Segredos EMBUTIDOS em texto livre. `looksSensitiveValue` só decide sobre o
// valor inteiro; uma mensagem como "jwt malformed: eyJhbGciOi…" passaria por
// ela e gravaria o token no PostgreSQL.
const PADROES_EMBUTIDOS = [
  [/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, `Bearer ${REDACTED}`],
  [/Basic\s+[A-Za-z0-9+/=]{8,}/gi, `Basic ${REDACTED}`],
  [/\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*/g, REDACTED],
  [/\bvf_[a-f0-9]{16,}\b/gi, REDACTED],
  [/\b(?:sk|pk|ghp|gho|glpat|xoxb|xoxp)[-_][A-Za-z0-9_-]{16,}\b/gi, REDACTED],
  [/\bAPP_USR-[A-Za-z0-9-]{8,}/gi, REDACTED],
  [/\bTG-[A-Za-z0-9-]{8,}/gi, REDACTED],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, REDACTED],
  // pares chave=valor em texto livre / query string colada em log
  [/\b(authorization|token|access_token|refresh_token|api_?key|password|senha|secret|client_secret|credential|code|jwt)=([^\s&"']{3,})/gi,
    (_todo, chave) => `${chave}=${REDACTED}`],
];

function scrubSecrets(text) {
  let saida = String(text);
  for (const [padrao, substituto] of PADROES_EMBUTIDOS) {
    saida = saida.replace(padrao, substituto);
  }
  return saida;
}

function maskValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return REDACTED;
  const text = value.trim();
  if (!text) return null;
  if (/^Bearer\s+/i.test(text)) return `Bearer ${REDACTED}`;
  if (/^Basic\s+/i.test(text)) return `Basic ${REDACTED}`;
  return REDACTED;
}

function truncateString(value, maxLength = DEFAULT_LIMITS.maxString) {
  const text = String(value == null ? "" : value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}…[truncado ${text.length - maxLength} chars]`;
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return false;
  if (value instanceof Date) return false;
  return true;
}

/**
 * Sanitiza qualquer valor vindo do cliente ou do servidor:
 * mascara chaves sensíveis, limita string/array/profundidade, resolve
 * referências circulares e nunca reconstrói chaves de prototype pollution.
 */
function sanitizeValue(value, options = {}, _depth = 0, _seen = new WeakSet()) {
  const limits = { ...DEFAULT_LIMITS, ...options };

  if (value === null || value === undefined) return null;

  const type = typeof value;

  if (type === "string") {
    if (looksSensitiveValue(value)) return maskValue(value);
    return truncateString(scrubSecrets(value), limits.maxString);
  }

  if (type === "number") return Number.isFinite(value) ? value : String(value);
  if (type === "boolean") return value;
  if (type === "bigint") return `${value.toString()}n`;
  if (type === "function") return "[function]";
  if (type === "symbol") return "[symbol]";

  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return sanitizeError(value, limits);
  if (Buffer.isBuffer(value)) return { tipo: "buffer", bytes: value.length };

  if (_depth >= limits.maxDepth) return "[profundidade máxima]";

  if (_seen.has(value)) return "[circular]";
  _seen.add(value);

  if (Array.isArray(value)) {
    const slice = value.slice(0, limits.maxArray);
    const out = slice.map((item) => sanitizeValue(item, limits, _depth + 1, _seen));
    if (value.length > limits.maxArray) {
      out.push(`[+${value.length - limits.maxArray} itens omitidos]`);
    }
    return out;
  }

  if (!isPlainObject(value)) return truncateString(String(value), limits.maxString);

  const out = {};
  let count = 0;
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.has(key)) continue;
    if (count >= limits.maxKeys) {
      out["[omitido]"] = `${Object.keys(value).length - count} chaves adicionais`;
      break;
    }
    count += 1;
    out[key] = isSensitiveKey(key)
      ? maskValue(value[key])
      : sanitizeValue(value[key], limits, _depth + 1, _seen);
  }
  return out;
}

function sanitizeHeaders(headers, options = {}) {
  if (!headers || typeof headers !== "object") return {};
  const out = {};
  for (const [key, rawValue] of Object.entries(headers)) {
    if (FORBIDDEN_KEYS.has(key)) continue;
    const value = Array.isArray(rawValue) ? rawValue.join(", ") : rawValue;
    out[key] = isSensitiveKey(key) || looksSensitiveValue(value)
      ? maskValue(value)
      : truncateString(value, options.maxString || 512);
  }
  return out;
}

function sanitizeUrl(rawUrl, base) {
  const raw = String(rawUrl == null ? "" : rawUrl);
  if (!raw) return "";

  let url;
  try {
    url = new URL(raw, base || "http://internal.local");
  } catch {
    return looksSensitiveValue(raw) ? REDACTED : truncateString(raw, 512);
  }

  const params = url.searchParams;
  for (const key of Array.from(new Set(params.keys()))) {
    const values = params.getAll(key);
    if (isSensitiveKey(key) || values.some(looksSensitiveValue)) {
      params.delete(key);
      params.set(key, REDACTED);
    }
  }

  url.pathname = url.pathname
    .split("/")
    .map((segment) => {
      if (!segment) return segment;
      let decoded = segment;
      try {
        decoded = decodeURIComponent(segment);
      } catch {
        /* segmento com escape inválido: avalia como veio */
      }
      return looksSensitiveValue(decoded) ? REDACTED : segment;
    })
    .join("/");

  url.username = "";
  url.password = "";
  url.hash = "";

  const relative = !/^[a-z][a-z0-9+.-]*:/i.test(raw) && !raw.startsWith("//");
  const result = relative ? `${url.pathname}${url.search}` : url.toString();
  return truncateString(result, 512);
}

/** Só o pathname sanitizado, sem query — é o que agrupa métricas por rota. */
function sanitizePath(rawUrl) {
  const sanitized = sanitizeUrl(rawUrl);
  const queryAt = sanitized.indexOf("?");
  return queryAt === -1 ? sanitized : sanitized.slice(0, queryAt);
}

function sanitizeStack(stack, maxLines = 12) {
  if (!stack) return null;
  const lines = String(stack).split("\n").slice(0, maxLines);
  return truncateString(scrubSecrets(lines.join("\n")), 4000);
}

function sanitizeMessage(message, maxLength = 500) {
  if (message === null || message === undefined) return null;
  const text = String(message).replace(/\s+/g, " ").trim();
  if (!text) return null;
  if (looksSensitiveValue(text)) return REDACTED;
  return truncateString(scrubSecrets(text), maxLength);
}

function sanitizeError(error, options = {}) {
  if (!error) return null;
  const captureStack = options.captureStack !== false;
  return {
    name: sanitizeMessage(error.name || "Error", 120),
    message: sanitizeMessage(error.message, 500),
    stack: captureStack ? sanitizeStack(error.stack) : null,
  };
}

/** Arquivos entram como metadado; conteúdo binário nunca é armazenado. */
function summarizeFile(file) {
  if (!file || typeof file !== "object") return null;
  const name = String(file.name || file.originalname || "arquivo");
  const safeName = name.replace(/[^\w.\- ]+/g, "_").slice(0, 120);
  const dot = safeName.lastIndexOf(".");
  return {
    arquivo: safeName,
    extensao: dot > 0 ? safeName.slice(dot + 1).toLowerCase() : null,
    tipo: sanitizeMessage(file.type || file.mimetype || null, 120),
    bytes: Number.isFinite(Number(file.size)) ? Number(file.size) : null,
  };
}

function shortenUserAgent(userAgent) {
  const text = String(userAgent || "").trim();
  if (!text) return null;
  const browser = text.match(/(Edg|OPR|Chrome|Firefox|Safari|Version)\/([\d.]+)/);
  const os = text.match(/\(([^)]{0,60})\)/);
  if (browser) {
    const label = browser[1] === "Version" ? "Safari" : browser[1];
    return truncateString(`${label} ${browser[2].split(".")[0]}${os ? ` · ${os[1].split(";")[0]}` : ""}`, 120);
  }
  return truncateString(text, 120);
}

module.exports = {
  REDACTED,
  SENSITIVE_KEY_PARTS,
  SENSITIVE_KEY_EXACT,
  DEFAULT_LIMITS,
  normalizeKey,
  isSensitiveKey,
  looksSensitiveValue,
  maskValue,
  scrubSecrets,
  truncateString,
  sanitizeValue,
  sanitizeHeaders,
  sanitizeUrl,
  sanitizePath,
  sanitizeStack,
  sanitizeMessage,
  sanitizeError,
  summarizeFile,
  shortenUserAgent,
};
