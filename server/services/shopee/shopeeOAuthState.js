// `state` do OAuth Shopee: 32 bytes aleatórios (base64url), TTL curto, uso único.
// Guardado SÓ em memória, indexado pelo SHA-256 do state (o valor cru não fica
// guardado). Consumir apaga a entrada — em sucesso ou falha —, então replay
// sempre cai em "inválido".
//
// Limite consciente desta fase (prova do 1º grant TEST): um restart/deploy do
// processo entre gerar o link e o callback derruba o state, e o callback recusa
// (falha fechada: basta gerar outro link). Com mais de uma instância o state
// também não é compartilhado. A tabela definitiva vem com a modelagem de tokens.
const crypto = require("crypto");

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const MAX_PENDENTES = 500;
const STATE_RE = /^[A-Za-z0-9_-]{43}$/;

function hashState(state) {
  return crypto.createHash("sha256").update(state, "utf8").digest("hex");
}

function createStateStore({ ttlMs = DEFAULT_TTL_MS, now = Date.now, maxPendentes = MAX_PENDENTES } = {}) {
  const pendentes = new Map();

  function limparExpirados() {
    const agora = now();
    for (const [k, v] of pendentes) if (v.expiresAt <= agora) pendentes.delete(k);
  }

  // `intencao`: só dados não sensíveis (app, ambiente, userId, clienteContaId futuro).
  function emitir(intencao) {
    limparExpirados();
    if (pendentes.size >= maxPendentes) {
      const maisAntigo = pendentes.keys().next().value;
      pendentes.delete(maisAntigo);
    }
    const state = crypto.randomBytes(32).toString("base64url");
    const expiresAt = now() + ttlMs;
    pendentes.set(hashState(state), { intencao: { ...intencao }, expiresAt });
    return { state, expiresAt };
  }

  // { ok: true, intencao } | { ok: false, motivo: "AUSENTE" | "INVALIDO" | "EXPIRADO" }
  // "INVALIDO" cobre desconhecido e já usado: não dá para distinguir sem guardar histórico.
  function consumir(state) {
    if (state === undefined || state === null || String(state).trim() === "") return { ok: false, motivo: "AUSENTE" };
    if (typeof state !== "string" || !STATE_RE.test(state)) return { ok: false, motivo: "INVALIDO" };
    const chave = hashState(state);
    const entrada = pendentes.get(chave);
    if (!entrada) return { ok: false, motivo: "INVALIDO" };
    pendentes.delete(chave);
    if (entrada.expiresAt <= now()) return { ok: false, motivo: "EXPIRADO" };
    return { ok: true, intencao: entrada.intencao };
  }

  return { emitir, consumir, tamanho: () => pendentes.size };
}

const shopeeOAuthStateStore = createStateStore();

module.exports = { createStateStore, shopeeOAuthStateStore, DEFAULT_TTL_MS };
