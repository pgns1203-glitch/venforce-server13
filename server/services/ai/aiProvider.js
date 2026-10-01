// server/services/ai/aiProvider.js
// -----------------------------------------------------------------------------
// Camada de abstração de provedor de IA (texto).
//
// Engines e services NUNCA importam o claudeClient direto — importam este
// aiProvider e informam a TASK (ver aiTasks.js). Eles não conhecem URL,
// headers, chave, formato da Messages API, retry nem timeout: isso é do client.
//
// Contrato para quem chama:
//   gerarJSON({ task, system, prompt, maxTokens?, temperature? })
//   gerarTexto({ task, system, prompt, maxTokens?, temperature? })
//
// Hoje só existe o provedor "anthropic" (Claude, modelo padrão Haiku). Para
// adicionar OpenAI ou Gemini no futuro: criar um client com a mesma interface
// do claudeClient (gerarTexto, getModel, resolverModeloPadrao, PROVIDER) e
// registrá-lo no mapa PROVIDERS abaixo. Engines não mudam.
//
// Provedor ativo: env AI_PROVIDER. Ausente/vazia = "anthropic". Qualquer
// valor fora do mapa PROVIDERS é erro explícito (AI_PROVIDER_INVALID), nunca
// fallback silencioso. Ver docs/AI_PROVIDER.md.
// -----------------------------------------------------------------------------

const claudeClient = require("./claudeClient");
const { taskConhecida, modeloDaTask } = require("./aiTasks");

// Mapa de provedores disponíveis. Cada um precisa expor:
//   gerarTexto({ system, prompt, maxTokens, temperature, model }) -> { ok, texto, ... }
//   getModel(), resolverModeloPadrao(), PROVIDER
const PROVIDERS = {
  anthropic: claudeClient,
};

const PROVIDER_PADRAO = "anthropic";

// Provedor configurado, ou null se AI_PROVIDER tem valor que não existe aqui.
function getProvider() {
  const nome = String(process.env.AI_PROVIDER || "").trim().toLowerCase() || PROVIDER_PADRAO;
  return Object.prototype.hasOwnProperty.call(PROVIDERS, nome) ? PROVIDERS[nome] : null;
}

// Não ecoa o valor configurado: pode ser qualquer coisa colada por engano.
const MSG_PROVIDER_INVALIDO = 'AI_PROVIDER inválido: use "anthropic" ou deixe vazio.';

function providerOuErro() {
  const provider = getProvider();
  if (provider) return provider;
  const e = new Error(MSG_PROVIDER_INVALIDO);
  e.codigo = "AI_PROVIDER_INVALID";
  throw e;
}

// Dependências trocáveis em teste (relógio e saída de log).
const _deps = {
  agora: () => Date.now(),
  log: (linha) => console.info(linha),
};

// ---------------------------------------------------------------------------
// resolverModelo — qual provedor/modelo atende a task, e de onde veio.
//   modelo específico da task (AI_SEO_*_MODEL) → padrão do provedor
//   (ANTHROPIC_MODEL → DEFAULT_MODEL). Task ausente/desconhecida = padrão.
// ---------------------------------------------------------------------------
function resolverModelo(task) {
  const provider = providerOuErro();
  const daTask = modeloDaTask(task);
  const escolhido = daTask || provider.resolverModeloPadrao();
  return { provider: provider.PROVIDER, model: escolhido.model, origem: escolhido.origem };
}

// ---------------------------------------------------------------------------
// Metadata interna de uma geração. Só dados que a API devolveu de fato; o
// que não veio é null (nunca 0). Não sai nas respostas HTTP públicas.
// ---------------------------------------------------------------------------
function numeroOuNull(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function montarMeta({ task, resp, latencyMs, codigo }) {
  const usage = resp && resp.usage;
  return {
    task,
    provider: (resp && resp.provider) || null,
    model: (resp && resp.model) || null,
    latencyMs,
    usage: {
      inputTokens: numeroOuNull(usage && usage.input_tokens),
      outputTokens: numeroOuNull(usage && usage.output_tokens),
    },
    finishReason: (resp && resp.stopReason) || null,
    tentativas: numeroOuNull(resp && resp.tentativas),
    status: codigo ? "erro" : "ok",
    codigo: codigo || null,
  };
}

// Uma linha por geração, só campos seguros: nunca prompt, texto gerado,
// título, descrição, dados do anúncio nem chave.
function registrar(meta) {
  const v = (x) => (x == null ? "-" : x);
  try {
    _deps.log(
      "[ai] task=" + v(meta.task) +
      " provider=" + v(meta.provider) +
      " model=" + v(meta.model) +
      " status=" + meta.status +
      " codigo=" + v(meta.codigo) +
      " latencyMs=" + v(meta.latencyMs) +
      " inputTokens=" + v(meta.usage.inputTokens) +
      " outputTokens=" + v(meta.usage.outputTokens) +
      " finishReason=" + v(meta.finishReason) +
      " tentativas=" + v(meta.tentativas)
    );
  } catch (e) { /* log nunca derruba a geração */ }
}

// Chamada única ao provedor, com o modelo resolvido pela task.
async function executar(opts) {
  const o = opts || {};
  const task = taskConhecida(o.task) ? o.task : null;
  // Configuração inválida falha cedo: nenhuma chamada sai para o provedor.
  if (!getProvider()) {
    return {
      task,
      latencyMs: null,
      resp: {
        ok: false, codigo: "AI_PROVIDER_INVALID", erro: MSG_PROVIDER_INVALIDO,
        provider: null, model: null, tentativas: 0,
      },
    };
  }
  const { model } = resolverModelo(task);
  const inicio = _deps.agora();
  const resp = await getProvider().gerarTexto({
    system: o.system,
    prompt: o.prompt,
    maxTokens: o.maxTokens,
    temperature: o.temperature,
    model,
  });
  // Sem tentativa (ex.: NO_API_KEY) não houve chamada: latência desconhecida.
  const latencyMs = resp && resp.tentativas === 0 ? null : Math.max(0, _deps.agora() - inicio);
  return { task, resp, latencyMs };
}

// ---------------------------------------------------------------------------
// gerarTexto — resposta crua de texto do provedor ativo (+ meta).
// ---------------------------------------------------------------------------
async function gerarTexto(opts) {
  const { task, resp, latencyMs } = await executar(opts);
  const meta = montarMeta({ task, resp, latencyMs, codigo: resp.ok ? null : resp.codigo });
  registrar(meta);
  return { ...resp, meta };
}

// ---------------------------------------------------------------------------
// limparJson — remove cercas de código (```json ... ```) e texto ao redor,
// devolvendo só o miolo que parece JSON. Defensivo: a IA às vezes embrulha.
// ---------------------------------------------------------------------------
function limparJson(texto) {
  if (!texto) return "";
  let t = String(texto).trim();

  // remove cercas de markdown
  t = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

  // se ainda houver lixo antes/depois, recorta do primeiro { ao último }
  const ini = t.indexOf("{");
  const fim = t.lastIndexOf("}");
  if (ini !== -1 && fim !== -1 && fim > ini) {
    t = t.slice(ini, fim + 1);
  }
  return t.trim();
}

// ---------------------------------------------------------------------------
// gerarJSON — chama a IA e devolve JSON já validado.
//
// Parâmetros: { task, system, prompt, maxTokens?, temperature? }
//
// Retorno padronizado (NUNCA lança):
//   sucesso -> { ok:true,  data, provider, model, usage, meta }
//   erro    -> { ok:false, erro, codigo, provider, model, raw?, meta }
//
// `meta` é interno (task, provider, model, latencyMs, usage normalizado,
// finishReason, tentativas, status, codigo): ninguém o repassa ao frontend.
//
// Códigos extras em relação ao client:
//   AI_PROVIDER_INVALID   — AI_PROVIDER com valor que não é provedor daqui;
//                           nenhuma chamada sai (tentativas 0).
//   AI_RESPONSE_TRUNCATED — a IA parou no limite de tokens (stop_reason
//                           "max_tokens"). O JSON viria cortado; antes isso
//                           aparecia como JSON_INVALIDO e escondia a causa.
//   JSON_INVALIDO         — resposta completa, mas não é JSON válido.
// ---------------------------------------------------------------------------
async function gerarJSON(opts) {
  const { task, resp, latencyMs } = await executar(opts);
  const comMeta = (resultado) => {
    const meta = montarMeta({ task, resp, latencyMs, codigo: resultado.ok ? null : resultado.codigo });
    registrar(meta);
    return { ...resultado, meta };
  };

  if (!resp.ok) {
    // erro já vem padronizado do client (NO_API_KEY, HTTP_*, TIMEOUT...)
    return comMeta(resp);
  }

  if (resp.stopReason === "max_tokens") {
    return comMeta({
      ok: false,
      codigo: "AI_RESPONSE_TRUNCATED",
      erro: "A resposta da IA foi cortada no limite de tamanho. Tente gerar novamente.",
      provider: resp.provider,
      model: resp.model,
      usage: resp.usage || null,
      raw: resp.texto, // só para debug; o service decide se persiste
    });
  }

  const limpo = limparJson(resp.texto);
  let data;
  try {
    data = JSON.parse(limpo);
  } catch (e) {
    return comMeta({
      ok: false,
      codigo: "JSON_INVALIDO",
      erro: "A IA não retornou um JSON válido.",
      provider: resp.provider,
      model: resp.model,
      raw: resp.texto, // guardado só para debug; o service decide se persiste
    });
  }

  return comMeta({
    ok: true,
    data,
    provider: resp.provider,
    model: resp.model,
    usage: resp.usage || null,
  });
}

function modeloAtual(task) {
  return resolverModelo(task).model;
}

function provedorAtual() {
  return providerOuErro().PROVIDER;
}

module.exports = {
  gerarTexto,
  gerarJSON,
  limparJson,
  resolverModelo,
  modeloAtual,
  provedorAtual,
  _deps,
};
