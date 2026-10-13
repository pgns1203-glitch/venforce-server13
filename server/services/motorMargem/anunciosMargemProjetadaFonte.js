// server/services/motorMargem/anunciosMargemProjetadaFonte.js
// -----------------------------------------------------------------------------
// Fonte da margem PROJETADA exibida/ordenada em Anúncios ML — passo 3 de
// docs/PLANO_FONTE_CANONICA_MARGEM.md (Margin Snapshot como fonte canônica).
//
// Ordem de leitura, por item:
//   1. `margin_projection_snapshots` (Margin Snapshot, pipeline A) — a mesma
//      tabela da Central de Margem, atualizada pelo worker (refresh manual,
//      pós-sync da Central de Vendas, mudança de Base). Status gravado é o da
//      margem PROJETADA (worker roda o Motor sem vendas), alinhado com o
//      rótulo "Margem Projetada" da coluna (passo 2 do plano).
//   2. `anuncios_margem_projetada_snapshot` (pipeline B, legado) — só para os
//      itens que ainda não têm linha em A. A data de cálculo vai junto, então
//      um valor antigo do legado nunca se passa por recente.
//
// Somente leitura, nenhuma chamada ao ML, nenhum recálculo: devolve o MESMO
// formato de `margemProjetadaSnapshotRepository.lerSnapshotPorItens`
// (Map item_id -> {marginPercent, profit, computable, status, calculadoEm,
// origemJob}), então ranking e célula do controller não mudam.
//
// Escopo de conta: com `clienteContaId` resolvido, A é filtrada pela conta
// (chave canônica). Sem conta (cliente legado/auto-resolvido), filtra só por
// cliente_id — mesmo escopo que o legado sempre usou; quem chama já resolveu
// `itemIds` contra o catálogo da conta certa. `item_id` (MLB) é único por
// vendedor, então duas contas não disputam a mesma linha; o DISTINCT ON é só
// defesa e fica com o cálculo mais recente.
//
// Rollback sem deploy: ANUNCIOS_MARGEM_FONTE=legado volta a ler só a tabela
// antiga. Falha ao ler A (ex.: schema do Margin Snapshot ausente porque o
// worker nunca foi ligado nesta instância) também cai no legado, nunca 500.
// -----------------------------------------------------------------------------

const pool = require("../../config/database");
const legado = require("./margemProjetadaSnapshotRepository");

const MARKETPLACE = "meli";
// Valor de `origemJob` para linhas vindas de A — distingue no payload a
// fonte canônica de "manual_cli"/"orquestrador_manual" (legado).
const ORIGEM_MARGIN_SNAPSHOT = "margin_snapshot";

function fonteConfigurada(env = process.env) {
  return String(env.ANUNCIOS_MARGEM_FONTE ?? "").trim().toLowerCase() === "legado" ? "legado" : "snapshot";
}

async function lerMarginSnapshotPorItens({ clienteId, clienteContaId = null, itemIds }, db = pool) {
  const ids = Array.from(new Set((itemIds || []).map(String).filter(Boolean)));
  if (!ids.length) return new Map();

  const params = [clienteId, MARKETPLACE, ids];
  let filtroConta = "";
  if (clienteContaId != null) {
    params.push(clienteContaId);
    filtroConta = " AND cliente_conta_id = $4";
  }

  const { rows } = await db.query(
    `-- LER_MARGIN_SNAPSHOT_PARA_ANUNCIOS
     SELECT DISTINCT ON (item_id) item_id, margin_percent, profit, status, calculated_at
       FROM margin_projection_snapshots
      WHERE cliente_id = $1
        AND marketplace = $2
        AND item_id = ANY($3::text[])${filtroConta}
      ORDER BY item_id, calculated_at DESC`,
    params
  );

  const porItem = new Map();
  for (const r of rows) {
    const marginPercent = r.margin_percent != null ? Number(r.margin_percent) : null;
    porItem.set(r.item_id, {
      marginPercent,
      profit: r.profit != null ? Number(r.profit) : null,
      // O Motor só zera margin quando a projetada não é computável
      // (marginEngine.computeMargin) — A não tem coluna `computable` própria.
      computable: marginPercent != null,
      status: r.status || null,
      calculadoEm: r.calculated_at || null,
      origemJob: ORIGEM_MARGIN_SNAPSHOT,
    });
  }
  return porItem;
}

async function lerMargemProjetadaPorItens({ clienteId, clienteContaId = null, itemIds }, depsOverride = {}) {
  const deps = {
    env: process.env,
    db: pool,
    lerMarginSnapshot: lerMarginSnapshotPorItens,
    lerLegado: legado.lerSnapshotPorItens,
    logger: console,
    ...depsOverride,
  };
  const ids = Array.from(new Set((itemIds || []).map(String).filter(Boolean)));
  if (!ids.length) return new Map();

  if (fonteConfigurada(deps.env) === "legado") {
    return deps.lerLegado({ clienteId, itemIds: ids });
  }

  let canonico = new Map();
  try {
    canonico = await deps.lerMarginSnapshot({ clienteId, clienteContaId, itemIds: ids }, deps.db);
  } catch (err) {
    deps.logger.error(
      "[anuncios-meli] margem projetada: erro ao ler margin_projection_snapshots, usando só o legado:",
      err.message
    );
  }

  const faltantes = ids.filter((id) => !canonico.has(id));
  if (!faltantes.length) return canonico;

  // Erro no legado propaga (mesmo contrato de antes): o chamador já trata
  // falha de leitura com fallback próprio (campos ausentes / ordem padrão).
  const doLegado = await deps.lerLegado({ clienteId, itemIds: faltantes });
  const resultado = new Map(canonico);
  for (const [itemId, valor] of doLegado) {
    if (!resultado.has(itemId)) resultado.set(itemId, valor);
  }
  return resultado;
}

module.exports = {
  lerMargemProjetadaPorItens,
  lerMarginSnapshotPorItens,
  fonteConfigurada,
  ORIGEM_MARGIN_SNAPSHOT,
};
