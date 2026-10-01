// server/services/ai/claudeClient.js
// -----------------------------------------------------------------------------
// Client isolado da API da Anthropic (Claude).
//
// Detalhe interno: NÃO é chamado direto pelos services do otimizador.
// Quem fala com o resto do sistema é o aiProvider.js — este arquivo é só o
// "driver" do provedor Claude. Para trocar/adicionar provedor (OpenAI, Gemini),
// cria-se outro client e o aiProvider passa a apontar para ele.
//
// Sem dependências externas: usa o fetch nativo do Node (>= 18).
// A chave vem SOMENTE de process.env.ANTHROPIC_API_KEY.
// -----------------------------------------------------------------------------

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

// Modelo padrão: Haiku 4.5 (rápido e barato, suficiente para texto comercial).
// Pode ser sobrescrito pela env ANTHROPIC_MODEL.
const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

const PROVIDER = "anthropic";

// Timeout defensivo por tentativa.
const TIMEOUT_MS = 45000;

// Retry: no máximo UMA nova tentativa, só para falha transitória que
// aconteceu ANTES de existir resposta da IA (429, 5xx/529, falha de rede).
// TIMEOUT não é repetido: a tentativa já gastou 45s e uma segunda dobraria a
// espera do operador. 4xx funcional (400/401/403/404/413) nunca é repetido.
const MAX_TENTATIVAS = 2;
const RETRY_DELAY_PADRAO_MS = 1000;
const RETRY_DELAY_MAX_MS = 5000;

function getModel() {
  return process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
}

// Modelo padrão do provedor + de onde ele veio (para diagnóstico/log).
function resolverModeloPadrao() {
  return process.env.ANTHROPIC_MODEL
    ? { model: process.env.ANTHROPIC_MODEL, origem: "ANTHROPIC_MODEL" }
    : { model: DEFAULT_MODEL, origem: "DEFAULT_MODEL" };
}

// ---------------------------------------------------------------------------
// aceitaTemperature — o modelo aceita o parâmetro `temperature`?
//
// A API não expõe essa capacidade de forma consultável por request, e os
// modelos novos da Anthropic REMOVERAM os parâmetros de amostragem (enviar
// `temperature` devolve 400 em Opus 4.7+, Sonnet 5+, Fable, e Sonnet 5.5
// recusa valor diferente do padrão). Por isso é uma ALLOWLIST pequena por
// família/versão, não uma denylist: um modelo desconhecido ou mais novo cai
// no caminho seguro (não envia) em vez de quebrar com 400.
//
// Aceitam:  família claude-3* (legado) e Opus/Sonnet/Haiku da geração 4
//           até a versão 4.6 (inclusive o default atual, Haiku 4.5).
// Omitem:   todo o resto (Opus 4.7/4.8/5/5.5, Sonnet 5/5.5, Fable, Mythos,
//           e qualquer nome que não case com o padrão).
// ---------------------------------------------------------------------------
function aceitaTemperature(model) {
  const id = String(model || "").trim().toLowerCase();
  if (/^claude-3(?:[-.]|$)/.test(id)) return true;
  const m = id.match(/^claude-(opus|sonnet|haiku)-(\d+)(?:-(\d+))?(?:-|$)/);
  if (!m) return false;
  const major = Number(m[2]);
  // "claude-sonnet-4-20250514": o segundo número é data, não versão menor.
  const minorBruto = m[3] != null ? Number(m[3]) : 0;
  const minor = m[3] != null && m[3].length >= 6 ? 0 : minorBruto;
  return major === 4 && minor <= 6;
}

// Monta o corpo da requisição. Separado para ser testável sem rede.
function montarCorpo({ model, system, prompt, maxTokens, temperature }) {
  const body = {
    model,
    max_tokens: maxTokens || 1500,
    messages: [{ role: "user", content: String(prompt || "") }],
  };
  if (aceitaTemperature(model)) {
    body.temperature = typeof temperature === "number" ? temperature : 0.4;
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

// Dependências trocáveis em teste (espera entre tentativas).
const _deps = {
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

function atrasoRetry(resultado) {
  const s = resultado && resultado.retryAfterSeg;
  if (typeof s === "number" && Number.isFinite(s) && s >= 0) {
    return Math.min(s * 1000, RETRY_DELAY_MAX_MS);
  }
  return RETRY_DELAY_PADRAO_MS;
}

// ---------------------------------------------------------------------------
// gerarTexto — chamada bruta ao Claude.
//
// Parâmetros:
//   { system, prompt, maxTokens?, temperature?, model? }
//
// `model` vem resolvido pelo aiProvider (modelo da task); ausente = getModel().
// A regra de temperature (aceitaTemperature) vale para o modelo efetivo.
//
// Retorno padronizado (NUNCA lança — sempre devolve objeto):
//   sucesso -> { ok:true,  texto, provider, model, usage, stopReason, tentativas }
//   erro    -> { ok:false, erro, codigo, provider, model, tentativas }
//
// Códigos de erro possíveis:
//   NO_API_KEY | HTTP_<status> | TIMEOUT | NETWORK | EMPTY_RESPONSE
//
// `stopReason` é o stop_reason cru da API ("end_turn", "max_tokens", ...).
// Quem precisa de resposta completa (gerarJSON) decide o que fazer com
// "max_tokens" — aqui o texto parcial ainda é devolvido como sucesso para
// não mudar o contrato de gerarTexto.
// ---------------------------------------------------------------------------
async function gerarTexto(opts) {
  const { system, prompt, maxTokens, temperature } = opts || {};
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const pedido = opts && typeof opts.model === "string" ? opts.model.trim() : "";
  const model = pedido || getModel();

  if (!apiKey) {
    return {
      ok: false,
      codigo: "NO_API_KEY",
      erro: "ANTHROPIC_API_KEY não está configurada no servidor.",
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

async function chamarUmaVez({ apiKey, model, body }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let resp;
  try {
    resp = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    const abortado = err && err.name === "AbortError";
    return {
      ok: false,
      codigo: abortado ? "TIMEOUT" : "NETWORK",
      erro: abortado
        ? "A chamada à IA excedeu o tempo limite."
        : "Falha de rede ao contatar a IA.",
      provider: PROVIDER,
      model,
    };
  }
  clearTimeout(timer);

  if (!resp.ok) {
    // não loga corpo de erro inteiro para não vazar nada sensível
    let detalhe = "";
    try {
      const j = await resp.json();
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
        (detalhe ? " (" + detalhe + ")" : "") +
        ".",
      provider: PROVIDER,
      model,
      retryAfterSeg,
    };
  }

  let data;
  try {
    data = await resp.json();
  } catch (e) {
    return {
      ok: false,
      codigo: "EMPTY_RESPONSE",
      erro: "Resposta da IA não pôde ser interpretada.",
      provider: PROVIDER,
      model,
    };
  }

  // O conteúdo vem em data.content[], blocos do tipo "text".
  const texto = Array.isArray(data && data.content)
    ? data.content
        .filter((b) => b && b.type === "text" && typeof b.text === "string")
        .map((b) => b.text)
        .join("\n")
        .trim()
    : "";

  const stopReason = (data && data.stop_reason) || null;

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
  aceitaTemperature,
  montarCorpo,
  PROVIDER,
  DEFAULT_MODEL,
  TIMEOUT_MS,
  MAX_TENTATIVAS,
  _deps,
};
