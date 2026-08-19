// server/services/bases/baseImportService.js
//
// Comando único de criação de base ("Importar nova base"). Corrige dois
// achados P0 da auditoria pós-Fundação Cliente/Contas:
//
//  1. POST /importar-base tratava colisão de slug como UPDATE + apagava
//     todos os custos existentes (`ON CONFLICT (slug) DO UPDATE` seguido de
//     `DELETE FROM custos`). "Criar nova base" nunca pode sobrescrever uma
//     base existente — colisão de slug agora é sempre 409
//     BASE_SLUG_ALREADY_EXISTS, sem tocar em nada.
//  2. Base, custos e vínculo eram três operações independentes: a UI
//     confirmava sucesso antes do vínculo, que era `best effort` e engolia
//     erro. Aqui as três (mais o vínculo, quando aplicável) rodam na MESMA
//     transação: se o vínculo falhar (ex.: 2+ contas ML/Shopee sem escolha
//     explícita), a base e os custos também não são gravados.
//
// Reaproveita o parser (chamado por quem invoca este service, em
// server/index.js) e a validação de custo/normalização já existentes — este
// arquivo só orquestra a transação e delega o vínculo para
// baseVinculosService.criarVinculoManualTx (mesma invariante do fluxo
// legado e do picker account-aware, ver server/services/baseVinculosService.js).

const pool = require("../../config/database");
const baseVinculosService = require("../baseVinculosService");

function criarErroHttp(statusCode, mensagem, extra = {}) {
  const err = new Error(mensagem);
  err.statusCode = statusCode;
  Object.assign(err, extra);
  return err;
}

// Mesmas duas variantes de INSERT usadas historicamente por POST
// /importar-base (server/index.js) — preservadas ao pé da letra para não
// alterar a identidade de custo por marketplace (TikTok por sku_id,
// MELI/Shopee por produto_id+sku vazio). Ver comentário original em
// server/index.js sobre os dois índices parciais.
const SQL_INSERT_CUSTO_TIKTOK = `
  INSERT INTO custos (base_id, produto_id, sku_id, custo_produto, imposto_percentual, taxa_fixa, id_model, produto_nome, variacao_nome, sku, updated_at)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP)
  ON CONFLICT (base_id, sku_id) WHERE sku_id <> '' DO UPDATE SET
    produto_id = COALESCE(NULLIF(EXCLUDED.produto_id, ''), custos.produto_id),
    custo_produto = EXCLUDED.custo_produto, imposto_percentual = EXCLUDED.imposto_percentual,
    taxa_fixa = EXCLUDED.taxa_fixa, id_model = EXCLUDED.id_model,
    produto_nome = COALESCE(EXCLUDED.produto_nome, custos.produto_nome),
    variacao_nome = COALESCE(EXCLUDED.variacao_nome, custos.variacao_nome),
    updated_at = CURRENT_TIMESTAMP`;
const SQL_INSERT_CUSTO_LEGADO = `
  INSERT INTO custos (base_id, produto_id, sku_id, custo_produto, imposto_percentual, taxa_fixa, id_model, produto_nome, variacao_nome, sku, updated_at)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP)
  ON CONFLICT (base_id, produto_id, sku) WHERE sku_id = '' DO UPDATE SET
    custo_produto = EXCLUDED.custo_produto, imposto_percentual = EXCLUDED.imposto_percentual,
    taxa_fixa = EXCLUDED.taxa_fixa, id_model = EXCLUDED.id_model,
    produto_nome = COALESCE(EXCLUDED.produto_nome, custos.produto_nome),
    variacao_nome = COALESCE(EXCLUDED.variacao_nome, custos.variacao_nome),
    updated_at = CURRENT_TIMESTAMP`;

const MARKETPLACES_COM_CONTA = new Set(["meli", "shopee"]);

// slug, nomeBase e marketplace já devem chegar validados/normalizados por
// quem chama (mesma normalização de server/index.js). linhasPersistiveis é
// a lista já filtrada de linhas com custo preenchido (tem_custo !== false).
async function criarBaseComCustos({
  slug,
  nomeBase,
  marketplace,
  linhasPersistiveis,
  clienteId = null,
  clienteContaId = null,
  userId = null,
}) {
  if (!Array.isArray(linhasPersistiveis) || !linhasPersistiveis.length) {
    throw criarErroHttp(400, "Nenhuma linha com custo preenchido para importar.");
  }

  // Mercado Livre: conta explícita é obrigatória na criação. Nunca escolher
  // sozinho entre 1+ contas — mesmo quando o cliente só tem uma, a UI deve
  // enviar o cliente_conta_id escolhido (ver Portal/bases.js).
  if (marketplace === "meli" && !clienteContaId) {
    throw criarErroHttp(422, "Selecione o cliente e a conta Mercado Livre para importar esta base.", {
      code: "ML_ACCOUNT_REQUIRED",
    });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const existente = await client.query("SELECT id FROM bases WHERE slug = $1", [slug]);
    if (existente.rows.length) {
      throw criarErroHttp(409, `Já existe uma base com o slug "${slug}".`, { code: "BASE_SLUG_ALREADY_EXISTS" });
    }

    const baseResult = await client.query(
      `INSERT INTO bases (slug, nome, marketplace)
       VALUES ($1, $2, $3)
       RETURNING id, slug, nome, marketplace, ativo, created_at, updated_at`,
      [slug, nomeBase, marketplace]
    );
    const baseRow = baseResult.rows[0];
    const baseId = baseRow.id;

    // Compatibilidade: importação continua concedendo a base a todos os
    // usuários (política atual de user_bases, não alterada nesta correção).
    const users = await client.query(`SELECT id FROM users`);
    for (const u of users.rows) {
      await client.query(
        `INSERT INTO user_bases (user_id, base_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [u.id, baseId]
      );
    }

    for (const linha of linhasPersistiveis) {
      const skuIdLinha = linha.sku_id || "";
      await client.query(
        skuIdLinha ? SQL_INSERT_CUSTO_TIKTOK : SQL_INSERT_CUSTO_LEGADO,
        [
          baseId,
          linha.produto_id || "",
          skuIdLinha,
          linha.custo_produto,
          linha.imposto_percentual,
          linha.taxa_fixa,
          linha.id_model || null,
          linha.produto_nome || null,
          linha.variacao_nome || null,
          linha.sku || "",
        ]
      );
    }

    let vinculo = null;
    const podeVincular = MARKETPLACES_COM_CONTA.has(marketplace) || marketplace === "tiktok";
    if (podeVincular && (clienteContaId || clienteId)) {
      // Qualquer falha aqui (mismatch, conta/base inativa, 2+ contas
      // ambíguas) joga para o catch abaixo e desfaz base+custos também —
      // é exatamente a atomicidade que faltava (achado P0 da auditoria).
      const resultado = await baseVinculosService.criarVinculoManualTx(client, {
        baseId,
        clienteId,
        marketplace,
        clienteContaId,
        userId,
      });
      vinculo = resultado.vinculo;
    }

    await client.query("COMMIT");
    return {
      baseId,
      slug: baseRow.slug,
      nome: baseRow.nome,
      marketplace: baseRow.marketplace,
      total: linhasPersistiveis.length,
      vinculo,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  criarBaseComCustos,
};
