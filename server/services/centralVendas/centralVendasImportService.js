const {
  processMeliForCentralVendas,
  parseMeliRows,
} = require("../fechamentoFinanceiro/meliFinanceiroService");
const pool = require("../../config/database");
const { pedidoEntraNoResultado } = require("./centralVendasService");
const { resolveMarketplaceAccountContext } = require("../clienteContas/clienteContaService");

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
  const pedidosValidos = pedidos.filter(pedidoEntraNoResultado);
  const resumoMotor = motorResult?.resumo || {};
  const receitaBloqueada = round2(
    pedidosValidos
      .filter((pedido) => pedido.confianca === "bloqueado")
      .reduce((sum, pedido) => sum + Number(pedido.faturamento || 0), 0)
  );
  const faturamentoComCusto = round2(
    pedidosValidos
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
    // M4, seção 8: zero pedidos válidos (Orders 0/0, ou todos cancelados) NÃO
    // é "ausente" — é um resultado verificado. "ausente" neste código
    // sempre significou "não sabemos", e aqui sabemos: o período foi
    // consultado e não há receita a reportar. Distinguir isso de "nunca
    // sincronizado" é o próprio motivo do snapshot vazio existir (a Central
    // já trata `pedidosValidos.length === 0` sem erro em todo o resto desta
    // função — round2(0), null em lucroContribuicao — então nunca é
    // alcançado pela planilha, que bloqueia esse caso antes, em
    // importarVendasMeli).
    confianca:
      pedidosValidos.some((pedido) => pedido.confianca === "bloqueado")
        ? "parcial"
        : pedidosValidos.some((pedido) => pedido.confianca === "parcial")
          ? "parcial"
          : "confiavel",
  };
}

/*
 * Busca os custos de uma base JÁ RESOLVIDA (por conta, nunca por
 * "última base do cliente" — ver resolveMarketplaceAccountContext) e monta
 * costRowsRaw no formato que parseMeliCostRows/buildCentralCostMap esperam:
 *   [{ mlb: "MLB123", custo: 18.90, imposto: 10 }, ...]
 *
 * - produto_id  → chave "mlb"   (findField reconhece "mlb" como alias de "# de anúncio")
 * - custo_produto → chave "custo"  (alias de "preço de custo")
 * - imposto_percentual → chave "imposto" (alias direto)
 *
 * Erro 422 explícito: "base vinculada não possui itens de custo cadastrados"
 * ("cliente sem base de custo vinculada" é lançado por quem resolve a
 * identidade, antes de chegar aqui — ver importarVendasMeli).
 */
async function buscarCostRowsPorBaseId(baseId, db = pool) {
  const custosResult = await db.query(
    `SELECT produto_id, custo_produto, imposto_percentual
       FROM custos
      WHERE base_id = $1`,
    [baseId]
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
    clienteContaId = null,
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

    // Mesma porta de identidade do GET e do sync API-first (M1). Importar
    // planilha não depende de chamar a API do Mercado Livre, então
    // requireUsableGrant:false — mas a BASE ainda precisa vir da CONTA
    // resolvida, nunca de "última base atualizada do cliente" (P0 do
    // hardening: dois cliques em contas diferentes do mesmo cliente não
    // podem usar a base um do outro). Lança 409/403/422 antes de tocar em
    // custos quando a identidade é ambígua ou inválida.
    const context = await resolveMarketplaceAccountContext({
      clienteId: cliente.id,
      marketplace: marketplaceNorm,
      clienteContaId,
      requireUsableGrant: false,
      queryable: db,
    });

    if (!context.base?.base_id) {
      const err = new Error("cliente sem base de custo vinculada");
      err.statusCode = 422;
      throw err;
    }

    const costRowsRaw = await buscarCostRowsPorBaseId(context.base.base_id, db);

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
      // Mesma identidade resolvida acima — nunca inventada. grantId só é
      // preenchido quando o resolver encontrou um grant real (planilha não
      // exige grant utilizável; ver requireUsableGrant:false acima).
      clienteContaId: context.conta?.id || null,
      baseId: context.base.base_id,
      baseResolutionMode: context.base.resolvido_por || null,
      grantId: context.grant?.id || null,
      externalAccountId: context.mlUserId || null,
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
  buscarCostRowsPorBaseId,
};
