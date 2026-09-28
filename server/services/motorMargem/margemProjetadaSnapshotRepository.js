// server/services/motorMargem/margemProjetadaSnapshotRepository.js
// -----------------------------------------------------------------------------
// FASE 2B do plano de margem projetada global — ver
// docs/AUDITORIA_ANUNCIOS_ML_MARGEM_PROJETADA_FASE2_JOB_MANUAL.md. Escrita em
// `anuncios_margem_projetada_snapshot` (tabela criada no commit 876749e).
//
// SOMENTE PERSISTÊNCIA. Não calcula margem, não decide preço/comissão/frete/
// custo — só grava o que `item.margin.projected`/`item.pricing`/
// `item.quality` do Motor de Margem já trouxe pronto. `valorEvidencia` é o
// MESMO helper trivial já usado em `meliAnunciosController.js` para expor
// `precoAtual`/`precoOriginal` no endpoint `/performance` — não uma leitura
// nova, é o mesmo desembrulho de `{value, source, quality, observedAt}`.
//
// UPSERT usa a UNIQUE (cliente_id, item_id) já existente (sem
// `cliente_conta_id` na chave — decisão do commit 876749e, ver comentário na
// migration 20260925_anuncios_margem_projetada_snapshot.sql). `xmax = 0` no
// RETURNING é o truque padrão do Postgres para saber se a linha foi
// inserida ou atualizada dentro do MESMO INSERT ... ON CONFLICT, sem SELECT
// extra.
// -----------------------------------------------------------------------------

const pool = require("../../config/database");

// Mesmo formato/uso de `valorEvidencia` em meliAnunciosController.js:629-635 —
// desembrulha `{value, source, quality, observedAt}` (ou `null`) para o valor
// cru. Não recalcula nada, só lê `.value`.
function valorEvidencia(entrada) {
  return entrada && entrada.value != null ? entrada.value : null;
}

/**
 * Upsert de UMA linha do snapshot, a partir de um item JÁ MONTADO pelo Motor
 * (`buildMarginItem`, via `motorMargemService.carregarWorkspace`).
 *
 * @param {object} params
 *  - clienteId        cliente_id resolvido (workspace.cliente.id)
 *  - clienteContaId    cliente_conta_id EFETIVAMENTE resolvida pelo Motor
 *                       (workspace.clienteContaId — auto-resolvida ou a
 *                       pedida via --clienteConta, tanto faz; só `null` no
 *                       modo legado, cliente sem cliente_contas cadastrada).
 *                       Nenhuma resolução de conta acontece neste repository.
 *  - itemId           item.identity.itemId
 *  - item             item completo do Motor (`buildMarginItem`)
 *  - origemJob        string estável identificando quem escreveu (ex.: "manual_cli")
 * @param {object} db   pool injetável (teste)
 * @returns {{inserted: boolean}} inserted=true → linha nova; false → linha atualizada
 */
async function upsertSnapshot({ clienteId, clienteContaId, itemId, item, origemJob }, db = pool) {
  const projetado = item.margin.projected;
  const precoAtual = valorEvidencia(item.pricing && item.pricing.current);
  const precoOriginal = valorEvidencia(item.pricing && item.pricing.list);
  const status = (item.quality && item.quality.status) || null;
  const faltantesJson = JSON.stringify(projetado.missing || []);

  const { rows } = await db.query(
    `INSERT INTO anuncios_margem_projetada_snapshot
       (cliente_id, cliente_conta_id, item_id, margin_percent, profit, computable,
        status, preco_atual, preco_original, faltantes_json, calculado_em, origem_job)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, NOW(), $11)
     ON CONFLICT (cliente_id, item_id) DO UPDATE SET
       cliente_conta_id = EXCLUDED.cliente_conta_id,
       margin_percent   = EXCLUDED.margin_percent,
       profit           = EXCLUDED.profit,
       computable       = EXCLUDED.computable,
       status           = EXCLUDED.status,
       preco_atual      = EXCLUDED.preco_atual,
       preco_original   = EXCLUDED.preco_original,
       faltantes_json   = EXCLUDED.faltantes_json,
       calculado_em     = NOW(),
       origem_job       = EXCLUDED.origem_job
     RETURNING (xmax = 0) AS inserted`,
    [
      clienteId,
      clienteContaId,
      itemId,
      projetado.marginPercent,
      projetado.profit,
      projetado.computable,
      status,
      precoAtual,
      precoOriginal,
      faltantesJson,
      origemJob,
    ]
  );

  return { inserted: rows[0].inserted === true };
}

/**
 * Leitura em lote do snapshot para um conjunto de item_id, escopado por
 * cliente_id — usada pela ordenação GLOBAL por margem projetada
 * (`meliAnunciosController.listarAgrupadoOrdenadoPorMotor`). NÃO filtra por
 * `cliente_conta_id`: a autoridade de account-scope é `meli_anuncios` (ver
 * comentário de `meliFamiliaService.js` sobre `clausulaConta`) — quem chama
 * já resolveu `itemIds` contra o catálogo da conta certa antes de pedir aqui,
 * então um item_id de outra conta nunca aparece no array de entrada.
 *
 * Devolve `Map(item_id -> {marginPercent, profit, computable, status,
 * calculadoEm, origemJob})`. Item sem linha no snapshot simplesmente não
 * entra no Map (o chamador decide o que fazer com "ausente" — nunca 0/false
 * inventado aqui).
 */
async function lerSnapshotPorItens({ clienteId, itemIds }, db = pool) {
  const ids = Array.from(new Set((itemIds || []).map(String).filter(Boolean)));
  if (!ids.length) return new Map();

  const { rows } = await db.query(
    `-- LER_SNAPSHOT_MARGEM_PROJETADA_POR_ITENS
     SELECT item_id, margin_percent, profit, computable, status, calculado_em, origem_job
       FROM anuncios_margem_projetada_snapshot
      WHERE cliente_id = $1
        AND item_id = ANY($2::text[]);`,
    [clienteId, ids]
  );

  const porItem = new Map();
  for (const r of rows) {
    porItem.set(r.item_id, {
      marginPercent: r.margin_percent != null ? Number(r.margin_percent) : null,
      profit: r.profit != null ? Number(r.profit) : null,
      computable: r.computable === true,
      status: r.status || null,
      calculadoEm: r.calculado_em || null,
      origemJob: r.origem_job || null,
    });
  }
  return porItem;
}

module.exports = { upsertSnapshot, valorEvidencia, lerSnapshotPorItens };
