// server/services/meliAnuncios/meliCustosLoteService.js
// -----------------------------------------------------------------------------
// Custo do produto editado DIRETO na lista de Anúncios ML (edição pontual e
// modo "Editar custos" em massa) — grava na Base de Custos do cliente, a mesma
// que alimenta Motor de Margem, Precificação, Financeiro e Simulação.
//
// Regras:
//  - a Base é resolvida NO SERVIDOR pelo mesmo contexto do Motor
//    (contextoPrecificacaoService.exigirContextoPronto: cliente + conta ML;
//    base da conta ou vínculo legado, nunca a de outra conta). O frontend
//    nunca informa slug de base;
//  - só MLB do próprio cliente/conta (snapshot meli_anuncios) — nunca variação;
//  - a gravação é o upsert de sempre (upsertCustoBase): só o custo muda;
//    imposto/taxa fixa ficam como estão (ou o padrão da Base, em linha nova);
//  - resultado POR ITEM: uma falha nunca derruba os demais;
//  - `remover` existe só para o "Desfazer" de um custo recém-criado pela
//    lista (a Base não guarda histórico, ver docs do plano).
// -----------------------------------------------------------------------------

const pool = require("../../config/database");
const contextoPrecificacao = require("../automacoes/contextoPrecificacaoService");
const { upsertCustoBase } = require("../bases/baseCustosService");

const MAX_ITENS_LOTE = 100;
const CUSTO_MAXIMO = 1e9;

function criarErroHttp(statusCode, payload) {
  const err = new Error(payload?.motivo || "Erro");
  err.statusCode = statusCode;
  err.payload = payload;
  return err;
}

function normalizarItemId(valor) {
  const s = String(valor == null ? "" : valor).trim().toUpperCase();
  return /^MLB\d+$/.test(s) ? s : "";
}

// Variantes de chave que uma Base pode ter para o mesmo MLB (linha legada
// sem prefixo) — a mesma tolerância do índice do Motor
// (baseCustosEvidenceAdapter.lookupCost). Usar a chave JÁ gravada evita
// criar uma segunda linha para o mesmo anúncio.
function variantesChave(itemId) {
  const numero = itemId.replace(/^MLB/, "");
  return [itemId, numero];
}

function arredondarCentavos(n) {
  return Math.round(n * 100) / 100;
}

// Valida o formato do pedido. Erro de estrutura = 400 no pedido inteiro;
// valor ruim em UM item = falha só daquele item.
function validarPedido(body) {
  const itens = body && body.itens;
  if (!Array.isArray(itens) || !itens.length) {
    throw criarErroHttp(400, { ok: false, codigo: "ITENS_OBRIGATORIOS", motivo: "Informe ao menos um anúncio." });
  }
  if (itens.length > MAX_ITENS_LOTE) {
    throw criarErroHttp(400, {
      ok: false,
      codigo: "LOTE_GRANDE",
      motivo: `Envie no máximo ${MAX_ITENS_LOTE} custos por vez.`,
    });
  }

  const vistos = new Set();
  return itens.map((bruto) => {
    const itemId = normalizarItemId(bruto && bruto.itemId);
    if (!itemId) {
      return { itemId: String((bruto && bruto.itemId) || ""), erro: { codigo: "ITEM_INVALIDO", motivo: "Anúncio inválido: use o código MLB." } };
    }
    if (vistos.has(itemId)) {
      return { itemId, erro: { codigo: "ITEM_DUPLICADO", motivo: "Anúncio repetido no mesmo envio." } };
    }
    vistos.add(itemId);

    if (bruto.remover === true) return { itemId, remover: true };

    const n = typeof bruto.custo === "number" ? bruto.custo : Number(bruto.custo);
    if (!Number.isFinite(n) || n <= 0 || n > CUSTO_MAXIMO) {
      return { itemId, erro: { codigo: "CUSTO_INVALIDO", motivo: "Use um custo maior que zero, ex.: 42,90." } };
    }
    return { itemId, custo: arredondarCentavos(n) };
  });
}

async function carregarAnuncios(db, clienteId, itemIds) {
  if (!itemIds.length) return new Map();
  const { rows } = await db.query(
    `SELECT item_id, ml_user_id, titulo FROM meli_anuncios WHERE cliente_id = $1 AND item_id = ANY($2::text[])`,
    [clienteId, itemIds]
  );
  return new Map(rows.map((r) => [String(r.item_id).toUpperCase(), r]));
}

async function carregarCustosAtuais(db, baseId, itemIds) {
  const chaves = itemIds.flatMap(variantesChave);
  if (!chaves.length) return new Map();
  const { rows } = await db.query(
    `SELECT produto_id, custo_produto FROM custos WHERE base_id = $1 AND sku_id = '' AND produto_id = ANY($2::text[])`,
    [baseId, chaves]
  );
  const porItem = new Map();
  for (const r of rows) {
    const chave = String(r.produto_id).trim().toUpperCase();
    const itemId = /^MLB/.test(chave) ? chave : `MLB${chave}`;
    // Linha com prefixo (o formato canônico) ganha da legada sem prefixo.
    if (porItem.has(itemId) && !/^MLB/.test(chave)) continue;
    porItem.set(itemId, { chave: r.produto_id, custo: r.custo_produto == null ? null : Number(r.custo_produto) });
  }
  return porItem;
}

async function removerCusto(db, baseId, chave) {
  const r = await db.query(
    `DELETE FROM custos WHERE base_id = $1 AND produto_id = $2 AND sku_id = '' RETURNING produto_id`,
    [baseId, chave]
  );
  if (r.rowCount) {
    await db.query(`UPDATE bases SET updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [baseId]);
  }
  return r.rowCount > 0;
}

/**
 * Grava (ou remove, no Desfazer) custos de vários MLB na Base resolvida pelo
 * contexto do Motor.
 *
 * @returns {Promise<{ base, resultados: Array, salvos: number, falhas: number }>}
 */
async function salvarCustosEmLote({ clienteSlug, clienteContaId = null, body }, deps = {}) {
  const db = deps.db || pool;
  const exigirContexto = deps.exigirContextoPronto || contextoPrecificacao.exigirContextoPronto;
  const upsert = deps.upsertCustoBase || upsertCustoBase;

  const pedidos = validarPedido(body);

  // Erros de contexto (Base não vinculada, várias Bases, sem grant, conta de
  // outro cliente) propagam com statusCode/payload do próprio serviço.
  const contexto = await exigirContexto({ clienteSlugRaw: clienteSlug, clienteContaId });
  const { base, cliente } = contexto;
  const mlUserId = contexto.mlUserId != null ? String(contexto.mlUserId) : null;

  const validos = pedidos.filter((p) => !p.erro).map((p) => p.itemId);
  const anuncios = await carregarAnuncios(db, cliente.id, validos);
  const atuais = await carregarCustosAtuais(db, base.id, validos);

  const resultados = [];
  for (const p of pedidos) {
    if (p.erro) {
      resultados.push({ itemId: p.itemId, ok: false, ...p.erro });
      continue;
    }

    const anuncio = anuncios.get(p.itemId);
    if (!anuncio) {
      resultados.push({
        itemId: p.itemId, ok: false, codigo: "ANUNCIO_NAO_ENCONTRADO",
        motivo: "Anúncio não encontrado neste cliente. Sincronize os anúncios.",
      });
      continue;
    }
    if (mlUserId && anuncio.ml_user_id != null && String(anuncio.ml_user_id) !== mlUserId) {
      resultados.push({
        itemId: p.itemId, ok: false, codigo: "ANUNCIO_DE_OUTRA_CONTA",
        motivo: "Este anúncio pertence a outra conta do Mercado Livre.",
      });
      continue;
    }

    const atual = atuais.get(p.itemId) || null;
    const custoAnterior = atual ? atual.custo : null;

    try {
      if (p.remover) {
        const removido = atual ? await removerCusto(db, base.id, atual.chave) : false;
        resultados.push({ itemId: p.itemId, ok: true, acao: removido ? "removido" : "inalterado", custoAnterior, custo: null });
        continue;
      }

      const r = await upsert({
        baseId: base.id,
        produtoIdNorm: atual ? atual.chave : p.itemId,
        custoProduto: p.custo,
        impostoPercentualOpt: { tem: false, numero: null },
        taxaFixaOpt: { tem: false, numero: null },
        produtoNome: anuncio.titulo,
        marketplace: "meli",
      });
      resultados.push({
        itemId: p.itemId,
        ok: true,
        acao: r.acao,
        custoAnterior,
        custo: Number(r.custo && r.custo.custo_produto),
      });
    } catch (err) {
      console.error(`[anuncios-meli] custos/lote: falha ao gravar ${p.itemId}:`, err.message);
      resultados.push({
        itemId: p.itemId, ok: false, codigo: "FALHA_GRAVACAO",
        motivo: "Não foi salvo: a Base recusou a gravação. Tente de novo.",
      });
    }
  }

  const salvos = resultados.filter((r) => r.ok && r.acao !== "inalterado").length;
  return {
    base: { id: base.id, slug: base.slug, nome: base.nome },
    resultados,
    salvos,
    falhas: resultados.filter((r) => !r.ok).length,
  };
}

/**
 * Custos atuais da Base para os MLB de uma página da lista. Usa o MESMO
 * contexto do Motor sem lançar erro de negócio: Base ausente/ambígua vira
 * `base: null` + motivo, e a lista mostra "Vincular base" em vez de "+ Custo".
 *
 * @returns {Promise<{ base, motivo, mensagem, custos: Object<string, number|null> }>}
 */
async function lerCustosDosItens({ clienteSlug, clienteContaId = null, itemIds }, deps = {}) {
  const db = deps.db || pool;
  const resolverContexto = deps.resolverContextoPrecificacao || contextoPrecificacao.resolverContextoPrecificacao;

  const ids = Array.from(new Set((itemIds || []).map(normalizarItemId).filter(Boolean))).slice(0, MAX_ITENS_LOTE);
  const contexto = await resolverContexto({ clienteSlugRaw: clienteSlug, clienteContaId });
  if (!contexto.pronto || !contexto.base) {
    return { base: null, motivo: contexto.motivo, mensagem: contexto.mensagem, custos: {} };
  }

  const atuais = await carregarCustosAtuais(db, contexto.base.id, ids);
  const custos = {};
  for (const id of ids) {
    const atual = atuais.get(id);
    custos[id] = atual && atual.custo != null ? atual.custo : null;
  }
  return {
    base: { slug: contexto.base.slug, nome: contexto.base.nome },
    motivo: contexto.motivo,
    mensagem: null,
    custos,
  };
}

module.exports = {
  MAX_ITENS_LOTE,
  salvarCustosEmLote,
  lerCustosDosItens,
  // exportados para teste
  validarPedido,
  normalizarItemId,
};
