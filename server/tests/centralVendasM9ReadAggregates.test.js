// server/tests/centralVendasM9ReadAggregates.test.js
//
// M9 — remoção do recálculo financeiro do frontend da Central de Vendas V3.
//
// Este arquivo prova o lado BACKEND do marco: os agregados que
// Portal/fechamentos-api.js antes recalculava localmente (resumo do
// fechamento/qualidade, vendas por dia, Curva ABC) agora existem como
// leitura pura sobre o contrato de pedido já canônico (M5/M6/M7) — nenhuma
// fórmula financeira nova, apenas soma de campos já persistidos.
//
// Mesmo padrão de fake db de centralVendasM7Read.test.js: as funções REAIS
// de centralVendasRepository rodam contra uma fake db em memória.

const assert = require("assert");
const repository = require("../services/centralVendas/centralVendasRepository");
const { createCentralVendasReadService } = require("../services/centralVendas/centralVendasReadService");

const cliente = { id: 1, nome: "Cliente A", slug: "cliente-a", ativo: true };

function realRepositoryComDb(db) {
  return {
    ensureCentralVendasTables: () => repository.ensureCentralVendasTables(db),
    getClienteBySlug: (slug) => repository.getClienteBySlug(slug, db),
    getLatestCentralVendasImport: (args) => repository.getLatestCentralVendasImport(args, db),
    getCentralVendasByRange: (args) => repository.getCentralVendasByRange(args, db),
  };
}

function makeDb({ contas = [], imports = [], pedidos = [], itens = [], componentes = [] }) {
  return {
    async query(sql, params = []) {
      if (sql.includes("CREATE TABLE") || sql.includes("ALTER TABLE") || sql.includes("CREATE INDEX") || sql.includes("CREATE UNIQUE INDEX") || sql.includes("WITH duplicados")) {
        return { rows: [] };
      }
      if (sql.includes("FROM clientes") && sql.includes("slug = $1")) {
        return { rows: params[0] === cliente.slug ? [cliente] : [] };
      }
      if (sql.includes("FROM clientes") && sql.includes("WHERE id")) {
        return { rows: params[0] === cliente.id ? [cliente] : [] };
      }
      if (sql.includes("cliente_contas WHERE id = $1")) {
        const row = contas.find((c) => c.id === params[0]);
        return { rows: row ? [row] : [] };
      }
      if (sql.includes("cliente_contas WHERE cliente_id = $1 AND marketplace = $2 AND ativo = true ORDER BY is_primary")) {
        return { rows: contas.filter((c) => c.cliente_id === params[0] && c.marketplace === params[1] && c.ativo !== false) };
      }
      if (sql.includes("COUNT(*)::int AS total FROM cliente_contas")) {
        const total = contas.filter((c) => c.cliente_id === params[0] && c.marketplace === params[1] && c.ativo !== false).length;
        return { rows: [{ total }] };
      }
      if (sql.includes("FROM ml_tokens t")) return { rows: [] };
      if (sql.includes("v.cliente_conta_id = $1 AND v.ativo = true")) return { rows: [] };
      if (sql.includes("v.cliente_id = $1 AND v.marketplace = $2 AND v.ativo = true")) return { rows: [] };

      if (sql.includes("competencia BETWEEN $3 AND $4") && sql.includes("FROM central_vendas_imports")) {
        const [slug, marketplace, compFrom, compTo] = params;
        let candidatos = imports.filter((row) =>
          row.cliente_slug === slug && row.marketplace === marketplace &&
          row.competencia >= compFrom && row.competencia <= compTo &&
          (row.publication_status === "published" || row.publication_status === "legacy")
        );
        if (params.length >= 5) {
          const clienteContaId = params[4];
          if (sql.includes("OR cliente_conta_id IS NULL")) {
            candidatos = candidatos.filter((r) => r.cliente_conta_id === clienteContaId || r.cliente_conta_id == null);
          } else {
            candidatos = candidatos.filter((r) => r.cliente_conta_id === clienteContaId);
          }
        }
        return { rows: candidatos };
      }
      if (sql.includes("FROM central_vendas_pedidos") && sql.includes("import_id = ANY")) {
        const [importIds, dateFrom, dateTo] = params;
        return { rows: pedidos.filter((p) => importIds.includes(p.import_id) && p.data_pedido >= dateFrom && p.data_pedido <= dateTo) };
      }
      if (sql.includes("FROM central_vendas_pedido_itens") && sql.includes("pedido_row_id = ANY")) {
        const [rowIds] = params;
        return { rows: itens.filter((i) => rowIds.includes(i.pedido_row_id)) };
      }
      if (sql.includes("FROM central_vendas_componentes") && sql.includes("pedido_row_id = ANY")) {
        const [rowIds] = params;
        return { rows: componentes.filter((c) => rowIds.includes(c.pedido_row_id)) };
      }

      throw new Error(`Fake db: SQL nao mapeado -> ${sql.slice(0, 160)}`);
    },
  };
}

function pedidoRow({ id, importId, pedidoId, data, faturamento = 100, resultado = null, confianca = "confiavel", status = "paid", quantidadeItens = null }) {
  return {
    id, import_id: importId, pedido_id: pedidoId, data_pedido: data, status, confianca,
    faturamento, resultado, quantidade_itens: quantidadeItens, pendencias_json: [], payload_json: {},
  };
}
function importRow({ id, competencia, coverageFrom, coverageTo, publishedAt, contaId = null }) {
  return {
    id, cliente_slug: cliente.slug, marketplace: "meli", competencia,
    cliente_conta_id: contaId, publication_status: "published",
    coverage_date_from: coverageFrom, coverage_date_to: coverageTo, published_at: publishedAt,
    fonte: "orders_api", status: "processado", confianca: "confiavel",
    resumo_json: {}, payload_json: {}, created_at: "2026-08-01T00:00:00.000Z",
  };
}
function itemRow({ id, pedidoRowId, itemId, mlb, pedidoId, quantidade = 1, receitaProduto = null, custoProduto = null, confianca = "confiavel" }) {
  return { id, import_id: 1, pedido_row_id: pedidoRowId, item_id: itemId, mlb, pedido_id: pedidoId, quantidade, receita_produto: receitaProduto, custo_produto: custoProduto, confianca, pendencias_json: [], payload_json: {} };
}
function componenteRow({ id, pedidoRowId, itemRowId = null, pedidoId, itemId = null, tipo, valor, confianca = "confiavel", escopo, efeito, incluidoNoResultado }) {
  return { id, import_id: 1, pedido_row_id: pedidoRowId, item_row_id: itemRowId, pedido_id: pedidoId, item_id: itemId, tipo, valor, confianca, escopo, efeito, incluido_no_resultado: incluidoNoResultado };
}

function svcFor(db) {
  return createCentralVendasReadService(realRepositoryComDb(db), db);
}

async function run() {
  let checks = 0;
  function eq(label, actual, expected) {
    assert.deepStrictEqual(actual, expected, `FALHOU: ${label} — recebido ${JSON.stringify(actual)}, esperado ${JSON.stringify(expected)}`);
    checks += 1;
  }
  function ok(label, cond) {
    assert.ok(cond, `FALHOU: ${label}`);
    checks += 1;
  }

  // ── A. summary: unidades/ticket/comissão/custo/frete/cobertura, honestidade de ausência ──
  {
    const imp = importRow({ id: 1, competencia: "2026-08", coverageFrom: "2026-08-01", coverageTo: "2026-08-31", publishedAt: "2026-08-01T10:00:00Z" });
    const pedidos = [
      pedidoRow({ id: 1, importId: 1, pedidoId: "P1", data: "2026-08-01", faturamento: 100, resultado: 30, quantidadeItens: 2 }),
      pedidoRow({ id: 2, importId: 1, pedidoId: "P2", data: "2026-08-02", faturamento: 200, resultado: 60, quantidadeItens: 3 }),
    ];
    const itens = [
      itemRow({ id: 1, pedidoRowId: 1, itemId: "IT1", mlb: "MLBA", pedidoId: "P1", quantidade: 2, receitaProduto: 100, custoProduto: 40 }),
      itemRow({ id: 2, pedidoRowId: 2, itemId: "IT2", mlb: "MLBB", pedidoId: "P2", quantidade: 3, receitaProduto: 200, custoProduto: 80 }),
    ];
    const componentes = [
      componenteRow({ id: 1, pedidoRowId: 1, itemRowId: 1, pedidoId: "P1", itemId: "IT1", tipo: "custo_produto", valor: 40, escopo: "item", efeito: "debito", incluidoNoResultado: true }),
      componenteRow({ id: 2, pedidoRowId: 1, itemRowId: 1, pedidoId: "P1", itemId: "IT1", tipo: "tarifa_venda", valor: 10, escopo: "item", efeito: "debito", incluidoNoResultado: true }),
      // P2 nao tem tarifa_venda nem frete_seller -> comissao/frete devem ficar null (ausencia real, nao 0).
      componenteRow({ id: 3, pedidoRowId: 2, itemRowId: 2, pedidoId: "P2", itemId: "IT2", tipo: "custo_produto", valor: 80, escopo: "item", efeito: "debito", incluidoNoResultado: true }),
    ];
    const db = makeDb({ imports: [imp], pedidos, itens, componentes });
    const resp = await svcFor(db).getCentralVendasRead(cliente.slug, { dateFrom: "2026-08-01", dateTo: "2026-08-31" });
    const s = resp.summary;

    eq("A: unidades = soma quantidade_itens", s.unidades, 5);
    eq("A: ticket = faturamento/pedidosValidos", s.ticket, 150);
    eq("A: comissao = soma so de quem tem tarifa_venda (P1), nao 0 no P2", s.comissao, 10);
    eq("A: freteTotal ausente em TODOS os pedidos -> null, nunca 0", s.freteTotal, null);
    eq("A: custoTotal = soma dos 2 pedidos", s.custoTotal, 120);
    eq("A: cobertura.custo = 100% (os 2 pedidos tem custo)", s.cobertura.custo, 100);
    eq("A: cobertura.frete = null (nenhum pedido tem frete)", s.cobertura.frete, null);
    eq("A: cobertura.comissao = 33.33% (so P1, R$100 de R$300)", s.cobertura.comissao, 33.33);
    eq("A: semFrete = 2 (nenhum pedido valido tem frete)", s.semFrete, 2);
    eq("A: semCusto = 0 (os 2 tem custo)", s.semCusto, 0);
    console.log("  ✓ A. summary: unidades/ticket/comissão/custo/frete/cobertura — ausência nunca vira 0");
  }

  // ── B. filteredSummary (resumoFiltro) é distinto de summary (global) ──
  {
    const imp = importRow({ id: 1, competencia: "2026-08", coverageFrom: "2026-08-01", coverageTo: "2026-08-31", publishedAt: "2026-08-01T10:00:00Z" });
    const pedidos = [
      pedidoRow({ id: 1, importId: 1, pedidoId: "COM_CUSTO", data: "2026-08-01", faturamento: 100, resultado: 30, quantidadeItens: 1 }),
      pedidoRow({ id: 2, importId: 1, pedidoId: "SEM_CUSTO", data: "2026-08-02", faturamento: 200, resultado: null, confianca: "bloqueado", quantidadeItens: 1 }),
    ];
    const itens = [
      itemRow({ id: 1, pedidoRowId: 1, itemId: "IT1", mlb: "MLBA", pedidoId: "COM_CUSTO", quantidade: 1, receitaProduto: 100, custoProduto: 40 }),
      itemRow({ id: 2, pedidoRowId: 2, itemId: "IT2", mlb: "MLBB", pedidoId: "SEM_CUSTO", quantidade: 1, receitaProduto: 200 }),
    ];
    const componentes = [
      componenteRow({ id: 1, pedidoRowId: 1, itemRowId: 1, pedidoId: "COM_CUSTO", itemId: "IT1", tipo: "custo_produto", valor: 40, escopo: "item", efeito: "debito", incluidoNoResultado: true }),
    ];
    const db = makeDb({ imports: [imp], pedidos, itens, componentes });
    const svc = svcFor(db);

    const respTodos = await svc.getCentralVendasRead(cliente.slug, { dateFrom: "2026-08-01", dateTo: "2026-08-31", resumoFiltro: "todos" });
    const respBloq = await svc.getCentralVendasRead(cliente.slug, { dateFrom: "2026-08-01", dateTo: "2026-08-31", resumoFiltro: "bloqueados" });

    eq("B: summary global sempre com os 2 pedidos, independente de resumoFiltro", respTodos.summary.pedidosTotal, 2);
    eq("B: summary global identico entre as duas chamadas (nunca reaproveita filteredSummary)", respBloq.summary, respTodos.summary);
    eq("B: filteredSummary('todos') = os 2 pedidos", respTodos.filteredSummary.pedidosTotal, 2);
    eq("B: filteredSummary('bloqueados') = so o pedido sem custo", respBloq.filteredSummary.pedidosTotal, 1);
    eq("B: filteredSummary('bloqueados').faturamento = so R$200", respBloq.filteredSummary.faturamento, 200);
    console.log("  ✓ B. filteredSummary é um contrato distinto de summary — nunca reaproveita o global com outro sentido");
  }

  // ── C. dataDe/dataAte recorta as rows (dia clicado), mas NUNCA o summary global ──
  {
    const imp = importRow({ id: 1, competencia: "2026-08", coverageFrom: "2026-08-01", coverageTo: "2026-08-31", publishedAt: "2026-08-01T10:00:00Z" });
    const pedidos = [
      pedidoRow({ id: 1, importId: 1, pedidoId: "DIA1", data: "2026-08-01", faturamento: 100 }),
      pedidoRow({ id: 2, importId: 1, pedidoId: "DIA2", data: "2026-08-05", faturamento: 200 }),
    ];
    const db = makeDb({ imports: [imp], pedidos });
    const resp = await svcFor(db).getCentralVendasRead(cliente.slug, { dateFrom: "2026-08-01", dateTo: "2026-08-31", dataDe: "2026-08-05", dataAte: "2026-08-05" });
    eq("C: rows só do dia clicado", resp.rows.map((r) => r.pedidoId), ["DIA2"]);
    eq("C: summary continua global (2 pedidos)", resp.summary.pedidosTotal, 2);
    console.log("  ✓ C. clique no dia recorta as rows via dataDe/dataAte, nunca o summary global");
  }

  // ── D. diagbase (com_custo/sem_custo) filtra as rows ──
  {
    const imp = importRow({ id: 1, competencia: "2026-08", coverageFrom: "2026-08-01", coverageTo: "2026-08-31", publishedAt: "2026-08-01T10:00:00Z" });
    const pedidos = [
      pedidoRow({ id: 1, importId: 1, pedidoId: "COM_CUSTO", data: "2026-08-01", faturamento: 100 }),
      pedidoRow({ id: 2, importId: 1, pedidoId: "SEM_CUSTO", data: "2026-08-02", faturamento: 200 }),
    ];
    const itens = [
      itemRow({ id: 1, pedidoRowId: 1, itemId: "IT1", mlb: "MLBA", pedidoId: "COM_CUSTO" }),
      itemRow({ id: 2, pedidoRowId: 2, itemId: "IT2", mlb: "MLBB", pedidoId: "SEM_CUSTO" }),
    ];
    const componentes = [
      componenteRow({ id: 1, pedidoRowId: 1, itemRowId: 1, pedidoId: "COM_CUSTO", itemId: "IT1", tipo: "custo_produto", valor: 40, escopo: "item", efeito: "debito", incluidoNoResultado: true }),
    ];
    const db = makeDb({ imports: [imp], pedidos, itens, componentes });
    const resp = await svcFor(db).getCentralVendasRead(cliente.slug, { dateFrom: "2026-08-01", dateTo: "2026-08-31", diagbase: "sem_custo" });
    eq("D: diagbase=sem_custo so retorna o pedido sem custo", resp.rows.map((r) => r.pedidoId), ["SEM_CUSTO"]);
    console.log("  ✓ D. diagbase (com_custo/sem_custo) filtra as rows no backend");
  }

  // ── E. Vendas por dia (/read/daily): agregado por data, período inteiro ──
  {
    const imp = importRow({ id: 1, competencia: "2026-08", coverageFrom: "2026-08-01", coverageTo: "2026-08-31", publishedAt: "2026-08-01T10:00:00Z" });
    const pedidos = [
      pedidoRow({ id: 1, importId: 1, pedidoId: "P1", data: "2026-08-01", faturamento: 100, quantidadeItens: 1 }),
      pedidoRow({ id: 2, importId: 1, pedidoId: "P2", data: "2026-08-01", faturamento: 50, quantidadeItens: 1, status: "cancelado" }),
      pedidoRow({ id: 3, importId: 1, pedidoId: "P3", data: "2026-08-02", faturamento: 300, quantidadeItens: 1, resultado: null, confianca: "bloqueado" }),
    ];
    const itens = [
      itemRow({ id: 1, pedidoRowId: 1, itemId: "IT1", mlb: "MLBA", pedidoId: "P1", receitaProduto: 100, custoProduto: 40 }),
      itemRow({ id: 3, pedidoRowId: 3, itemId: "IT3", mlb: "MLBC", pedidoId: "P3", receitaProduto: 300 }),
    ];
    const componentes = [
      componenteRow({ id: 1, pedidoRowId: 1, itemRowId: 1, pedidoId: "P1", itemId: "IT1", tipo: "custo_produto", valor: 40, escopo: "item", efeito: "debito", incluidoNoResultado: true }),
    ];
    const db = makeDb({ imports: [imp], pedidos, itens, componentes });
    const resp = await svcFor(db).getCentralVendasReadDaily(cliente.slug, { dateFrom: "2026-08-01", dateTo: "2026-08-31" });
    eq("E: 2 dias com pedido (calendário completo é responsabilidade do frontend)", resp.dias.length, 2);
    const dia1 = resp.dias.find((d) => d.data === "2026-08-01");
    eq("E: dia 1 tem 2 pedidos (inclui cancelado na contagem)", dia1.pedidos, 2);
    eq("E: dia 1 faturamento só do pedido válido (exclui cancelado)", dia1.faturamento, 100);
    eq("E: dia 1 cancelProblema = 1", dia1.cancelProblema, 1);
    const dia2 = resp.dias.find((d) => d.data === "2026-08-02");
    eq("E: dia 2 receita bloqueada = 300 (pedido sem custo)", dia2.receitaBloqueada, 300);
    eq("E: dia 2 custo = null (nenhum pedido do dia tem custo), nunca 0", dia2.custo, null);
    console.log("  ✓ E. /read/daily agrega por data — ausência nunca vira 0, cancelado fora do faturamento");
  }

  // ── F. Curva ABC (/read/products): classificação A/B/C e custo do catálogo (não do total do pedido) ──
  {
    const imp = importRow({ id: 1, competencia: "2026-08", coverageFrom: "2026-08-01", coverageTo: "2026-08-31", publishedAt: "2026-08-01T10:00:00Z" });
    // MULTI-ITEM: um pedido com 2 produtos diferentes. buildAbcProdutos
    // classifica pela mlb do primeiro item (honestidade M7) mas o custoUnit
    // tem de vir do CATÁLOGO daquele mlb, nunca de pedido.custo/unidades
    // (que somaria os dois produtos e daria um custo unitário errado).
    const pedidos = [
      pedidoRow({ id: 1, importId: 1, pedidoId: "MULTI", data: "2026-08-01", faturamento: 300, resultado: 100, quantidadeItens: 3 }),
      pedidoRow({ id: 2, importId: 1, pedidoId: "SO_A", data: "2026-08-02", faturamento: 700, resultado: 200, quantidadeItens: 1 }),
    ];
    // IT1B (mlb MLBB) vem ANTES de IT1A no array: buildPedidoContrato usa
    // itens[0] como "primeiro item" (honestidade M7) — aqui isso torna MLBB
    // o mlb representante da linha MULTI, deixando MLBA livre para
    // aparecer só no pedido SO_A (mono-produto), o que permite provar a
    // diferença entre custoUnit do catálogo vs. divisão do total do pedido.
    const itens = [
      itemRow({ id: 2, pedidoRowId: 1, itemId: "IT1B", mlb: "MLBB", pedidoId: "MULTI", quantidade: 2, receitaProduto: 200, custoProduto: 160 }),
      itemRow({ id: 1, pedidoRowId: 1, itemId: "IT1A", mlb: "MLBA", pedidoId: "MULTI", quantidade: 1, receitaProduto: 100, custoProduto: 40 }),
      itemRow({ id: 3, pedidoRowId: 2, itemId: "IT2A", mlb: "MLBA", pedidoId: "SO_A", quantidade: 1, receitaProduto: 700, custoProduto: 40 }),
    ];
    const componentes = [
      componenteRow({ id: 2, pedidoRowId: 1, itemRowId: 2, pedidoId: "MULTI", itemId: "IT1B", tipo: "custo_produto", valor: 160, escopo: "item", efeito: "debito", incluidoNoResultado: true }),
      componenteRow({ id: 1, pedidoRowId: 1, itemRowId: 1, pedidoId: "MULTI", itemId: "IT1A", tipo: "custo_produto", valor: 40, escopo: "item", efeito: "debito", incluidoNoResultado: true }),
      componenteRow({ id: 3, pedidoRowId: 2, itemRowId: 3, pedidoId: "SO_A", itemId: "IT2A", tipo: "custo_produto", valor: 40, escopo: "item", efeito: "debito", incluidoNoResultado: true }),
    ];
    const db = makeDb({ imports: [imp], pedidos, itens, componentes });
    const resp = await svcFor(db).getCentralVendasReadProducts(cliente.slug, { dateFrom: "2026-08-01", dateTo: "2026-08-31" });

    eq("F: total agregado = 2 (linha MULTI conta só pelo mlb representante, honestidade M7)", resp.produtos.length, 2);
    eq("F: totalFaturamento = soma dos 2 pedidos", resp.totalFaturamento, 1000);
    const mlbA = resp.produtos.find((p) => p.mlb === "MLBA");
    // custo unitário do catálogo (MLBA: custo_produto=40, quantidade=1 -> 40/1=40),
    // nunca pedido.custo/pedido.unidades do MULTI (que seria (40+160)/3 = 66.67, errado).
    eq("F: custoUnit vem do catálogo do MLB, não da divisão do total multi-item", mlbA.custoUnit, 40);
    eq("F: MLBA concentra 70% do faturamento (700 de 1000) -> curva A", mlbA.curva, "A");
    const mlbB = resp.produtos.find((p) => p.mlb === "MLBB");
    ok("F: MLBB (representa a linha MULTI) tem faturamento = valor total do pedido (soma dos itens, M5)", mlbB.faturamento === 300);
    console.log("  ✓ F. /read/products: curva ABC + custoUnit do catálogo (nunca do total multi-item do pedido)");
  }

  // ── G. Conta A nunca vê agregados (daily/products) da conta B ──
  {
    const contas = [
      { id: 10, cliente_id: 1, marketplace: "meli", nome: "ML 1", slug: "a1", external_account_id: "111", is_primary: true, ativo: true },
      { id: 11, cliente_id: 1, marketplace: "meli", nome: "ML 2", slug: "a2", external_account_id: "222", is_primary: false, ativo: true },
    ];
    const impA = importRow({ id: 1, competencia: "2026-08", coverageFrom: "2026-08-01", coverageTo: "2026-08-31", publishedAt: "2026-08-01T10:00:00Z", contaId: 10 });
    const impB = importRow({ id: 2, competencia: "2026-08", coverageFrom: "2026-08-01", coverageTo: "2026-08-31", publishedAt: "2026-08-01T10:00:00Z", contaId: 11 });
    const pedidos = [
      pedidoRow({ id: 1, importId: 1, pedidoId: "DA_CONTA_A", data: "2026-08-05", faturamento: 10 }),
      pedidoRow({ id: 2, importId: 2, pedidoId: "DA_CONTA_B", data: "2026-08-05", faturamento: 999 }),
    ];
    const db = makeDb({ contas, imports: [impA, impB], pedidos });
    const svc = svcFor(db);
    const dailyA = await svc.getCentralVendasReadDaily(cliente.slug, { dateFrom: "2026-08-01", dateTo: "2026-08-31", clienteContaId: 10 });
    const productsA = await svc.getCentralVendasReadProducts(cliente.slug, { dateFrom: "2026-08-01", dateTo: "2026-08-31", clienteContaId: 10 });
    eq("G: daily da conta A não inclui faturamento da conta B", dailyA.dias[0].faturamento, 10);
    eq("G: products da conta A não inclui pedido da conta B", productsA.totalFaturamento, 10);
    console.log("  ✓ G. account-aware: /read/daily e /read/products nunca misturam conta A com conta B");
  }

  console.log(`centralVendasM9ReadAggregates.test.js: ${checks} verificacoes OK`);
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
