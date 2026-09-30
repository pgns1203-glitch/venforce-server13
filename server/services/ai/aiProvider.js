// server/services/ai/aiProvider.js
// -----------------------------------------------------------------------------
// Camada de abstração de provedor de IA.
//
// Os services do otimizador NUNCA importam o claudeClient direto — importam
// este aiProvider. Assim o resto do sistema não fica preso a um provedor.
//
// Hoje só existe o provedor "anthropic" (Claude). Para adicionar OpenAI ou
// Gemini no futuro: criar server/services/ai/openaiClient.js (mesma assinatura
// de gerarTexto) e registrá-lo no mapa PROVIDERS abaixo. Nada mais muda.
//
// Provedor ativo é definido pela env AI_PROVIDER (default: "anthropic").
// -----------------------------------------------------------------------------

const claudeClient = require("./claudeClient");

// Mapa de provedores disponíveis. Cada um precisa expor:
//   gerarTexto({ system, prompt, maxTokens, temperature }) -> { ok, texto, ... }
//   getModel(), PROVIDER
const PROVIDERS = {
  anthropic: claudeClient,
};

function getProvider() {
  const nome = (process.env.AI_PROVIDER || "anthropic").toLowerCase();
  return PROVIDERS[nome] || claudeClient;
}

// ---------------------------------------------------------------------------
// gerarTexto — repassa para o provedor ativo. Resposta crua de texto.
// ---------------------------------------------------------------------------
async function gerarTexto(opts) {
  return getProvider().gerarTexto(opts || {});
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
// Parâmetros: { system, prompt, maxTokens?, temperature? }
//
// Retorno padronizado (NUNCA lança):
//   sucesso -> { ok:true,  data, provider, model, usage }
//   erro    -> { ok:false, erro, codigo, provider, model, raw? }
//
// Códigos extras em relação ao client:
//   AI_RESPONSE_TRUNCATED — a IA parou no limite de tokens (stop_reason
//                           "max_tokens"). O JSON viria cortado; antes isso
//                           aparecia como JSON_INVALIDO e escondia a causa.
//   JSON_INVALIDO         — resposta completa, mas não é JSON válido.
// ---------------------------------------------------------------------------
async function gerarJSON(opts) {
  const resp = await gerarTexto(opts || {});

  if (!resp.ok) {
    // erro já vem padronizado do client (NO_API_KEY, HTTP_*, TIMEOUT...)
    return resp;
  }

  if (resp.stopReason === "max_tokens") {
    return {
      ok: false,
      codigo: "AI_RESPONSE_TRUNCATED",
      erro: "A resposta da IA foi cortada no limite de tamanho. Tente gerar novamente.",
      provider: resp.provider,
      model: resp.model,
      usage: resp.usage || null,
      raw: resp.texto, // só para debug; o service decide se persiste
    };
  }

  const limpo = limparJson(resp.texto);
  let data;
  try {
    data = JSON.parse(limpo);
  } catch (e) {
    return {
      ok: false,
      codigo: "JSON_INVALIDO",
      erro: "A IA não retornou um JSON válido.",
      provider: resp.provider,
      model: resp.model,
      raw: resp.texto, // guardado só para debug; o service decide se persiste
    };
  }

  return {
    ok: true,
    data,
    provider: resp.provider,
    model: resp.model,
    usage: resp.usage || null,
  };
}

function modeloAtual() {
  return getProvider().getModel();
}

function provedorAtual() {
  return getProvider().PROVIDER;
}

module.exports = {
  gerarTexto,
  gerarJSON,
  limparJson,
  modeloAtual,
  provedorAtual,
};
