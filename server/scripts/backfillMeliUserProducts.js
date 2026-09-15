// server/scripts/backfillMeliUserProducts.js
// -----------------------------------------------------------------------------
// Backfill controlado de meli_user_products / meli_anuncios.user_product_id
// para anúncios que já existiam antes do sync novo (commit 1dc11c7).
//
// Ver docs/PROPOSTA_BACKFILL_MELI_USER_PRODUCTS.md para o plano completo.
//
// Decisões mantidas do plano aprovado:
//   - script isolado, não uma rota HTTP nem lógica dentro de meliSyncService;
//   - sincronizar() não é tocado — este script é um consumidor ao lado dele;
//   - reaproveita mapearItem() e registrarUserProducts() como estão;
//   - NÃO usa upsertAnuncios() — não deve reescrever título/preço/estoque/etc,
//     só a coluna user_product_id, via UPDATE estreito
//     (meliAnunciosService.preencherUserProductId);
//   - os candidatos vêm do próprio banco (item_id já gravado, user_product_id
//     NULL), não de um novo scan /items/search — por isso o script não gasta
//     nenhuma chamada de busca no Mercado Livre, só multiget.
//
// Correção de premissa (auditoria de modelagem): um único user_product_id
// compartilhado por vários item_id (várias MLBs) ainda NÃO foi observado nos
// dados reais. Este script não assume esse cenário como fonte de economia —
// ele só evita refazer trabalho já feito (ver retomarPendentes).
// -----------------------------------------------------------------------------

const { mlFetch } = require("../utils/mlClient");
const anunciosService = require("../services/meliAnuncios/meliAnunciosService");
const meliSyncService = require("../services/meliAnuncios/meliSyncService");
const familiaService = require("../services/meliAnuncios/meliFamiliaService");

// Mesmo valor de meliSyncService.LOTE_MULTIGET (não exportado de lá — é uma
// constante de segurança da API do ML, não algo específico da sincronização,
// por isso é espelhado aqui em vez de importado).
const LOTE_MULTIGET = 20;
const CAMPOS_ID_GRANDE = ["family_id"];

// Pacing mínimo entre lotes/clientes. Não é backoff exponencial nem fila —
// só o suficiente para não martelar a API do ML lote após lote. Quando o
// ML responde 429 com Retry-After, esse valor prevalece sobre o pacing fixo.
const DELAY_LOTE_MS = 300;
const DELAY_CLIENTE_MS = 250;

function aguardar(ms) {
  if (!ms || ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Chama o multiget sem nunca deixar uma exceção (rede, refresh de token)
// escapar — vira o mesmo formato de "resposta ruim" que um 4xx/5xx já usa,
// para que o chamador trate os dois casos de forma idêntica.
async function multigetSeguro(clienteId, lote, mlUserId) {
  try {
    return await mlFetch(clienteId, `/items?ids=${lote.join(",")}`, {
      mlUserId,
      bigIntFields: CAMPOS_ID_GRANDE,
    });
  } catch (error) {
    console.error(JSON.stringify({
      event: "backfill_multiget_falhou",
      cliente_id: clienteId,
      error: error && error.message,
    }));
    return { ok: false, status: null };
  }
}

// -----------------------------------------------------------------------------
// Backfill de 1 cliente.
// -----------------------------------------------------------------------------
async function backfillCliente({
  clienteId,
  clienteSlug,
  dryRun = false,
  delayLoteMs = DELAY_LOTE_MS,
  esperarFn = aguardar,
}) {
  const contexto = await anunciosService.resolverContextoConta({
    clienteId,
    requireUsableGrant: true,
  });
  if (!contexto.mlUserId) {
    return {
      ok: false,
      codigo: "NO_TOKEN",
      clienteId,
      analisados: 0,
      comUserProductId: 0,
      semUserProductId: 0,
      erros: 0,
    };
  }
  const { mlUserId, contaId } = contexto;

  const candidatos = await anunciosService.itemIdsSemUserProduct(clienteId);

  let analisados = 0;
  let comUserProductId = 0;
  let semUserProductId = 0;
  let erros = 0;

  for (let i = 0; i < candidatos.length; i += LOTE_MULTIGET) {
    const lote = candidatos.slice(i, i + LOTE_MULTIGET);
    analisados += lote.length;

    const resp = await multigetSeguro(clienteId, lote, mlUserId);

    if (!resp || !resp.ok || !Array.isArray(resp.data)) {
      // não aborta o cliente por causa de 1 lote ruim — mesmo espírito do
      // passo 3 de meliSyncService.sincronizar(). Em 429, espera o
      // Retry-After (se vier) antes do próximo lote; senão, o pacing normal.
      erros += lote.length;
      const espera = resp && resp.status === 429 && resp.retryAfter
        ? resp.retryAfter * 1000
        : delayLoteMs;
      await esperarFn(espera);
      continue;
    }

    const registros = [];
    for (const entry of resp.data) {
      if (entry && entry.code === 200 && entry.body && entry.body.id) {
        registros.push(
          meliSyncService.mapearItem(entry.body, clienteId, clienteSlug, contaId, mlUserId)
        );
      }
    }

    // ids pedidos que o ML não devolveu (fechado, removido, etc.) também
    // contam como erro — não como "sem user_product_id".
    erros += lote.length - registros.length;

    if (dryRun) {
      for (const registro of registros) {
        if (registro.user_product_id) comUserProductId++;
        else semUserProductId++;
      }
      await esperarFn(delayLoteMs);
      continue;
    }

    // Ordem de persistência: meli_user_products primeiro. Se falhar, NADA
    // deste lote é escrito em meli_anuncios — evita o órfão "anúncio com
    // user_product_id mas sem linha correspondente em meli_user_products",
    // que além disso nunca mais seria reprocessado (sai da lista de
    // candidatos assim que user_product_id deixa de ser NULL).
    try {
      await familiaService.registrarUserProducts(registros);
    } catch (error) {
      console.error(JSON.stringify({
        event: "backfill_user_products_falhou",
        cliente_id: clienteId,
        error: error && error.message,
      }));
      erros += registros.length;
      await esperarFn(delayLoteMs);
      continue;
    }

    for (const registro of registros) {
      if (registro.user_product_id) {
        await anunciosService.preencherUserProductId(
          clienteId,
          registro.item_id,
          registro.user_product_id
        );
        comUserProductId++;
      } else {
        semUserProductId++;
      }
    }

    await esperarFn(delayLoteMs);
  }

  return {
    ok: true,
    clienteId,
    analisados,
    comUserProductId,
    semUserProductId,
    erros,
  };
}

// -----------------------------------------------------------------------------
// Backfill de todos os clientes com candidatos pendentes. Sequencial —
// nunca em paralelo, porque cada cliente pode ter sua própria conta ML com
// seu próprio limite de rate.
// -----------------------------------------------------------------------------
async function listarClientesPendentes() {
  const pool = require("../config/database");
  const { rows } = await pool.query(
    `SELECT DISTINCT cliente_id, cliente_slug
       FROM meli_anuncios
      WHERE user_product_id IS NULL
      ORDER BY cliente_id;`
  );
  return rows.map((r) => ({ clienteId: r.cliente_id, clienteSlug: r.cliente_slug }));
}

async function backfillTodos({
  dryRun = false,
  delayMs = DELAY_CLIENTE_MS,
  delayLoteMs = DELAY_LOTE_MS,
  esperarFn = aguardar,
} = {}) {
  const pendentes = await listarClientesPendentes();
  const resultados = [];

  for (const { clienteId, clienteSlug } of pendentes) {
    console.log(JSON.stringify({ event: "backfill_cliente_iniciado", cliente_id: clienteId }));

    let res;
    try {
      res = await backfillCliente({ clienteId, clienteSlug, dryRun, delayLoteMs, esperarFn });
    } catch (error) {
      // Um cliente com erro estrutural (409 de múltiplas contas ML, token
      // ausente que virou exceção em vez de NO_TOKEN, ou qualquer falha não
      // prevista) não pode travar os clientes seguintes do --all.
      console.error(JSON.stringify({
        event: "backfill_cliente_erro",
        cliente_id: clienteId,
        codigo: error && error.code,
        error: error && error.message,
      }));
      res = {
        ok: false,
        codigo: (error && error.code) || "ERRO_INESPERADO",
        clienteId,
        analisados: 0,
        comUserProductId: 0,
        semUserProductId: 0,
        erros: 0,
      };
    }

    resultados.push(res);
    console.log(JSON.stringify({ event: "backfill_cliente_concluido", ...res }));

    await esperarFn(delayMs);
  }

  imprimirRelatorio(resultados);
  return resultados;
}

function imprimirRelatorio(resultados) {
  const total = resultados.reduce(
    (acc, r) => ({
      analisados: acc.analisados + (r.analisados || 0),
      comUserProductId: acc.comUserProductId + (r.comUserProductId || 0),
      semUserProductId: acc.semUserProductId + (r.semUserProductId || 0),
      erros: acc.erros + (r.erros || 0),
    }),
    { analisados: 0, comUserProductId: 0, semUserProductId: 0, erros: 0 }
  );

  console.log("\ncliente_id\tanalisados\tcom_up\tsem_up\terros");
  for (const r of resultados) {
    console.log(`${r.clienteId}\t${r.analisados}\t${r.comUserProductId}\t${r.semUserProductId}\t${r.erros}`);
  }
  console.log(`TOTAL\t${total.analisados}\t${total.comUserProductId}\t${total.semUserProductId}\t${total.erros}`);
}

// -----------------------------------------------------------------------------
// CLI
// -----------------------------------------------------------------------------
function parseArgs(argv) {
  const args = { clienteId: null, all: false, dryRun: false };
  for (const arg of argv) {
    if (arg === "--all") args.all = true;
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg.startsWith("--cliente_id=")) args.clienteId = Number(arg.split("=")[1]);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.all && !args.clienteId) {
    console.error("Uso: node backfillMeliUserProducts.js --cliente_id=<id> | --all [--dry-run]");
    process.exitCode = 1;
    return;
  }

  if (args.all) {
    await backfillTodos({ dryRun: args.dryRun });
    return;
  }

  // resolverCliente() busca por slug, não por id — para --cliente_id lemos o
  // slug direto da própria meli_anuncios (mesmo padrão de listarClientesPendentes).
  const pool = require("../config/database");
  const { rows } = await pool.query(
    `SELECT DISTINCT cliente_slug FROM meli_anuncios WHERE cliente_id = $1 LIMIT 1;`,
    [args.clienteId]
  );
  const clienteSlug = rows[0] ? rows[0].cliente_slug : null;

  const res = await backfillCliente({ clienteId: args.clienteId, clienteSlug, dryRun: args.dryRun });
  imprimirRelatorio([res]);
}

module.exports = {
  backfillCliente,
  backfillTodos,
  listarClientesPendentes,
  parseArgs,
};

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
