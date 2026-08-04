// server/controllers/basesController.js
// Controllers das rotas de bases (editor rápido de custos).

const { registrarLog, extrairIp, dadosUsuarioDeReq } = require("../services/activityLogService");

const {
  MARKETPLACES_SUPORTADOS,
  normalizarProdutoIdBase,
  normalizarProdutoIdShopee,
  normalizarProdutoIdTikTok,
  obterBaseAtivaPorSlug,
  obterPadraoCustoBase,
  upsertCustoBase,
  validarNumeroObrigatorio,
  validarNumeroOpcional,
} = require("../services/bases/baseCustosService");

// Normalizador de produto_id por marketplace — escolha explícita, sem fallback.
const NORMALIZADORES_PRODUTO_ID = {
  meli: normalizarProdutoIdBase,
  shopee: normalizarProdutoIdShopee,
  tiktok: normalizarProdutoIdTikTok,
};

function responderErroService(res, err) {
  if (err && err.payload && err.statusCode) {
    return res.status(err.statusCode).json(err.payload);
  }
  return res.status(500).json({ ok: false, erro: err?.message || "Erro interno." });
}

async function obterPadraoCustoBaseController(req, res) {
  try {
    const base = await obterBaseAtivaPorSlug(req.params.baseSlug);
    const padrao = await obterPadraoCustoBase(base.id);
    return res.json({
      ok: true,
      base: base.slug,
      padrao: {
        imposto_percentual: padrao.imposto_percentual,
        taxa_fixa: padrao.taxa_fixa,
      },
    });
  } catch (err) {
    return responderErroService(res, err);
  }
}

async function upsertCustoBaseController(req, res) {
  try {
    const base = await obterBaseAtivaPorSlug(req.params.baseSlug);

    const body = req.body || {};
    const produtoIdRaw = body.produto_id;
    if (!produtoIdRaw) {
      return res.status(400).json({ ok: false, erro: "produto_id é obrigatório." });
    }

    const normalizarProdutoId = NORMALIZADORES_PRODUTO_ID[base.marketplace];
    if (!normalizarProdutoId) {
      return res.status(400).json({
        ok: false,
        erro: `marketplace inválido para a base. Use: ${MARKETPLACES_SUPORTADOS.join(", ")}.`,
      });
    }
    const produtoIdNorm = normalizarProdutoId(produtoIdRaw);
    if (!produtoIdNorm) {
      return res.status(400).json({ ok: false, erro: "produto_id inválido." });
    }

    const isTikTok = base.marketplace === "tiktok";
    const custoProduto = validarNumeroObrigatorio(body.custo_produto, "custo_produto");
    const impostoPercentualOpt = validarNumeroOpcional(body.imposto_percentual, "imposto_percentual");
    // TikTok não tem taxa fixa: sempre 0, mesmo que o cliente envie outro valor.
    const taxaFixaOpt = isTikTok
      ? { tem: true, numero: 0 }
      : validarNumeroOpcional(body.taxa_fixa, "taxa_fixa");
    const idModel = base.marketplace === "shopee" ? (body.id_model || null) : null;

    const resultado = await upsertCustoBase({
      baseId: base.id,
      produtoIdNorm,
      custoProduto,
      impostoPercentualOpt,
      taxaFixaOpt,
      idModel,
      produtoNome: body.produto_nome,
      variacaoNome: body.variacao_nome,
      marketplace: base.marketplace,
    });

    try {
      registrarLog({
        ...dadosUsuarioDeReq(req),
        acao: "base.custo.upsert",
        detalhes: {
          base_slug: base.slug,
          produto_id: produtoIdNorm,
          acao: resultado.acao,
          custo_produto: Number(resultado.custo?.custo_produto),
          imposto_percentual: Number(resultado.custo?.imposto_percentual),
          taxa_fixa: Number(resultado.custo?.taxa_fixa),
        },
        ip: extrairIp(req),
        status: "sucesso",
      });
    } catch (_) {
      // falha de log não derruba a rota
    }

    return res.json({
      ok: true,
      acao: resultado.acao,
      marketplace: base.marketplace,
      custo: {
        base_id: resultado.custo.base_id,
        produto_id: resultado.custo.produto_id,
        custo_produto: Number(resultado.custo.custo_produto),
        imposto_percentual: Number(resultado.custo.imposto_percentual),
        taxa_fixa: Number(resultado.custo.taxa_fixa),
        id_model: resultado.custo.id_model ?? null,
        produto_nome: resultado.custo.produto_nome ?? null,
        variacao_nome: resultado.custo.variacao_nome ?? null,
        updated_at: resultado.custo.updated_at ?? null,
      },
    });
  } catch (err) {
    return responderErroService(res, err);
  }
}

module.exports = {
  obterPadraoCustoBaseController,
  upsertCustoBaseController,
};

