// server/services/bases/baseCustosService.js
// Regras e operações de custos por base (editor rápido).

const path = require("path");
const pool = require("../../config/database");
const { parseSpreadsheet } = require("../../utils/excelUtils");

const CANDIDATOS_ID_MODEL_HEADER = [
  "model id", "model_id", "modelid", "id model", "id_model", "id do modelo",
  "id da variacao", "id da variação", "variation id", "variante identificador",
];

function numeroSeguro(valor) {
  if (valor === null || valor === undefined) return 0;
  let texto = String(valor)
    .trim()
    .replace(/\s/g, "")
    .replace(/R\$/gi, "")
    .replace(/US\$/gi, "")
    .replace(/€/g, "")
    .replace("%", "");
  if (!texto) return 0;
  if (texto.includes(",") && texto.includes(".")) {
    texto = texto.replace(/\./g, "").replace(",", ".");
  } else if (texto.includes(",")) {
    texto = texto.replace(",", ".");
  }
  const n = Number(texto);
  return Number.isFinite(n) ? n : 0;
}

function normalizarImposto(valor) {
  if (typeof valor === "string" && valor.includes("%")) return numeroSeguro(valor) / 100;
  const n = numeroSeguro(valor);
  return n >= 1 ? n / 100 : n;
}

function limparChaveValor(row) {
  const limpo = {};
  for (const [k, v] of Object.entries(row || {})) {
    const cleanKey = String(k || "")
      .trim()
      .replace(/^\uFEFF/, "")
      .replace(/^['"]+|['"]+$/g, "");
    const cleanVal = typeof v === "string" ? v.replace(/^['"]+|['"]+$/g, "") : v;
    limpo[cleanKey] = cleanVal;
  }
  return limpo;
}

function obterValorColuna(row, nomes) {
  for (const nome of nomes) {
    if (row[nome] !== undefined && row[nome] !== null && row[nome] !== "") return row[nome];
  }
  return "";
}

function limparIdModel(valor) {
  let limpo = String(valor == null ? "" : valor).replace(/^\uFEFF/, "").trim();
  if (!limpo) return null;
  limpo = limpo.replace(/^['"]+|['"]+$/g, "").trim();
  if (!limpo) return null;
  if (/^\d+\.0+$/.test(limpo)) limpo = limpo.replace(/\.0+$/, "");
  const sci = limpo.replace(",", ".");
  if (/^\d+(\.\d+)?[eE]\+?\d+$/.test(sci)) {
    const n = Number(sci);
    if (Number.isFinite(n)) return Math.trunc(n).toString();
  }
  return limpo || null;
}

function extrairIdModel(row) {
  for (const [k, v] of Object.entries(row || {})) {
    if (CANDIDATOS_ID_MODEL_HEADER.includes(String(k).trim().toLowerCase())) {
      return limparIdModel(v);
    }
  }
  return null;
}

function normalizarSlug(valor) {
  return String(valor || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizarProdutoIdBase(valor) {
  let limpo = String(valor || "").replace(/^\uFEFF/, "").trim();
  if (!limpo) return "";

  // Remove aspas
  limpo = limpo.replace(/^['"]+|['"]+$/g, "").trim();
  if (!limpo) return "";

  // Excel serializa números como "12345.0"
  if (/^\d+\.0+$/.test(limpo)) limpo = limpo.replace(/\.0+$/, "");

  const upper = limpo.toUpperCase();

  // Se já contém MLB/MLBU num texto maior, extrai o padrão completo
  const match = upper.match(/MLB[U]?\d+/);
  if (match) return match[0];

  // Se for numérico puro, prefixa MLB
  if (/^\d+$/.test(limpo)) return `MLB${limpo}`;

  // Se já vier MLB/MLBU, normaliza para uppercase
  if (/^MLB[U]?\d+$/i.test(limpo)) return upper;

  // Outro formato (SKU customizado, etc): manter texto limpo
  return limpo;
}

function normalizarProdutoIdShopee(valor) {
  let limpo = String(valor || "").replace(/^﻿/, "").trim();
  if (!limpo) return "";
  limpo = limpo.replace(/^['"]+|['"]+$/g, "").trim();
  if (!limpo) return "";
  if (/^\d+\.0+$/.test(limpo)) limpo = limpo.replace(/\.0+$/, "");
  const sci = limpo.replace(",", ".");
  if (/^\d+(\.\d+)?[eE]\+?\d+$/.test(sci)) {
    const n = Number(sci);
    if (Number.isFinite(n)) return Math.trunc(n).toString();
  }
  return limpo;  // sem prefixo MLB
}

function criarHttpErro(statusCode, payload) {
  const err = new Error(payload?.erro || "Erro");
  err.statusCode = statusCode;
  err.payload = payload;
  return err;
}

async function obterBaseAtivaPorSlug(baseSlugRaw) {
  const baseSlug = normalizarSlug(baseSlugRaw);
  if (!baseSlug) {
    throw criarHttpErro(400, { ok: false, erro: "baseSlug inválido." });
  }

  const r = await pool.query(
    "SELECT id, slug, marketplace FROM bases WHERE slug = $1 AND ativo = true",
    [baseSlug]
  );
  if (!r.rows.length) {
    throw criarHttpErro(404, { ok: false, erro: "Base não encontrada." });
  }
  return {
    id: r.rows[0].id,
    slug: r.rows[0].slug,
    marketplace: ["meli", "shopee"].includes(r.rows[0].marketplace) ? r.rows[0].marketplace : "meli",
  };
}

async function obterPadraoCustoBase(baseId) {
  const r = await pool.query(
    `SELECT imposto_percentual, taxa_fixa, COUNT(*) AS total
     FROM custos
     WHERE base_id = $1
     GROUP BY imposto_percentual, taxa_fixa
     ORDER BY total DESC
     LIMIT 1`,
    [baseId]
  );

  if (!r.rows.length) {
    return { imposto_percentual: 0, taxa_fixa: 0 };
  }

  const row = r.rows[0];
  const imposto = row.imposto_percentual != null ? Number(row.imposto_percentual) : 0;
  const taxa = row.taxa_fixa != null ? Number(row.taxa_fixa) : 0;

  return {
    imposto_percentual: Number.isFinite(imposto) ? imposto : 0,
    taxa_fixa: Number.isFinite(taxa) ? taxa : 0,
  };
}

function validarNumeroObrigatorio(valor, nomeCampo) {
  const n = typeof valor === "number" ? valor : Number(valor);
  if (!Number.isFinite(n)) {
    throw criarHttpErro(400, { ok: false, erro: `${nomeCampo} é obrigatório e numérico.` });
  }
  return n;
}

function validarNumeroOpcional(valor, nomeCampo) {
  if (valor === undefined) return { tem: false, numero: null };
  const n = typeof valor === "number" ? valor : Number(valor);
  if (!Number.isFinite(n)) {
    throw criarHttpErro(400, { ok: false, erro: `${nomeCampo} deve ser numérico.` });
  }
  return { tem: true, numero: n };
}

async function upsertCustoBase({ baseId, produtoIdNorm, custoProduto, impostoPercentualOpt, taxaFixaOpt, idModel }) {
  const existente = await pool.query(
    `SELECT base_id, produto_id, custo_produto, imposto_percentual, taxa_fixa, id_model
       FROM custos
      WHERE base_id = $1 AND produto_id = $2
      LIMIT 1`,
    [baseId, produtoIdNorm]
  );

  if (existente.rows.length) {
    const atual = existente.rows[0];
    const impostoFinal = impostoPercentualOpt.tem ? impostoPercentualOpt.numero : Number(atual.imposto_percentual);
    const taxaFinal = taxaFixaOpt.tem ? taxaFixaOpt.numero : Number(atual.taxa_fixa);
    const idModelFinal = idModel !== undefined ? (idModel || null) : (atual.id_model || null);

    const upd = await pool.query(
      `UPDATE custos
          SET custo_produto = $3,
              imposto_percentual = $4,
              taxa_fixa = $5,
              id_model = $6
        WHERE base_id = $1 AND produto_id = $2
        RETURNING base_id, produto_id, custo_produto, imposto_percentual, taxa_fixa, id_model`,
      [baseId, produtoIdNorm, custoProduto, impostoFinal, taxaFinal, idModelFinal]
    );

    return { acao: "atualizado", custo: upd.rows[0] };
  }

  const padrao = await obterPadraoCustoBase(baseId);
  const impostoFinal = impostoPercentualOpt.tem ? impostoPercentualOpt.numero : padrao.imposto_percentual;
  const taxaFinal = taxaFixaOpt.tem ? taxaFixaOpt.numero : padrao.taxa_fixa;

  const ins = await pool.query(
    `INSERT INTO custos (base_id, produto_id, custo_produto, imposto_percentual, taxa_fixa, id_model)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING base_id, produto_id, custo_produto, imposto_percentual, taxa_fixa, id_model`,
    [baseId, produtoIdNorm, custoProduto, impostoFinal, taxaFinal, idModel || null]
  );

  return { acao: "criado", custo: ins.rows[0] };
}

function validarExtensaoPlanilha(originalname) {
  const ext = path.extname(String(originalname || "")).toLowerCase();
  if (![".xlsx", ".xls", ".csv"].includes(ext)) {
    throw criarHttpErro(400, { ok: false, erro: "Formato inválido. Envie .xlsx, .xls ou .csv." });
  }
}

function montarLinhaIncremental(rowRaw, marketplace, numeroLinha) {
  const row = limparChaveValor(rowRaw);
  const idRaw = String(obterValorColuna(row, ["id", "ID", "Id", "sku", "SKU", "Sku", "mlb", "MLB", "Mlb"])).trim();
  if (!idRaw) {
    return {
      ignorada: true,
      erro: { linha: numeroLinha, motivo: "produto_id ausente." },
    };
  }

  const normalizarProdutoId = marketplace === "shopee"
    ? normalizarProdutoIdShopee
    : normalizarProdutoIdBase;
  const produtoIdNorm = normalizarProdutoId(idRaw);
  if (!produtoIdNorm) {
    return {
      ignorada: true,
      erro: { linha: numeroLinha, motivo: "produto_id inválido." },
    };
  }

  return {
    ignorada: false,
    linha: {
      produto_id: produtoIdNorm,
      custo_produto: numeroSeguro(obterValorColuna(row, ["Custo", "custo_produto", "CUSTO_PRODUTO", "custo", "CUSTO", "Custo Produto"])),
      imposto_percentual: normalizarImposto(obterValorColuna(row, ["Imposto", "imposto_percentual", "IMPOSTO_PERCENTUAL", "imposto", "IMPOSTO", "Imposto Percentual"])),
      taxa_fixa: numeroSeguro(obterValorColuna(row, ["Taxa", "taxa_fixa", "TAXA_FIXA", "taxa", "TAXA", "Taxa Fixa"])),
      id_model: marketplace === "shopee" ? extrairIdModel(row) : null,
    },
  };
}

async function importarBaseIncremental({ baseSlugRaw, buffer, originalname }) {
  validarExtensaoPlanilha(originalname);
  if (!buffer) {
    throw criarHttpErro(400, { ok: false, erro: "Arquivo não enviado." });
  }

  const base = await obterBaseAtivaPorSlug(baseSlugRaw);

  let rows = [];
  try {
    rows = parseSpreadsheet(buffer, 0);
  } catch (err) {
    throw criarHttpErro(400, { ok: false, erro: err?.message || "Não foi possível ler a planilha." });
  }

  if (!Array.isArray(rows) || !rows.length) {
    throw criarHttpErro(400, { ok: false, erro: "A planilha está vazia." });
  }

  const linhas = [];
  let ignorados = 0;
  let erros = 0;
  const amostraErros = [];

  rows.forEach((row, index) => {
    const mapped = montarLinhaIncremental(row, base.marketplace, index + 2);
    if (mapped.ignorada) {
      ignorados += 1;
      erros += 1;
      if (amostraErros.length < 10 && mapped.erro) amostraErros.push(mapped.erro);
      return;
    }
    linhas.push(mapped.linha);
  });

  let adicionados = 0;
  let atualizados = 0;

  if (linhas.length) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const existentesResult = await client.query(
        "SELECT produto_id FROM custos WHERE base_id = $1",
        [base.id]
      );
      const existentes = new Set(existentesResult.rows.map((row) => String(row.produto_id)));

      for (const linha of linhas) {
        const jaExiste = existentes.has(linha.produto_id);
        await client.query(
          `INSERT INTO custos (base_id, produto_id, custo_produto, imposto_percentual, taxa_fixa, id_model)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (base_id, produto_id)
           DO UPDATE SET
             custo_produto = EXCLUDED.custo_produto,
             imposto_percentual = EXCLUDED.imposto_percentual,
             taxa_fixa = EXCLUDED.taxa_fixa,
             id_model = EXCLUDED.id_model`,
          [
            base.id,
            linha.produto_id,
            linha.custo_produto,
            linha.imposto_percentual,
            linha.taxa_fixa,
            linha.id_model,
          ]
        );

        if (jaExiste) {
          atualizados += 1;
        } else {
          adicionados += 1;
          existentes.add(linha.produto_id);
        }
      }

      await client.query("UPDATE bases SET updated_at = CURRENT_TIMESTAMP WHERE id = $1", [base.id]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  return {
    base: base.slug,
    marketplace: base.marketplace,
    total_linhas: rows.length,
    adicionados,
    atualizados,
    ignorados,
    erros,
    amostra_erros: amostraErros,
  };
}

module.exports = {
  importarBaseIncremental,
  normalizarProdutoIdBase,
  normalizarProdutoIdShopee,
  obterBaseAtivaPorSlug,
  obterPadraoCustoBase,
  upsertCustoBase,
  validarNumeroObrigatorio,
  validarNumeroOpcional,
  criarHttpErro,
};
