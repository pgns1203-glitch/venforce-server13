process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const XLSX = require("xlsx");
const pool = require("../config/database");
const mlClient = require("../utils/mlClient");
const contextoPrecificacao = require("../services/automacoes/contextoPrecificacaoService");

let checks = 0;
function ok(label, condition) {
  assert.ok(condition, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

function sellerSku(value) {
  return { id: "SELLER_SKU", value_name: value };
}

function baseBody(id, extras = {}) {
  return {
    id,
    title: `Produto ${id}`,
    seller_id: 222,
    status: "active",
    listing_type_id: "gold_special",
    category_id: "MLB1234",
    price: 100,
    shipping: { logistic_type: "cross_docking" },
    ...extras,
  };
}

const legadoIncompleto = baseBody("MLBLEGACY1", {
  title: "Calça Legada",
  variations: [
    {
      id: 7001,
      seller_custom_field: "FALLBACK-36",
      attribute_combinations: [{ value_name: "Bege" }, { value_name: "36" }],
    },
    {
      id: 7002,
      attribute_combinations: [{ value_name: "Bege" }, { value_name: "38" }],
    },
    {
      id: 7003,
      seller_custom_field: "LEGACY-40",
      attribute_combinations: [{ value_name: "Bege" }, { value_name: "40" }],
    },
  ],
});

const legadoCompleto = baseBody("MLBLEGACY1", {
  title: "Calça Legada",
  variations: [
    {
      id: 7001,
      seller_custom_field: "FALLBACK-36",
      attributes: [sellerSku("SKU-36")],
      attribute_combinations: [{ value_name: "Bege" }, { value_name: "36" }],
    },
    {
      id: 7002,
      attributes: [sellerSku("SKU-38")],
      attribute_combinations: [{ value_name: "Bege" }, { value_name: "38" }],
    },
    {
      id: 7003,
      seller_custom_field: "LEGACY-40",
      attributes: [],
      attribute_combinations: [{ value_name: "Bege" }, { value_name: "40" }],
    },
  ],
});

const simples = baseBody("MLBSIMPLE1", {
  title: "Produto Simples",
  attributes: [sellerSku("SKU-SIMPLES")],
  variations: [],
});

const familyIdGrande = "18446744073709551615";
const up1 = baseBody("MLBUP1", {
  title: "Tênis Corrida - Bege 36",
  family_name: "Tênis Corrida",
  family_id: familyIdGrande,
  user_product_id: "MLBU9000",
  attributes: [sellerSku("SKU-UP")],
  variations: [],
});
const up2 = baseBody("MLBUP2", {
  title: "Tênis Corrida - Bege 36 Premium",
  family_name: "Tênis Corrida",
  family_id: familyIdGrande,
  user_product_id: "MLBU9000",
  attributes: [sellerSku("SKU-UP")],
  variations: [],
});

let cenario = "legado";
const chamadas = [];

async function mlFetchFake(clienteId, path, options = {}) {
  chamadas.push({ clienteId, path, options });

  if (path.startsWith("/users/222/items/search?")) {
    return {
      ok: true,
      status: 200,
      data: {
        results: cenario === "legado"
          ? ["MLBLEGACY1", "MLBSIMPLE1"]
          : cenario === "legado_completo" ? ["MLBLEGACY1"] : ["MLBUP1", "MLBUP2"],
        scroll_id: null,
      },
    };
  }

  if (path.startsWith("/items?ids=")) {
    const bodies = cenario === "legado"
      ? [legadoIncompleto, simples]
      : cenario === "legado_completo" ? [legadoCompleto] : [up1, up2];
    return { ok: true, status: 200, data: bodies.map((body) => ({ code: 200, body })) };
  }

  if (path === "/items/MLBLEGACY1?include_attributes=all") {
    return { ok: true, status: 200, data: legadoCompleto };
  }

  const salePrice = path.match(/^\/items\/([^/]+)\/sale_price\?context=channel_marketplace$/);
  if (salePrice) {
    const amount = {
      MLBLEGACY1: 120,
      MLBSIMPLE1: 80,
      MLBUP1: 90,
      MLBUP2: 140,
    }[salePrice[1]];
    return { ok: true, status: 200, data: { amount, regular_amount: amount } };
  }

  if (path.startsWith("/sites/MLB/listing_prices?")) {
    return {
      ok: true,
      status: 200,
      data: { sale_fee_amount: 12, sale_fee_details: { percentage_fee: 10 } },
    };
  }

  if (path.startsWith("/users/222/shipping_options/free?")) {
    return { ok: true, status: 200, data: { coverage: { all_country: { list_cost: 18 } } } };
  }

  throw new Error(`Caminho ML não mapeado no teste: ${path}`);
}

function lerWorkbook(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer", cellNF: true });
  const matriz = workbook.Sheets["Matriz Mercado Livre"];
  const resumo = workbook.Sheets.Resumo;
  return {
    workbook,
    matriz,
    matrizRows: XLSX.utils.sheet_to_json(matriz, { header: 1, defval: null, raw: true }),
    resumoRows: XLSX.utils.sheet_to_json(resumo, { header: 1, defval: null, raw: true }),
  };
}

function valorResumo(rows, rotulo) {
  return rows.find((row) => row[0] === rotulo)?.[1];
}

function chamadasDe(trecho) {
  return chamadas.filter((call) => call.path.includes(trecho));
}

async function gerar(gerarPlanilhaPrecificacaoSemBase) {
  chamadas.length = 0;
  return gerarPlanilhaPrecificacaoSemBase({ clienteSlugRaw: "cliente-x", clienteContaId: 102 });
}

async function run() {
  const originalPoolQuery = pool.query;
  const originalMlFetch = mlClient.mlFetch;
  const originalExigir = contextoPrecificacao.exigirContextoGrantMl;

  pool.query = async (sql, params = []) => {
    const q = String(sql).replace(/\s+/g, " ").trim();
    if (q.startsWith("SELECT produto_id, custo_produto, imposto_percentual, taxa_fixa FROM custos")) {
      ok("Base é carregada somente pelo base_id selecionado", params[0] === 77);
      return {
        rows: [{
          produto_id: "MLBLEGACY1",
          custo_produto: 25,
          imposto_percentual: 8,
          taxa_fixa: 3,
        }],
      };
    }
    throw new Error(`Query não mapeada: ${q}`);
  };
  mlClient.mlFetch = mlFetchFake;
  contextoPrecificacao.exigirContextoGrantMl = async () => ({
    cliente: { id: 90, nome: "Cliente X", slug: "cliente-x" },
    mlUserId: "222",
    basesMeli: [{ id: 77 }],
    base: { id: 77, nome: "Base MLB" },
  });

  for (const modulo of [
    "../services/automacoes/precoItemService",
    "../services/automacoes/diagnosticoService",
    "../services/automacoes/planilhaPrecificacaoSemBaseService",
  ]) {
    delete require.cache[require.resolve(modulo)];
  }

  try {
    const { gerarPlanilhaPrecificacaoSemBase } = require("../services/automacoes/planilhaPrecificacaoSemBaseService");

    cenario = "legado";
    const resultadoLegado = await gerar(gerarPlanilhaPrecificacaoSemBase);
    const legado = lerWorkbook(resultadoLegado.buffer);
    const headers = legado.matrizRows[2];
    const dataRows = legado.matrizRows.slice(3);
    const linhasLegado = dataRows.filter((row) => row[0] === "MLBLEGACY1");

    ok("Workbook adota as 9 colunas iniciais exigidas", JSON.stringify(headers.slice(0, 9)) === JSON.stringify([
      "MLB", "MLBU", "ID Variação Legada", "SKU", "Variação", "Título", "Family ID", "Marketplace", "Chave Base",
    ]));
    ok("MLB legado com 3 variations gera 3 linhas", linhasLegado.length === 3);
    ok("as 3 linhas repetem o mesmo MLB", linhasLegado.every((row) => row[0] === "MLBLEGACY1"));
    ok("variation.id distintos são preservados", JSON.stringify(linhasLegado.map((row) => String(row[2]))) === JSON.stringify(["7001", "7002", "7003"]));
    ok("SELLER_SKU e fallback aparecem na ordem esperada", JSON.stringify(linhasLegado.map((row) => row[3])) === JSON.stringify(["SKU-36", "SKU-38", "LEGACY-40"]));
    ok("rótulos de variação são montados por attribute_combinations", JSON.stringify(linhasLegado.map((row) => row[4])) === JSON.stringify(["Bege | 36", "Bege | 38", "Bege | 40"]));
    ok("preço efetivo é repetido nas variações", linhasLegado.every((row) => row[18] === 120));
    ok("comissão percentual é repetida nas variações", linhasLegado.every((row) => row[13] === 0.1));
    ok("frete é repetido nas variações", linhasLegado.every((row) => row[12] === 18));
    ok("Chave Base continua sendo o MLB", linhasLegado.every((row) => row[8] === "MLBLEGACY1"));
    ok("custo da Base por MLB é repetido nas variações", linhasLegado.every((row) => row[10] === 25));
    ok("imposto da Base por MLB é repetido nas variações", linhasLegado.every((row) => row[11] === 0.08));
    ok("taxa fixa da Base por MLB é repetida nas variações", linhasLegado.every((row) => row[14] === 3));

    ok("fallback include_attributes=all ocorre uma vez para o MLB afetado", chamadasDe("/items/MLBLEGACY1?include_attributes=all").length === 1);
    ok("sale_price ocorre uma vez para o MLB legado", chamadasDe("/items/MLBLEGACY1/sale_price").length === 1);
    ok("listing_prices ocorre uma vez por MLB, não por variation", chamadasDe("/sites/MLB/listing_prices").length === 2);
    ok("shipping_options ocorre uma vez por MLB, não por variation", chamadasDe("/shipping_options/free").length === 2);
    ok("todos os requests preservam mlUserId da Conta B", chamadas.length > 0 && chamadas.every((call) => call.options.mlUserId === "222"));
    ok("multiget preserva family_id via bigIntFields", chamadas.find((call) => call.path.startsWith("/items?ids="))?.options.bigIntFields?.includes("family_id"));
    ok("consulta complementar preserva family_id via bigIntFields", chamadas.find((call) => call.path.includes("include_attributes=all"))?.options.bigIntFields?.includes("family_id"));

    ok("Resumo separa 2 MLBs ativos", valorResumo(legado.resumoRows, "Total de MLBs ativos") === 2);
    ok("Resumo separa 4 linhas de precificação", valorResumo(legado.resumoRows, "Total de linhas de precificação") === 4);
    ok("Resumo conta o MLB legado multivariante", valorResumo(legado.resumoRows, "MLBs legados multivariantes") === 1);
    ok("Resumo expõe a quantidade de linhas sem SKU", valorResumo(legado.resumoRows, "Linhas sem SKU") === 0);
    ok("Resumo não chama linhas expandidas de anúncios ativos", !legado.resumoRows.some((row) => String(row[0] || "").toLowerCase().includes("anúncios ativos")));

    const formulasEsperadas = {
      U4: 'IFERROR(S4-S4*L4-S4*N4-M4-K4-O4,"")',
      V4: 'IFERROR(U4/S4,"")',
      Y4: 'IFERROR((K4+M4+O4)/(1-L4-N4-X4),"")',
      Z4: 'IFERROR(Y4*X4,"")',
      AB4: 'IF(AF4="sem_base","Revisar custo/base",IF(AF4="sem_frete","Revisar frete",IF(AF4="sem_comissao","Revisar comissão",IF(S4<Y4,"Subir preço",IF(S4>Y4,"Avaliar redução","Manter")))))',
      AC4: 'IF(AB4="Subir preço",Y4,S4)',
      AD4: 'IFERROR(AC4-S4,"")',
      AE4: 'IFERROR(AD4/S4,"")',
    };
    Object.entries(formulasEsperadas).forEach(([address, formula]) => {
      ok(`fórmula ${address} foi deslocada sem mudar a matemática`, legado.matriz[address]?.f === formula);
    });
    const formulas = Object.values(legado.matriz).map((cell) => cell?.f).filter(Boolean);
    ok("não há SUM/AVG/COUNT financeiro sobre linhas expandidas", formulas.every((formula) => !/\b(?:SUM|AVG|COUNT)\s*\(/i.test(formula)));
    ok("autofilter cobre a nova última coluna AH", legado.matriz["!autofilter"]?.ref === "A3:AH7");

    cenario = "legado_completo";
    const resultadoLegadoCompleto = await gerar(gerarPlanilhaPrecificacaoSemBase);
    const legadoJaCompleto = lerWorkbook(resultadoLegadoCompleto.buffer);
    ok("multiget legado já completo mantém as 3 variations", legadoJaCompleto.matrizRows.slice(3).length === 3);
    ok("multiget legado já completo não dispara chamada complementar", chamadasDe("include_attributes=all").length === 0);
    ok("multiget legado já completo ainda enriquece finanças só uma vez", chamadasDe("/sale_price").length === 1 && chamadasDe("/sites/MLB/listing_prices").length === 1 && chamadasDe("/shipping_options/free").length === 1);

    cenario = "up";
    const resultadoUp = await gerar(gerarPlanilhaPrecificacaoSemBase);
    const up = lerWorkbook(resultadoUp.buffer);
    const upRows = up.matrizRows.slice(3);
    ok("dois MLBs do mesmo MLBU continuam duas linhas", upRows.length === 2 && new Set(upRows.map((row) => row[0])).size === 2);
    ok("MLBU e SKU iguais não colapsam os MLBs", upRows.every((row) => row[1] === "MLBU9000" && row[3] === "SKU-UP"));
    ok("family_id grande permanece string íntegra", upRows.every((row) => row[6] === familyIdGrande && typeof row[6] === "string"));
    ok("preços diferentes permanecem por MLB", JSON.stringify(upRows.map((row) => row[18])) === JSON.stringify([90, 140]));
    ok("User Products sem variations não disparam consulta complementar", chamadasDe("include_attributes=all").length === 0);
    ok("User Products continuam com enriquecimento financeiro uma vez por MLB", chamadasDe("/sale_price").length === 2 && chamadasDe("/sites/MLB/listing_prices").length === 2 && chamadasDe("/shipping_options/free").length === 2);
    ok("requests do cenário UP também preservam mlUserId da Conta B", chamadas.every((call) => call.options.mlUserId === "222"));

    console.log(`\n✓ planilhaPrecificacaoVariacoes: ${checks} verificações`);
  } finally {
    pool.query = originalPoolQuery;
    mlClient.mlFetch = originalMlFetch;
    contextoPrecificacao.exigirContextoGrantMl = originalExigir;
    for (const modulo of [
      "../services/automacoes/precoItemService",
      "../services/automacoes/diagnosticoService",
      "../services/automacoes/planilhaPrecificacaoSemBaseService",
    ]) {
      delete require.cache[require.resolve(modulo)];
    }
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
