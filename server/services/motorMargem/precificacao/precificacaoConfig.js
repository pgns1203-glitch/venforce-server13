// server/services/motorMargem/precificacao/precificacaoConfig.js
// Central de Margem — rollout da ESCRITA de preço/promoção.
//
// Nasce DESLIGADA. Mesmo padrão da leitura persistida
// (marginSnapshotReadService.leituraHabilitada):
//   MARGIN_PRICING_WRITE_ENABLED=true   → escrita liberada para todos
//   MARGIN_PRICING_WRITE_CLIENTES=a,b   → só para estes slugs
// Sem nenhuma das duas: simulação, promoções, preview, gates e histórico
// funcionam; o APLICAR responde "rollout desligado" e nunca chama o ML.
//
// Leitura por chamada (não no load do módulo): testes injetam `env`.

const { flagLigada } = require("../marginSnapshotConfig");

function inteiroEntre(raw, { padrao, min, max }) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return padrao;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

function listaDeSlugs(raw) {
  return String(raw || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function escritaHabilitada({ clienteSlug } = {}, env = process.env) {
  if (flagLigada(env.MARGIN_PRICING_WRITE_ENABLED)) return true;
  const slug = String(clienteSlug || "").trim().toLowerCase();
  return Boolean(slug) && listaDeSlugs(env.MARGIN_PRICING_WRITE_CLIENTES).includes(slug);
}

function resolvePricingConfig(env = process.env) {
  return {
    // Validade do preview: depois disso o APLICAR exige um preview novo.
    previewTtlMinutes: inteiroEntre(env.MARGIN_PRICING_PREVIEW_TTL_MINUTES, { padrao: 10, min: 1, max: 60 }),
    // Linha presa em 'aplicando' (processo morreu no meio) libera o item
    // depois disso, como 'falhou' com resultado incerto.
    aplicandoStaleMinutes: inteiroEntre(env.MARGIN_PRICING_APLICANDO_STALE_MINUTES, { padrao: 10, min: 2, max: 240 }),
    // Espera antes do refresh pontual do snapshot (o sale_price do ML pode
    // demorar alguns segundos para refletir a escrita).
    snapshotRefreshDelayMs: inteiroEntre(env.MARGIN_PRICING_SNAPSHOT_DELAY_MS, { padrao: 5000, min: 0, max: 120000 }),
    // Cache curto da base do Motor usada SÓ pela simulação ao vivo (digitação).
    // Preview e aplicar sempre releem ao vivo.
    simulacaoCacheMs: inteiroEntre(env.MARGIN_PRICING_SIMULACAO_CACHE_MS, { padrao: 30000, min: 0, max: 300000 }),
  };
}

module.exports = { escritaHabilitada, resolvePricingConfig, listaDeSlugs };
