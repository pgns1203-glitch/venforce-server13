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
  // Timeout REAL de cada chamada ao ML no caminho da escrita (AbortController).
  const mlTimeoutMs = inteiroEntre(env.MARGIN_PRICING_ML_TIMEOUT_MS, { padrao: 15000, min: 1000, max: 60000 });
  // Folga entre o fim do prazo local de envio e o fim do lease no banco.
  const margemSegurancaSegundos = inteiroEntre(env.MARGIN_PRICING_LEASE_MARGEM_SEGUNDOS, { padrao: 10, min: 2, max: 120 });
  // Lease renovado imediatamente antes do envio. INVARIANTE (forçado aqui, não
  // configurável para baixo): o envio + o timeout do ML cabem com folga
  // dentro dele, então quando o lease vence a requisição já terminou ou foi
  // abortada pelo próprio processo.
  const leaseEscritaMinimo = Math.ceil(mlTimeoutMs / 1000) + margemSegurancaSegundos + 5;
  const leaseEscritaSegundos = Math.max(
    inteiroEntre(env.MARGIN_PRICING_LEASE_ESCRITA_SEGUNDOS, { padrao: 30, min: 5, max: 600 }),
    leaseEscritaMinimo
  );
  // Lease do claim (cobre a reavaliação ao vivo, que tem prazo próprio menor).
  const reavaliacaoTimeoutMs = inteiroEntre(env.MARGIN_PRICING_REAVALIACAO_TIMEOUT_MS, { padrao: 60000, min: 5000, max: 300000 });
  const leaseSegundos = Math.max(
    inteiroEntre(env.MARGIN_PRICING_LEASE_SEGUNDOS, { padrao: 120, min: 10, max: 1800 }),
    Math.ceil(reavaliacaoTimeoutMs / 1000) + margemSegurancaSegundos
  );
  return {
    // Validade do preview: depois disso o APLICAR exige um preview novo.
    previewTtlMinutes: inteiroEntre(env.MARGIN_PRICING_PREVIEW_TTL_MINUTES, { padrao: 10, min: 1, max: 60 }),
    mlTimeoutMs,
    reavaliacaoTimeoutMs,
    leaseSegundos,
    leaseEscritaSegundos,
    margemSegurancaSegundos,
    // Carência depois do lease vencido antes de reconciliar (cobre requisição
    // que ainda estivesse em voo na rede).
    carenciaLeaseSegundos: inteiroEntre(env.MARGIN_PRICING_LEASE_CARENCIA_SEGUNDOS, { padrao: 30, min: 5, max: 600 }),
    // Primeira tentativa do refresh pós-escrita (o sale_price do ML pode
    // demorar alguns segundos para refletir a escrita).
    snapshotRefreshDelayMs: inteiroEntre(env.MARGIN_PRICING_SNAPSHOT_DELAY_MS, { padrao: 5000, min: 0, max: 120000 }),
    // Backoff exponencial entre tentativas enquanto o ML devolve o preço antigo.
    snapshotBackoffBaseSegundos: inteiroEntre(env.MARGIN_PRICING_SNAPSHOT_BACKOFF_SEGUNDOS, { padrao: 5, min: 1, max: 300 }),
    snapshotBackoffMaxSegundos: inteiroEntre(env.MARGIN_PRICING_SNAPSHOT_BACKOFF_MAX_SEGUNDOS, { padrao: 60, min: 1, max: 1800 }),
    // Janela total: sem o preço confirmado no snapshot até aqui → propagacao_pendente.
    snapshotJanelaMinutos: inteiroEntre(env.MARGIN_PRICING_SNAPSHOT_JANELA_MINUTOS, { padrao: 10, min: 1, max: 240 }),
    // Cache curto da base do Motor usada SÓ pela simulação ao vivo (digitação).
    // Preview e aplicar sempre releem ao vivo.
    simulacaoCacheMs: inteiroEntre(env.MARGIN_PRICING_SIMULACAO_CACHE_MS, { padrao: 30000, min: 0, max: 300000 }),
  };
}

module.exports = { escritaHabilitada, resolvePricingConfig, listaDeSlugs };
