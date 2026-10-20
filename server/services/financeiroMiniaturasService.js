// server/services/financeiroMiniaturasService.js
//
// Foto dos produtos na lista do Financeiro V3 (só Mercado Livre).
// GET /financeiro/:cliente/miniaturas?conta=&itens=MLB1,MLB2,...
//
// Fonte: `meli_anuncios.thumbnail`, gravada pelo sync de Anúncios ML — a
// mesma foto que a tela de Anúncios mostra. Não chama a API do ML: anúncio
// que nunca passou pelo sync simplesmente não volta no mapa (a tela fica com
// a sigla).
//
// Escopo: o cliente da URL (já validado pela carteira) e a conta pedida.
// Linhas antigas sem `cliente_conta_id` (sincronizadas antes da coluna
// existir) também valem — o item_id é único por cliente.

const pool = require("../config/database");

const MAX_ITENS = 100;

function erroHttp(statusCode, code, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

// "MLB123", "mlb-123", "123" → "MLB123". O relatório do ML às vezes traz só
// o número do anúncio.
function normalizarItemId(valor) {
  const limpo = String(valor ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (!limpo) return null;
  if (/^\d+$/.test(limpo)) return `MLB${limpo}`;
  return /^MLB\d+$/.test(limpo) ? limpo : null;
}

// Foto do ML às vezes vem em http:// — o Portal é https.
function emHttps(url) {
  const u = String(url || "").trim();
  if (!u) return null;
  return u.replace(/^http:\/\//i, "https://");
}

async function obterMiniaturas({ clienteSlugRaw, clienteContaIdRaw, itensRaw }, { db = pool } = {}) {
  const clienteSlug = String(clienteSlugRaw || "").trim();
  const clienteContaId = /^\d+$/.test(String(clienteContaIdRaw || "")) ? Number(clienteContaIdRaw) : null;
  if (!clienteSlug) throw erroHttp(400, "CLIENTE_OBRIGATORIO", "Cliente é obrigatório.");
  if (!clienteContaId) throw erroHttp(400, "CONTA_OBRIGATORIA", "A conta (conta=) é obrigatória.");

  const pedidos = String(itensRaw || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (pedidos.length > MAX_ITENS) throw erroHttp(400, "ITENS_DEMAIS", `No máximo ${MAX_ITENS} itens por consulta.`);

  // id normalizado → ids como a tela pediu (a resposta volta na chave da tela)
  const porNormalizado = new Map();
  for (const original of pedidos) {
    const n = normalizarItemId(original);
    if (!n) continue;
    if (!porNormalizado.has(n)) porNormalizado.set(n, []);
    porNormalizado.get(n).push(original);
  }
  if (!porNormalizado.size) return { miniaturas: {} };

  // Ambiente onde Anúncios ML nunca rodou: a tabela não existe (o
  // ensureSchema dela não roda no boot). Sem fotos, não é erro.
  const { rows } = await db.query(
    `SELECT ma.item_id, ma.thumbnail
       FROM meli_anuncios ma
       JOIN clientes c ON c.id = ma.cliente_id
      WHERE c.slug = $1
        AND ma.item_id = ANY($2::text[])
        AND (ma.cliente_conta_id = $3 OR ma.cliente_conta_id IS NULL)
        AND ma.thumbnail IS NOT NULL AND ma.thumbnail <> ''`,
    [clienteSlug, [...porNormalizado.keys()], clienteContaId]
  ).catch((err) => {
    if (err?.code === "42P01") return { rows: [] };
    throw err;
  });

  const miniaturas = {};
  for (const r of rows) {
    const url = emHttps(r.thumbnail);
    for (const original of porNormalizado.get(String(r.item_id).toUpperCase()) || []) miniaturas[original] = url;
  }
  return { miniaturas };
}

module.exports = { obterMiniaturas, normalizarItemId, MAX_ITENS };
