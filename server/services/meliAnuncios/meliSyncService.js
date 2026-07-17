// server/services/meliAnuncios/meliSyncService.js
// -----------------------------------------------------------------------------
// Módulo: Anúncios Meli — sincronização com a API do Mercado Livre.
//
// Estratégia (read-only, não altera nada no Mercado Livre):
//  1. lista os item_ids do vendedor via /users/{userId}/items/search (scan/scroll);
//  2. no modo "novos", descarta os ids que já existem no banco;
//  3. busca os itens em lotes de 20 via multiget /items?ids=...;
//  4. calcula o Score VenForce de cada anúncio;
//  5. faz upsert na tabela meli_anuncios.
//
// A descrição NÃO é buscada aqui (1 request por item é pesado para 1500+
// anúncios). Ela é carregada sob demanda no endpoint de detalhe.
//
// Reaproveita server/utils/mlClient.js (mlFetch) — não mexe em token/refresh.
// -----------------------------------------------------------------------------

const { mlFetch } = require("../../utils/mlClient");
const anunciosService = require("./meliAnunciosService");

// Limites de segurança para não pesar o servidor / a API.
const SCAN_LIMIT = 100; // itens por página do search scan
const MAX_PAGINAS = 120; // 120 * 100 = até 12.000 ids
const LOTE_MULTIGET = 20; // máximo aceito pelo multiget de /items
const MAX_ITENS = 6000; // teto de itens processados por sincronização

// -----------------------------------------------------------------------------
// Score VenForce — nota simples de qualidade (0 a 100).
// Critérios disponíveis sem custo (custo entra numa etapa futura):
//   título (32) · fotos (26) · marca (14) · modelo (14) · ficha técnica (14)
// -----------------------------------------------------------------------------
function calcularScore(item, attrsMap, picturesCount) {
  let pontos = 0;
  const problemas = [];

  const titulo = String(item.title || "").trim();
  if (!titulo) {
    problemas.push("Sem título");
  } else if (titulo.length < 20) {
    pontos += 12;
    problemas.push("Título muito curto");
  } else if (titulo.length > 60) {
    pontos += 22;
    problemas.push("Título acima de 60 caracteres");
  } else {
    pontos += 32;
  }

  if (picturesCount === 0) {
    problemas.push("Sem fotos");
  } else if (picturesCount < 3) {
    pontos += 10;
    problemas.push("Menos de 3 fotos");
  } else if (picturesCount < 6) {
    pontos += 20;
  } else {
    pontos += 26;
  }

  if (attrsMap.BRAND) pontos += 14;
  else problemas.push("Marca não preenchida");

  if (attrsMap.MODEL) pontos += 14;
  else problemas.push("Modelo não preenchido");

  const attrs = Array.isArray(item.attributes) ? item.attributes : [];
  const total = attrs.length;
  const preenchidos = attrs.filter((a) => a && valorAtributo(a)).length;
  const ratio = total ? preenchidos / total : 0;
  pontos += Math.round(14 * ratio);
  if (total && ratio < 0.6) problemas.push("Ficha técnica incompleta");

  return {
    score: Math.max(0, Math.min(100, pontos)),
    motivo: problemas[0] || "Anúncio saudável",
  };
}

function valorAtributo(a) {
  if (!a) return null;
  if (a.value_name) return a.value_name;
  if (Array.isArray(a.values) && a.values[0] && a.values[0].name) {
    return a.values[0].name;
  }
  return null;
}

// -----------------------------------------------------------------------------
// Mapeia o JSON cru de um item do ML para o registro da tabela meli_anuncios.
// -----------------------------------------------------------------------------
function mapearItem(body, clienteId, clienteSlug) {
  const attrs = Array.isArray(body.attributes) ? body.attributes : [];

  const attrsMap = {};
  for (const a of attrs) {
    if (a && a.id) attrsMap[a.id] = valorAtributo(a);
  }

  const pictures = (Array.isArray(body.pictures) ? body.pictures : [])
    .map((p) => p && (p.secure_url || p.url))
    .filter(Boolean);

  const sku = attrsMap.SELLER_SKU || body.seller_custom_field || null;
  const logisticType =
    (body.shipping && body.shipping.logistic_type) || null;

  const { score, motivo } = calcularScore(body, attrsMap, pictures.length);

  return {
    cliente_id: clienteId,
    cliente_slug: clienteSlug,
    item_id: body.id,
    sku,
    titulo: body.title || null,
    marca: attrsMap.BRAND || null,
    modelo: attrsMap.MODEL || null,
    preco: body.price != null ? body.price : null,
    preco_original: body.original_price != null ? body.original_price : null,
    moeda: body.currency_id || null,
    estoque:
      body.available_quantity != null ? body.available_quantity : null,
    vendidos: body.sold_quantity != null ? body.sold_quantity : null,
    status: body.status || null,
    sub_status: Array.isArray(body.sub_status)
      ? body.sub_status.join(",")
      : body.sub_status || null,
    listing_type_id: body.listing_type_id || null,
    category_id: body.category_id || null,
    permalink: body.permalink || null,
    thumbnail: body.secure_thumbnail || body.thumbnail || null,
    pictures_count: pictures.length,
    pictures_json: pictures,
    logistic_type: logisticType,
    is_full: logisticType === "fulfillment",
    attributes_json: attrs.map((a) => ({
      id: a.id,
      name: a.name,
      value: valorAtributo(a),
    })),
    health: typeof body.health === "number" ? body.health : null,
    score_venforce: score,
    score_motivo: motivo,
  };
}

// -----------------------------------------------------------------------------
// Coleta todos os item_ids do vendedor usando o search scan/scroll.
// -----------------------------------------------------------------------------
async function coletarItemIds(clienteId, mlUserId) {
  const ids = [];
  let scrollId = null;
  let pagina = 0;

  do {
    const qs = scrollId
      ? `search_type=scan&limit=${SCAN_LIMIT}&scroll_id=${encodeURIComponent(
          scrollId
        )}`
      : `search_type=scan&limit=${SCAN_LIMIT}`;

    const resp = await mlFetch(
      clienteId,
      `/users/${mlUserId}/items/search?${qs}`
    );

    if (!resp || !resp.ok) {
      return {
        ok: false,
        status: resp && resp.status,
        ids,
      };
    }

    const results =
      (resp.data && Array.isArray(resp.data.results) && resp.data.results) ||
      [];
    ids.push(...results);
    scrollId = resp.data && resp.data.scroll_id;
    pagina++;

    if (results.length === 0) break;
  } while (scrollId && pagina < MAX_PAGINAS);

  return { ok: true, ids };
}

// -----------------------------------------------------------------------------
// Sincronização principal.
// modo: "novos"    -> apenas anúncios ainda não gravados (uso diário, rápido)
//       "completo" -> reprocessa todos os anúncios (manutenção, mais lento)
//
// Retorno padronizado (sempre com `ok`), no mesmo espírito do módulo Ads:
//   { ok:true, codigo:"OK", modo, totalEncontrados, totalProcessados,
//     totalSalvos, limitado }
//   { ok:false, codigo:"NO_TOKEN"|"ML_API_ERROR", motivo }
// -----------------------------------------------------------------------------
async function sincronizar({ clienteId, clienteSlug, modo }) {
  const modoFinal = modo === "completo" ? "completo" : "novos";

  await anunciosService.ensureSchema();

  const mlUserId = await anunciosService.resolverMlUserId(clienteId);
  if (!mlUserId) {
    return {
      ok: false,
      codigo: "NO_TOKEN",
      motivo:
        "Este cliente ainda não tem uma conta do Mercado Livre conectada.",
    };
  }

  // 1. coletar ids
  const coleta = await coletarItemIds(clienteId, mlUserId);
  if (!coleta.ok) {
    return {
      ok: false,
      codigo: "ML_API_ERROR",
      motivo: `Não foi possível listar os anúncios na API do Mercado Livre (HTTP ${
        coleta.status || "?"
      }).`,
    };
  }

  const totalEncontrados = coleta.ids.length;
  let ids = coleta.ids.slice();

  // 2. modo novos -> remove os já existentes
  if (modoFinal === "novos") {
    const existentes = await anunciosService.itemIdsExistentes(clienteId);
    ids = ids.filter((id) => !existentes.has(String(id)));
  }

  if (ids.length === 0) {
    return {
      ok: true,
      codigo: "OK",
      modo: modoFinal,
      totalEncontrados,
      totalProcessados: 0,
      totalSalvos: 0,
      limitado: false,
      mensagem:
        modoFinal === "novos"
          ? "Nenhum anúncio novo encontrado."
          : "Nenhum anúncio retornado pela conta.",
    };
  }

  // teto de segurança
  let limitado = false;
  if (ids.length > MAX_ITENS) {
    ids = ids.slice(0, MAX_ITENS);
    limitado = true;
  }

  // 3. multiget em lotes
  const registros = [];
  for (let i = 0; i < ids.length; i += LOTE_MULTIGET) {
    const lote = ids.slice(i, i + LOTE_MULTIGET);
    const resp = await mlFetch(
      clienteId,
      `/items?ids=${lote.join(",")}`
    );

    if (!resp || !resp.ok || !Array.isArray(resp.data)) {
      // não aborta a sincronização inteira por causa de um lote ruim
      continue;
    }

    for (const entry of resp.data) {
      if (entry && entry.code === 200 && entry.body && entry.body.id) {
        registros.push(mapearItem(entry.body, clienteId, clienteSlug));
      }
    }
  }

  // 4. upsert
  const totalSalvos = await anunciosService.upsertAnuncios(registros);

  return {
    ok: true,
    codigo: "OK",
    modo: modoFinal,
    totalEncontrados,
    totalProcessados: ids.length,
    totalSalvos,
    limitado,
  };
}

module.exports = {
  sincronizar,
  calcularScore,
  mapearItem,
};
