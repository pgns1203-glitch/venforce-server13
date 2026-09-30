// server/services/motorMargem/precificacao/precificacaoSnapshotItem.js
// Pós-escrita: recalcula o Margin Snapshot de UM anúncio (não o catálogo).
//
// Mesmo caminho do worker, com escopo de 1 item:
//   prepareWorkspaceContext SEM vendas (snapshot = projeção pura, decisão 2
//   do processor) → enrichBatch({ itemIds: [item] }) → mapItemParaSnapshot →
//   upsertProjectionSnapshot. As chamadas ao ML passam pelo rate limiter do
//   PROCESSO (o mesmo dos runs), e um refresh do mesmo (conta, item) já em
//   voo é reaproveitado (single-flight) — nunca duas leituras simultâneas.
// run_id fica NULL (a coluna é nullable): não é um run de catálogo.
//
// PROVA DE PROPAGAÇÃO: com `precoEsperado` (o preço CONFIRMADO pelo ML na
// escrita), o snapshot só é gravado se a leitura ao vivo já devolver esse
// preço. Enquanto o ML ainda devolve o antigo, NADA é gravado e a resposta é
// { ok:false, motivo:'PRECO_NAO_PROPAGADO', preco } — quem chama agenda nova
// tentativa (fila durável em margem_precificacao_aplicacoes).

const TOLERANCIA_PRECO = 0.005;

const processor = require("../marginSnapshotProcessor");
const { resolveMarginSnapshotConfig } = require("../marginSnapshotConfig");
const { obterLimiterDoProcesso } = require("../marginSnapshotRateLimiter");

const emVoo = new Map();

function defaults(deps = {}) {
  const motor = deps.motor || require("../motorMargemService");
  return {
    prepareWorkspaceContext: deps.prepareWorkspaceContext || motor.prepareWorkspaceContext,
    enrichBatch: deps.enrichBatch || motor.enrichBatch,
    upsertProjectionSnapshot:
      deps.upsertProjectionSnapshot || require("../marginSnapshotRepository").upsertProjectionSnapshot,
    limiter: deps.limiter || obterLimiterDoProcesso(resolveMarginSnapshotConfig(deps.env)),
  };
}

async function executar({ clienteSlug, clienteId, clienteContaId, itemId, precoEsperado = null }, deps) {
  const d = defaults(deps);
  await d.limiter.aguardarVez(null);
  const prepared = await d.prepareWorkspaceContext(
    { clienteSlug, clienteContaId },
    { ...deps, carregarVendas: processor.carregarVendasVazias, agregarPorMlb: processor.agregadoVazio }
  );
  await d.limiter.aguardarVez(null);
  const resultado = await d.enrichBatch(prepared, { itemIds: [itemId] }, deps);
  const item = ((resultado && resultado.itens) || []).find((it) => it && it.identity && String(it.identity.itemId) === String(itemId));
  if (!item) return { ok: false, motivo: "ITEM_NAO_RETORNADO" };
  const dados = processor.mapItemParaSnapshot({
    item,
    run: { id: null, clienteId, clienteContaId, marketplace: "meli" },
    base: prepared.base,
    observedAt: prepared.now ? new Date(prepared.now).toISOString() : null,
  });
  if (precoEsperado !== null && precoEsperado !== undefined) {
    const lido = dados.price === null || dados.price === undefined ? null : Number(dados.price);
    if (lido === null || !Number.isFinite(lido) || Math.abs(lido - Number(precoEsperado)) >= TOLERANCIA_PRECO) {
      return { ok: false, motivo: "PRECO_NAO_PROPAGADO", preco: Number.isFinite(lido) ? lido : null };
    }
  }
  await d.upsertProjectionSnapshot(dados, deps.db);
  return { ok: true, preco: dados.price, margem: dados.margin, status: dados.status };
}

/** Recalcula o snapshot do item; chamadas concorrentes do mesmo item compartilham a mesma promessa. */
function atualizarSnapshotDoItem(params, deps = {}) {
  const chave = `${params.clienteContaId}::${params.itemId}`;
  if (emVoo.has(chave)) return emVoo.get(chave);
  const promessa = executar(params, deps).finally(() => emVoo.delete(chave));
  emVoo.set(chave, promessa);
  return promessa;
}

module.exports = { atualizarSnapshotDoItem };
