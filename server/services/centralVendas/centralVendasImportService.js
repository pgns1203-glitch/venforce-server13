const {
  processMeliForCentralVendas,
  parseMeliRows,
} = require("../fechamentoFinanceiro/meliFinanceiroService");
const pool = require("../../config/database");

function getRepository() {
  return require("./centralVendasRepository");
}

function normalizeSlug(slug) {
  return String(slug || "").trim().toLowerCase();
}

function normalizeCompetencia(value) {
  const text = String(value || "").trim();
  if (/^\d{4}-\d{2}$/.test(text)) return text;
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function round2(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
}

function buildResumoCentralVendas(motorResult) {
  const pedidos = Array.isArray(motorResult?.pedidos) ? motorResult.pedidos : [];
  const resumoMotor = motorResult?.resumo || {};
  const receitaBloqueada = round2(
    pedidos
      .filter((pedido) => pedido.confianca === "bloqueado")
      .reduce((sum, pedido) => sum + Number(pedido.faturamento || 0), 0)
  );
  const faturamentoComCusto = round2(
    pedidos
      .filter((pedido) => pedido.confianca !== "bloqueado")
      .reduce((sum, pedido) => sum + Number(pedido.faturamento || 0), 0)
  );
  const faturamento = round2(faturamentoComCusto + receitaBloqueada);
  const lucroContribuicao =
    resumoMotor.lucroContribuicao === null || resumoMotor.lucroContribuicao === undefined
      ? null
      : round2(resumoMotor.lucroContribuicao);

  return {
    ...resumoMotor,
    faturamento,
    faturamentoComCusto,
    receitaBloqueada,
    lucroContribuicao,
    margemContribuicaoPercentual:
      lucroContribuicao !== null && faturamentoComCusto > 0
        ? round2((lucroContribuicao / faturamentoComCusto) * 100)
        : null,
    confianca:
      pedidos.some((pedido) => pedido.confianca === "bloqueado")
        ? "parcial"
        : pedidos.some((pedido) => pedido.confianca === "parcial")
          ? "parcial"
          : pedidos.length
            ? "confiavel"
            : "ausente",
  };
}

/*
 * Busca os custos da base vinculada ao cliente (marketplace meli) e monta
 * costRowsRaw no formato que parseMeliCostRows/buildCentralCostMap esperam:
 *   [{ mlb: "MLB123", custo: 18.90, imposto: 10 }, ...]
 *
 * - produto_id  → chave "mlb"   (findField reconhece "mlb" como alias de "# de anúncio")
 * - custo_produto → chave "custo"  (alias de "preço de custo")
 * - imposto_percentual → chave "imposto" (alias direto)
 *
 * Erros 422 explícitos:
 *   "cliente sem base de custo vinculada"
 *   "base vinculada não possui itens de custo cadastrados"
 */
async function buscarCostRowsDaBase(clienteId, db = pool) {
  const vinculoResult = await db.query(
    `SELECT b.id AS base_id, b.nome AS base_nome
       FROM bases b
       INNER JOIN base_cliente_vinculos v ON v.base_id = b.id
      WHERE v.cliente_id = $1
        AND v.ativo = true
        AND b.ativo = true
        AND v.marketplace = 'meli'
      ORDER BY v.updated_at DESC
      LIMIT 1`,
    [clienteId]
  );

  if (!vinculoResult.rows.length) {
    const err = new Error("cliente sem base de custo vinculada");
    err.statusCode = 422;
    throw err;
  }

  const { base_id } = vinculoResult.rows[0];

  const custosResult = await db.query(
    `SELECT produto_id, custo_produto, imposto_percentual
       FROM custos
      WHERE base_id = $1`,
    [base_id]
  );

  if (!custosResult.rows.length) {
    const err = new Error("base vinculada não possui itens de custo cadastrados");
    err.statusCode = 422;
    throw err;
  }

  // De-para: produto_id → mlb, custo_produto → custo, imposto_percentual → imposto
  return custosResult.rows.map((row) => ({
    mlb: String(row.produto_id || "").trim(),
    custo: Number(row.custo_produto) || 0,
    imposto: Number(row.imposto_percentual) || 0,
  }));
}

function createCentralVendasImportService(repository = getRepository(), db = pool) {
  async function importarVendasMeli({
    salesRowsRaw,
    clienteSlug,
    competencia,
    marketplace = "meli",
  }) {
    const slug = normalizeSlug(clienteSlug);
    const competenciaNorm = normalizeCompetencia(competencia);
    const marketplaceNorm = String(marketplace || "meli").trim().toLowerCase();

    if (!slug) {
      const err = new Error("slug e obrigatorio.");
      err.statusCode = 400;
      throw err;
    }

    if (marketplaceNorm !== "meli") {
      const err = new Error("Marketplace invalido para Central de Vendas nesta fase.");
      err.statusCode = 400;
      throw err;
    }

    if (!Array.isArray(salesRowsRaw)) {
      const err = new Error("Linhas de vendas sao obrigatorias.");
      err.statusCode = 400;
      throw err;
    }

    await repository.ensureCentralVendasTables();

    const cliente = await repository.getClienteBySlug(slug);
    if (!cliente) {
      const err = new Error("Cliente nao encontrado.");
      err.statusCode = 404;
      throw err;
    }

    const costRowsRaw = await buscarCostRowsDaBase(cliente.id, db);

    // Diagnóstico de parsing: converte antes do motor para poder logar
    const salesRowsParsed = parseMeliRows(salesRowsRaw);
    const nLinhasBrutas = salesRowsRaw.length;
    const nMainRows = salesRowsParsed.filter(r => !r.adId && Math.abs(r.productRevenue) > 0).length;
    const nItemRows = salesRowsParsed.filter(r => !!r.adId && r.units > 0).length;

    console.log(
      `[centralVendas] import ${slug} ${competenciaNorm}:` +
      ` linhasBrutas=${nLinhasBrutas} mainRows=${nMainRows} itemRows=${nItemRows}`
    );

    if (nLinhasBrutas > 0 && nMainRows === 0 && nItemRows === 0) {
      // Mostra as chaves e valores das primeiras 3 linhas para diagnóstico
      const sample = salesRowsRaw.slice(0, 3).map(r => Object.keys(r).join(" | "));
      console.log("[centralVendas] colunas da planilha (primeiras 3 linhas):", sample);
      // Também mostra o que parseMeliRows extraiu para a primeira linha
      if (salesRowsParsed[0]) {
        const p = salesRowsParsed[0];
        console.log(
          `[centralVendas] parseMeliRows linha 0: adId=${JSON.stringify(p.adId)}` +
          ` productRevenue=${p.productRevenue} units=${p.units} total=${p.total}` +
          ` saleNumber=${JSON.stringify(p.saleNumber)}`
        );
      }
      const err = new Error(
        `A planilha foi lida (${nLinhasBrutas} linhas) mas nenhuma linha foi reconhecida ` +
        `como pedido Meli. Verifique se o cabeçalho da planilha contém as colunas esperadas ` +
        `("N.º de venda", "Receita por Produtos", "# de Anúncio", "Unidades"). ` +
        `Colunas encontradas: ${Object.keys(salesRowsRaw[0] || {}).slice(0, 8).join(", ")}`
      );
      err.statusCode = 400;
      throw err;
    }

    const motorResult = processMeliForCentralVendas({
      salesRowsRaw,
      costRowsRaw,
      clienteSlug: slug,
      competencia: competenciaNorm,
    });
    const resumo = buildResumoCentralVendas(motorResult);

    if (motorResult.pedidos.length === 0) {
      const err = new Error(
        `Parser reconheceu ${nMainRows} linha(s) de cabeçalho e ${nItemRows} item(s), ` +
        `mas o motor não gerou nenhum pedido. ` +
        `Verifique se as linhas de item estão logo abaixo das linhas de total na planilha.`
      );
      err.statusCode = 400;
      throw err;
    }

    const motorPayload = {
      ...motorResult,
      resumo,
    };

    const persisted = await repository.persistCentralVendasImport({
      cliente,
      marketplace: marketplaceNorm,
      competencia: competenciaNorm,
      motorPayload,
      resumo,
    });

    return {
      ok: true,
      importId: persisted.importacao.id,
      cliente,
      marketplace: marketplaceNorm,
      competencia: competenciaNorm,
      resumo,
      pedidosPersistidos: persisted.pedidosPersistidos,
      itensPersistidos: persisted.itensPersistidos,
      componentesPersistidos: persisted.componentesPersistidos,
    };
  }

  return {
    importarVendasMeli,
  };
}

module.exports = {
  importarVendasMeli: (params) => createCentralVendasImportService().importarVendasMeli(params),
  createCentralVendasImportService,
  buildResumoCentralVendas,
  buscarCostRowsDaBase,
};
