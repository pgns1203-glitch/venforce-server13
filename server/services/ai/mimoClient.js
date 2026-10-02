// server/services/ai/mimoClient.js
// -----------------------------------------------------------------------------
// Client isolado da Xiaomi MiMo, via a API compatível com o protocolo Anthropic
// Messages (doc oficial: mimo.mi.com/docs/en-US/api/chat/anthropic-api).
//
// O PROVEDOR é "mimo" — Anthropic é só o formato do transporte. Base URL,
// chave e modelo são da MiMo; nada aqui lê ANTHROPIC_*.
//
// Mesma interface do claudeClient (gerarTexto, getModel, resolverModeloPadrao,
// PROVIDER) e mesma política observável de retry/timeout. Não é chamado direto
// pelos engines: quem fala com o resto do sistema é o aiProvider.
//
// Sem dependências externas: fetch nativo do Node (>= 18).
// A chave vem SOMENTE de process.env.MIMO_API_KEY.
// -----------------------------------------------------------------------------

// Pay-as-you-go. (Token Plan usa outro host e outra chave; não suportado.)
const MIMO_URL = "https://api.xiaomimimo.com/anthropic/v1/messages";

const DEFAULT_MODEL = "mimo-v2.6-pro";

const PROVIDER = "mimo";

// Mesmo timeout por tentativa do claudeClient. Com thinking desligado a
// geração é texto curto; não há motivo para esperar mais. Cobre a tentativa
// inteira: conexão, headers e leitura do body.
const TIMEOUT_MS = 45000;

// Retry: no máximo UMA nova tentativa, só 429/5xx/rede (a doc marca 429, 500 e
// 503 como "retryable"). TIMEOUT e 4xx funcional (400/401/402/403/404/421)
// nunca são repetidos.
const MAX_TENTATIVAS = 2;
const RETRY_DELAY_PADRAO_MS = 1000;
const RETRY_DELAY_MAX_MS = 5000;

// Faixa oficial de temperature (default da MiMo: 1.0).
const TEMPERATURE_MIN = 0;
const TEMPERATURE_MAX = 1.5;

function resolverModeloPadrao() {
  const env = String(process.env.MIMO_MODEL || "").trim();
  return env ? { model: env, origem: "MIMO_MODEL" } : { model: DEFAULT_MODEL, origem: "DEFAULT_MODEL" };
}

function getModel() {
  return resolverModeloPadrao().model;
}

// ---------------------------------------------------------------------------
// montarCorpo — request no formato Anthropic-compatible da MiMo.
//
// thinking: SEMPRE desligado. Na MiMo ele vem LIGADO por padrão nos modelos
// V2.6/V2.5 e, ligado, ignora temperature/top_p (força 1.0/0.95). Título e
// descrição não precisam de raciocínio estendido.
//
// temperature: com thinking desligado a MiMo respeita o valor; é limitado à
// faixa oficial [0, 1.5]. Sem número, fica o default do provedor.
// ---------------------------------------------------------------------------
function montarCorpo({ model, system, prompt, maxTokens, temperature }) {
  const body = {
    model,
    max_tokens: maxTokens || 1500,
    messages: [{ role: "user", content: String(prompt || "") }],
    thinking: { type: "disabled" },
  };
  if (typeof temperature === "number" && Number.isFinite(temperature)) {
    body.temperature = Math.min(TEMPERATURE_MAX, Math.max(TEMPERATURE_MIN, temperature));
  }
  if (system) body.system = String(system);
  return body;
}

function erroTransitorio(resultado) {
  if (!resultado || resultado.ok) return false;
  if (resultado.codigo === "NETWORK") return true;
  const m = /^HTTP_(\d{3})$/.exec(resultado.codigo || "");
  if (!m) return false;
  const status = Number(m[1]);
  return status === 429 || status >= 500;
}

// Dependências trocáveis em teste (espera entre tentativas e teto por tentativa).
const _deps = {
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  timeoutMs: TIMEOUT_MS,
};

// A doc não promete Retry-After; se vier, é respeitado (com teto).
function atrasoRetry(resultado) {
  const s = resultado && resultado.retryAfterSeg;
  if (typeof s === "number" && Number.isFinite(s) && s >= 0) {
    return Math.min(s * 1000, RETRY_DELAY_MAX_MS);
  }
  return RETRY_DELAY_PADRAO_MS;
}

// ---------------------------------------------------------------------------
// gerarTexto — chamada bruta à MiMo. Mesmo contrato do claudeClient.
//
// Parâmetros: { system, prompt, maxTokens?, temperature?, model? }
//
// Retorno padronizado (NUNCA lança):
//   sucesso -> { ok:true,  texto, provider, model, usage, stopReason, tentativas }
//   erro    -> { ok:false, erro, codigo, provider, model, tentativas }
//
// Códigos: NO_API_KEY | HTTP_<status> | TIMEOUT | NETWORK | EMPTY_RESPONSE |
//          CONTENT_FILTER (stop_reason "content_filter": texto omitido).
// ---------------------------------------------------------------------------
async function gerarTexto(opts) {
  const { system, prompt, maxTokens, temperature } = opts || {};
  const apiKey = process.env.MIMO_API_KEY;
  const pedido = opts && typeof opts.model === "string" ? opts.model.trim() : "";
  const model = pedido || getModel();

  if (!apiKey) {
    return {
      ok: false,
      codigo: "NO_API_KEY",
      erro: "MIMO_API_KEY não está configurada no servidor.",
      provider: PROVIDER,
      model,
      tentativas: 0,
    };
  }

  const body = montarCorpo({ model, system, prompt, maxTokens, temperature });

  let resultado = null;
  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
    resultado = await chamarUmaVez({ apiKey, model, body });
    resultado.tentativas = tentativa;
    if (!erroTransitorio(resultado) || tentativa === MAX_TENTATIVAS) break;
    await _deps.sleep(atrasoRetry(resultado));
  }
  delete resultado.retryAfterSeg;
  return resultado;
}

// F6.2: o timeout cobre a requisição INTEIRA — headers e leitura do body.
// Antes o timer era cancelado assim que os headers chegavam, e um body lento
// ficava sem teto (chamada real de 142 s com TIMEOUT_MS de 45 s).
async function chamarUmaVez(args) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), _deps.timeoutMs);
  try {
    return await executarChamada(args, controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

function erroAbort() {
  const e = new Error("aborted");
  e.name = "AbortError";
  return e;
}

// resp.json() respeitando o AbortSignal. O fetch nativo já aborta o body
// quando o sinal dispara; a corrida garante o mesmo para qualquer Response
// (inclusive uma que ignore o sinal).
function lerJson(resp, signal) {
  if (signal.aborted) return Promise.reject(erroAbort());
  return new Promise((resolve, reject) => {
    const aoAbortar = () => reject(erroAbort());
    signal.addEventListener("abort", aoAbortar, { once: true });
    Promise.resolve()
      .then(() => resp.json())
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", aoAbortar));
  });
}

function resultadoTimeout(model) {
  return {
    ok: false,
    codigo: "TIMEOUT",
    erro: "A chamada à IA excedeu o tempo limite.",
    provider: PROVIDER,
    model,
  };
}

async function executarChamada({ apiKey, model, body }, signal) {
  let resp;
  try {
    resp = await fetch(MIMO_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if ((err && err.name === "AbortError") || signal.aborted) return resultadoTimeout(model);
    return {
      ok: false,
      codigo: "NETWORK",
      erro: "Falha de rede ao contatar a IA.",
      provider: PROVIDER,
      model,
    };
  }

  if (!resp.ok) {
    // não repassa corpo de erro inteiro para não vazar nada sensível.
    // Body de erro lento: o timeout corta a leitura, mas o status já é
    // conhecido — fica HTTP_<status> (e a política de retry dele).
    let detalhe = "";
    try {
      const j = await lerJson(resp, signal);
      detalhe =
        (j && j.error && j.error.message) ||
        (j && j.error && j.error.type) ||
        "";
    } catch (e) {
      detalhe = "";
    }
    let retryAfterSeg = null;
    try {
      const h = resp.headers && typeof resp.headers.get === "function" ? resp.headers.get("retry-after") : null;
      const n = h != null ? Number(h) : NaN;
      if (Number.isFinite(n) && n >= 0) retryAfterSeg = n;
    } catch (e) { /* sem header */ }
    return {
      ok: false,
      codigo: "HTTP_" + resp.status,
      erro:
        "A API da IA respondeu com erro " +
        resp.status +
        (detalhe ? " (" + String(detalhe).slice(0, 200) + ")" : "") +
        ".",
      provider: PROVIDER,
      model,
      retryAfterSeg,
    };
  }

  let data;
  try {
    data = await lerJson(resp, signal);
  } catch (e) {
    if ((e && e.name === "AbortError") || signal.aborted) return resultadoTimeout(model);
    return {
      ok: false,
      codigo: "EMPTY_RESPONSE",
      erro: "Resposta da IA não pôde ser interpretada.",
      provider: PROVIDER,
      model,
    };
  }

  const stopReason = (data && data.stop_reason) || null;

  // Conteúdo omitido pelo filtro da MiMo: não é resposta utilizável.
  if (stopReason === "content_filter") {
    return {
      ok: false,
      codigo: "CONTENT_FILTER",
      erro: "A IA bloqueou a resposta pelo filtro de conteúdo do provedor.",
      provider: PROVIDER,
      model,
      usage: (data && data.usage) || null,
      stopReason,
    };
  }

  // Só blocos "text"; blocos "thinking" (se algum dia vierem) são ignorados.
  const texto = Array.isArray(data && data.content)
    ? data.content
        .filter((b) => b && b.type === "text" && typeof b.text === "string")
        .map((b) => b.text)
        .join("\n")
        .trim()
    : "";

  if (!texto) {
    return {
      ok: false,
      codigo: "EMPTY_RESPONSE",
      erro: "A IA retornou uma resposta vazia.",
      provider: PROVIDER,
      model,
      stopReason,
    };
  }

  return {
    ok: true,
    texto,
    provider: PROVIDER,
    model,
    usage: (data && data.usage) || null,
    stopReason,
  };
}

module.exports = {
  gerarTexto,
  getModel,
  resolverModeloPadrao,
  montarCorpo,
  PROVIDER,
  DEFAULT_MODEL,
  MIMO_URL,
  TIMEOUT_MS,
  MAX_TENTATIVAS,
  _deps,
};
