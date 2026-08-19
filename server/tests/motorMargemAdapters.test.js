// server/tests/motorMargemAdapters.test.js
// Testes dos ADAPTERS de fonte do Motor de Margem.
// Banco e Mercado Livre são falsificados: nenhum acesso real, nenhuma escrita.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const baseCustos = require("../services/motorMargem/adapters/baseCustosEvidenceAdapter");
const centralVendas = require("../services/motorMargem/adapters/centralVendasEvidenceAdapter");
const settlement = require("../services/motorMargem/adapters/settlementEvidenceAdapter");
const extensao = require("../services/motorMargem/adapters/extensionEvidenceAdapter");
const meliApi = require("../services/motorMargem/adapters/meliApiEvidenceAdapter");
const quoteService = require("../services/shared/marketplaceCurrentQuoteService");
const C = require("../services/motorMargem/core");

const casos = [];
function cenario(nome, fn) {
  casos.push({ nome, fn });
}

// Banco falso que despacha por trecho do SQL.
function fakeDb(handlers) {
  const chamadas = [];
  return {
    chamadas,
    async query(sql, params) {
      chamadas.push({ sql, params });
      for (const [trecho, rows] of Object.entries(handlers)) {
        if (sql.includes(trecho)) return { rows: typeof rows === "function" ? rows(params) : rows };
      }
      return { rows: [] };
    },
  };
}

// ── Base de custos ───────────────────────────────────────────────────────────

cenario("índice de custos casa MLB com e sem prefixo", () => {
  const index = baseCustos.buildCostIndex([
    { produto_id: "MLB1234567890", custo_produto: 40, imposto_percentual: 0.1, taxa_fixa: 2 },
    { produto_id: "9876543210", custo_produto: 15, imposto_percentual: 0.08, taxa_fixa: 0 },
  ]);

  assert.strictEqual(baseCustos.lookupCost(index, "MLB1234567890").cost, 40);
  assert.strictEqual(baseCustos.lookupCost(index, "mlb1234567890").cost, 40);
  assert.strictEqual(baseCustos.lookupCost(index, "1234567890").cost, 40);
  // Base sem prefixo × anúncio com prefixo (caso real do Otimizador).
  assert.strictEqual(baseCustos.lookupCost(index, "MLB9876543210").cost, 15);
  assert.strictEqual(baseCustos.lookupCost(index, "MLB0000000000"), null);
});

cenario("imposto é normalizado para decimal nas duas escalas", () => {
  assert.strictEqual(baseCustos.normalizarAliquota(0.12), 0.12, "decimal permanece decimal");
  assert.strictEqual(baseCustos.normalizarAliquota(12), 0.12, "escala 0–100 vira decimal");
  assert.strictEqual(baseCustos.normalizarAliquota(0), 0, "zero real é preservado");
  assert.strictEqual(baseCustos.normalizarAliquota(null), null, "ausente continua ausente");
  assert.strictEqual(baseCustos.normalizarAliquota(-1), null, "negativo é inválido, não 0");
});

cenario("item sem linha na base não gera evidência de custo", () => {
  const index = baseCustos.buildCostIndex([
    { produto_id: "MLB1", custo_produto: 40, imposto_percentual: 0.1, taxa_fixa: 0 },
  ]);
  const bag = C.createEvidenceBag();

  assert.strictEqual(
    baseCustos.aplicarEvidenciasDeCusto(bag, { itemId: "MLB999", index, baseSlug: "b" }),
    false
  );
  assert.deepStrictEqual(bag.list(C.FIELDS.COST), [], "nada foi inventado");

  assert.strictEqual(
    baseCustos.aplicarEvidenciasDeCusto(bag, { itemId: "MLB1", index, baseSlug: "b" }),
    true
  );
  assert.strictEqual(bag.list(C.FIELDS.COST)[0].value, 40);
  assert.strictEqual(bag.list(C.FIELDS.COST)[0].source, C.SOURCES.VENFORCE_BASE);
  assert.strictEqual(bag.list(C.FIELDS.COST)[0].quality, C.EVIDENCE_QUALITY.DECLARED);
});

cenario("marketplace: apenas MELI nesta rodada (Shopee/TikTok bloqueados)", () => {
  assert.strictEqual(baseCustos.marketplaceSuportado("meli"), true);
  assert.strictEqual(baseCustos.marketplaceSuportado("shopee"), false);
  assert.strictEqual(baseCustos.marketplaceSuportado("tiktok"), false);
});

cenario("carregarCustosDaBase só executa SELECT", async () => {
  const db = fakeDb({
    "FROM custos": [
      { produto_id: "MLB1", custo_produto: 10, imposto_percentual: 0.1, taxa_fixa: 0, updated_at: null },
    ],
  });
  const resultado = await baseCustos.carregarCustosDaBase({ baseId: 7 }, db);

  assert.strictEqual(resultado.total, 1);
  assert.strictEqual(db.chamadas.length, 1);
  const sql = db.chamadas[0].sql.toUpperCase();
  assert.ok(sql.includes("SELECT"), "é leitura");
  // Palavra inteira: `updated_at` na projeção não pode ser lido como UPDATE.
  for (const proibido of ["INSERT", "UPDATE", "DELETE", "ALTER", "DROP", "TRUNCATE"]) {
    assert.ok(!new RegExp(`\\b${proibido}\\b`).test(sql), `adapter não pode conter ${proibido}`);
  }
});

// ── Central de Vendas (realizado) ────────────────────────────────────────────

const PEDIDOS = [
  { id: 1, pedido_id: "P1", status: "pago", data_pedido: "2026-08-01" },
  { id: 2, pedido_id: "P2", status: "pago", data_pedido: "2026-08-05" },
  // P3 cancelado: sai do CÁLCULO PRINCIPAL, mas item único + reembolso não
  // podem desaparecer da evidência (AUDITORIA §Reembolsos).
  { id: 3, pedido_id: "P3", status: "cancelado", data_pedido: "2026-08-06" },
];

const ITENS = [
  { id: 10, pedido_row_id: 1, mlb: "MLB1", sku: "SKU-1", titulo: "Item 1", quantidade: 2, valor_unitario: 100, receita_produto: 200, custo_produto: 80, imposto_interno: 20, resultado: 30 },
  { id: 11, pedido_row_id: 2, mlb: "MLB1", sku: "SKU-1", titulo: "Item 1", quantidade: 1, valor_unitario: 110, receita_produto: 110, custo_produto: 44, imposto_interno: 11, resultado: 18 },
  { id: 12, pedido_row_id: 2, mlb: "MLB2", sku: "SKU-2", titulo: "Item 2", quantidade: 1, valor_unitario: 50, receita_produto: 50, custo_produto: null, imposto_interno: null, resultado: 5 },
  { id: 13, pedido_row_id: 3, mlb: "MLB3", sku: "SKU-3", titulo: "Item 3", quantidade: 1, valor_unitario: 90, receita_produto: 90, custo_produto: 30, imposto_interno: 9, resultado: null },
];

const COMPONENTES = [
  { item_row_id: 10, pedido_row_id: 1, tipo: "tarifa_venda", valor: -24, fonte: "orders_api" },
  { item_row_id: 10, pedido_row_id: 1, tipo: "frete_seller", valor: -40, fonte: "shipments_api" },
  { item_row_id: 11, pedido_row_id: 2, tipo: "tarifa_venda", valor: -13.2, fonte: "orders_api" },
  { item_row_id: 11, pedido_row_id: 2, tipo: "frete_seller", valor: null, fonte: "ausente" },
  { item_row_id: 12, pedido_row_id: 2, tipo: "tarifa_venda", valor: -6, fonte: "orders_api" },
  // Reembolso de pedido MULTI-item (P2 tem MLB1 e MLB2): não pode ser atribuído.
  { item_row_id: null, pedido_row_id: 2, tipo: "cancelamento_reembolso", valor: -30, fonte: "orders_api_payments" },
  // Reembolso de pedido de item ÚNICO (P1 só tem MLB1): atribuível.
  { item_row_id: null, pedido_row_id: 1, tipo: "cancelamento_reembolso", valor: -20, fonte: "orders_api_payments" },
  // Reembolso de pedido CANCELADO (P3, item único MLB3): fato financeiro real,
  // não pode sumir só porque o pedido saiu do resultado principal.
  { item_row_id: null, pedido_row_id: 3, tipo: "cancelamento_reembolso", valor: -90, fonte: "orders_api_payments" },
];

cenario("carregarVendasDoPeriodo delega para a projeção canônica da Central de Vendas", async () => {
  const db = fakeDb({
    "FROM central_vendas_imports": [
      { id: 100, competencia: "2026-08", fonte: "orders_api", created_at: "2026-08-10T12:00:00Z", publication_status: "legacy" },
    ],
    "FROM central_vendas_pedidos": PEDIDOS,
    "FROM central_vendas_pedido_itens": ITENS,
    "FROM central_vendas_componentes": COMPONENTES,
  });

  const vendas = await centralVendas.carregarVendasDoPeriodo(
    { clienteSlug: "c", dateFrom: "2026-08-01", dateTo: "2026-08-31" },
    db
  );

  assert.strictEqual(vendas.sincronizado, true);
  // `pedidos` (compat): só os que entram no resultado — mesmo predicado do
  // Fechamento e do Cliente 360. P3 (cancelado) sai.
  assert.deepStrictEqual(vendas.pedidos.map((p) => p.pedido_id), ["P1", "P2"]);
  // `pedidosTodos` preserva P3 — é o que sustenta a auditoria de reembolso.
  assert.deepStrictEqual(vendas.pedidosTodos.map((p) => p.pedido_id), ["P1", "P2", "P3"]);
  // itens/componentes cobrem TODO o período, não só os pedidos do resultado —
  // sem isso o reembolso de P3 nunca chegaria a `agregarPorMlb`.
  assert.strictEqual(vendas.itens.length, ITENS.length);
  assert.strictEqual(vendas.componentes.length, COMPONENTES.length);
  assert.ok(vendas.importSnapshotAt, "timestamp do snapshot disponível como fallback");
  // Nenhuma consulta própria: é a MESMA leitura de sempre (M4: published/legacy
  // mais recente por competência — nunca "qualquer import", nunca candidate).
  assert.ok(db.chamadas[0].sql.includes("FROM central_vendas_imports"));
  assert.ok(db.chamadas[0].sql.includes("publication_status IN ('published', 'legacy')"));
});

cenario("sem import no período → realizado inexistente, não zerado", async () => {
  const db = fakeDb({ "FROM central_vendas_imports": [] });
  const vendas = await centralVendas.carregarVendasDoPeriodo(
    { clienteSlug: "c", dateFrom: "2026-08-01", dateTo: "2026-08-31" },
    db
  );
  assert.strictEqual(vendas.sincronizado, false);
  assert.deepStrictEqual(vendas.pedidos, []);
  assert.deepStrictEqual(vendas.pedidosTodos, []);
  assert.strictEqual(vendas.importSnapshotAt, null);
  assert.strictEqual(db.chamadas.length, 1, "não consulta pedidos sem import");
});

cenario("agregação por MLB converte totais em valor por unidade, incluindo custo/imposto históricos", () => {
  const { porMlb } = centralVendas.agregarPorMlb({
    pedidosTodos: PEDIDOS,
    pedidosResultado: PEDIDOS.slice(0, 2),
    itens: ITENS,
    componentes: COMPONENTES,
  });

  const mlb1 = porMlb.get("MLB1");
  assert.strictEqual(mlb1.unidades, 3, "2 + 1 unidades");
  assert.strictEqual(mlb1.receita, 310, "200 + 110");
  assert.strictEqual(mlb1.pedidos.size, 2);
  assert.strictEqual(mlb1.ultimaVendaEm, "2026-08-05");
  assert.strictEqual(mlb1.comissao.soma, 37.2, "24 + 13,20 (sinal absoluto)");
  assert.strictEqual(mlb1.comissao.itensComValor, 2);
  assert.strictEqual(mlb1.frete.soma, 40, "só a linha que tinha frete real");
  assert.strictEqual(mlb1.frete.itensComValor, 1, "cobertura parcial de frete");
  // Custo/imposto: histórico persistido pela Central de Vendas, nunca a Base
  // atual (AUDITORIA §3/§4).
  assert.strictEqual(mlb1.custo.soma, 124, "80 + 44");
  assert.strictEqual(mlb1.custo.itensComValor, 2);
  assert.strictEqual(mlb1.imposto.soma, 31, "20 + 11");
  assert.strictEqual(mlb1.imposto.itensComValor, 2);

  const mlb2 = porMlb.get("MLB2");
  assert.strictEqual(mlb2.custo.itensComValor, 0, "sem custo histórico persistido para este item");

  // MLB3 só existe em pedido cancelado (fora do resultado): não entra na
  // agregação principal — mas ver reembolso abaixo.
  assert.strictEqual(porMlb.has("MLB3"), false);
});

cenario("reembolso é classificado em 3 estados e sobrevive ao status do pedido", () => {
  const { reembolsoPorMlb, naoAtribuido, reembolsos } = centralVendas.agregarPorMlb({
    pedidosTodos: PEDIDOS,
    pedidosResultado: PEDIDOS.slice(0, 2),
    itens: ITENS,
    componentes: COMPONENTES,
  });

  // P1 (item único, no resultado): atribuído ao MLB1.
  assert.strictEqual(reembolsoPorMlb.get("MLB1").soma, 20, "reembolso do pedido P1");
  // P2 (multi-item): não é rateado por chute entre MLB1/MLB2.
  assert.strictEqual(reembolsoPorMlb.has("MLB2"), false);
  // P3 (item único, CANCELADO — fora do cálculo principal): o reembolso NÃO
  // desaparece; continua atribuído ao MLB3.
  assert.strictEqual(reembolsoPorMlb.get("MLB3").soma, 90, "reembolso de pedido cancelado não some");

  assert.strictEqual(reembolsos.atribuidoMlb, 110, "20 (P1) + 90 (P3)");
  assert.strictEqual(reembolsos.atribuidoPedido, 30, "P2, multi-item");
  assert.strictEqual(reembolsos.naoAtribuivel, 0);
  // Compat: soma do que não pôde ir para 1 MLB.
  assert.strictEqual(naoAtribuido.reembolso, 30);
});

cenario("aplicarEvidenciaReembolso registra o reembolso mesmo sem venda computável no período", () => {
  const { reembolsoPorMlb } = centralVendas.agregarPorMlb({
    pedidosTodos: PEDIDOS,
    pedidosResultado: PEDIDOS.slice(0, 2),
    itens: ITENS,
    componentes: COMPONENTES,
  });

  const bag = C.createEvidenceBag();
  // MLB3 não tem entrada em `porMlb` (pedido cancelado, sem venda computável)
  // — o reembolso ainda assim precisa virar evidência.
  const resumo = centralVendas.aplicarEvidenciaReembolso(bag, {
    reembolso: reembolsoPorMlb.get("MLB3"),
    fallbackObservedAt: "2026-08-10T12:00:00.000Z",
  });

  assert.strictEqual(resumo.reembolsoTotal, 90);
  const evidencia = bag.list(C.FIELDS.REFUNDS)[0];
  assert.strictEqual(evidencia.value, 90);
  assert.strictEqual(evidencia.kind, C.EVIDENCE_KINDS.REALIZED);

  const bagVazio = C.createEvidenceBag();
  assert.strictEqual(centralVendas.aplicarEvidenciaReembolso(bagVazio, { reembolso: null }), null);
  assert.deepStrictEqual(bagVazio.fields(), []);
});

cenario("cobertura parcial de frete vira evidência ESTIMATED; custo/imposto completos viram DECLARED", () => {
  const { porMlb } = centralVendas.agregarPorMlb({
    pedidosTodos: PEDIDOS,
    pedidosResultado: PEDIDOS.slice(0, 2),
    itens: ITENS,
    componentes: COMPONENTES,
  });

  const bag = C.createEvidenceBag();
  const resumo = centralVendas.aplicarEvidenciasRealizadas(bag, { agregado: porMlb.get("MLB1") });

  assert.strictEqual(resumo.unidades, 3);
  assert.strictEqual(resumo.precoUnitarioMedio, 103.33, "310 / 3");
  assert.strictEqual(resumo.freteCobertura, 0.5, "1 de 2 linhas com frete");
  assert.strictEqual(resumo.custoCobertura, 1, "2 de 2 linhas com custo histórico");
  assert.strictEqual(resumo.impostoCobertura, 1, "2 de 2 linhas com imposto histórico");

  const frete = bag.list(C.FIELDS.FREIGHT)[0];
  assert.strictEqual(frete.value, 40 / 3, "frete total rateado por unidade");
  assert.strictEqual(frete.quality, C.EVIDENCE_QUALITY.ESTIMATED, "cobertura parcial rebaixa");

  const comissao = bag.list(C.FIELDS.COMMISSION)[0];
  assert.strictEqual(comissao.quality, C.EVIDENCE_QUALITY.DERIVED, "cobertura total");

  const custo = bag.list(C.FIELDS.COST)[0];
  assert.strictEqual(custo.value, 124 / 3, "custo histórico total rateado por unidade");
  assert.strictEqual(custo.source, C.SOURCES.VENFORCE_BASE);
  assert.strictEqual(custo.kind, C.EVIDENCE_KINDS.REALIZED);
  assert.strictEqual(custo.quality, C.EVIDENCE_QUALITY.DECLARED, "cobertura total");

  const taxRate = bag.list(C.FIELDS.TAX_RATE)[0];
  assert.strictEqual(taxRate.value, 31 / 310, "imposto histórico / receita histórica");

  // Taxa fixa: SEM contrapartida histórica — nunca registrada no realizado.
  assert.deepStrictEqual(bag.list(C.FIELDS.FIXED_FEE), []);

  // O ESTIMATED do frete precisa chegar até a confiança da variável.
  const campo = C.resolveField(C.FIELDS.FREIGHT, bag.list(C.FIELDS.FREIGHT));
  const classificacao = C.classifyField(campo, { hasOrders: true });
  assert.ok(
    classificacao.reasons.some((r) => r.code === C.REASONS.VALOR_ESTIMADO),
    "motivo VALOR_ESTIMADO presente"
  );
});

cenario("sem nenhum custo histórico persistido, fica ausente — nunca a Base atual", () => {
  const { porMlb } = centralVendas.agregarPorMlb({
    pedidosTodos: PEDIDOS,
    pedidosResultado: PEDIDOS.slice(0, 2),
    itens: ITENS,
    componentes: COMPONENTES,
  });

  const bag = C.createEvidenceBag();
  // MLB2 tem 1 linha, sem custo/imposto histórico persistido.
  centralVendas.aplicarEvidenciasRealizadas(bag, { agregado: porMlb.get("MLB2") });
  assert.deepStrictEqual(bag.list(C.FIELDS.COST), [], "sem histórico, sem evidência — nunca a Base atual");
  assert.deepStrictEqual(bag.list(C.FIELDS.TAX_RATE), []);
});

cenario("anúncio sem venda não produz evidência realizada", () => {
  const bag = C.createEvidenceBag();
  assert.strictEqual(centralVendas.aplicarEvidenciasRealizadas(bag, { agregado: null }), null);
  assert.deepStrictEqual(bag.fields(), []);
});

// ── Timestamp do realizado (AUDITORIA_ARQUITETURAL_CENTRAL_MARGEM §Timestamp) ─

cenario("timestamp do realizado é a data da venda, nunca o instante da requisição", () => {
  const { porMlb } = centralVendas.agregarPorMlb({
    pedidosTodos: PEDIDOS,
    pedidosResultado: PEDIDOS.slice(0, 2),
    itens: ITENS,
    componentes: COMPONENTES,
  });

  const bag = C.createEvidenceBag();
  // Nenhum "agora" de requisição é passado — só o fallback do snapshot, bem
  // diferente de qualquer "now" de teste.
  centralVendas.aplicarEvidenciasRealizadas(bag, {
    agregado: porMlb.get("MLB1"),
    fallbackObservedAt: "2020-01-01T00:00:00.000Z",
  });

  const preco = bag.list(C.FIELDS.PRICE)[0];
  // ultimaVendaEm (2026-08-05) tem prioridade sobre o fallback do snapshot.
  assert.ok(preco.observedAt.startsWith("2026-08-05"), `observedAt foi ${preco.observedAt}`);
});

function agregadoSemDataDeVenda() {
  return {
    unidades: 1,
    receita: 100,
    itensContados: 1,
    pedidos: new Set(["1"]),
    ultimaVendaEm: null,
    comissao: { soma: 0, itensComValor: 0 },
    frete: { soma: 0, itensComValor: 0 },
    custo: { soma: 0, itensComValor: 0 },
    imposto: { soma: 0, itensComValor: 0 },
    resultadoPersistido: { soma: 0, itensComValor: 0 },
    precoUnitarioMin: 100,
    precoUnitarioMax: 100,
  };
}

cenario("timestamp cai para o snapshot do import quando não há data de venda segura", () => {
  const bag = C.createEvidenceBag();
  centralVendas.aplicarEvidenciasRealizadas(bag, {
    agregado: agregadoSemDataDeVenda(),
    fallbackObservedAt: "2026-08-09T08:00:00.000Z",
  });
  const preco = bag.list(C.FIELDS.PRICE)[0];
  assert.strictEqual(preco.observedAt, "2026-08-09T08:00:00.000Z");
});

cenario("sem data de venda e sem snapshot, observedAt fica null — nunca inventa", () => {
  const bag = C.createEvidenceBag();
  centralVendas.aplicarEvidenciasRealizadas(bag, { agregado: agregadoSemDataDeVenda() });
  const preco = bag.list(C.FIELDS.PRICE)[0];
  assert.strictEqual(preco.observedAt, null);
});

// ── Fontes indisponíveis ─────────────────────────────────────────────────────

cenario("Mercado Pago reporta indisponibilidade com motivo estável", () => {
  assert.strictEqual(settlement.mercadoPagoDisponivel(), false);

  const comVenda = settlement.avaliarConciliacao({ hasOrders: true });
  assert.strictEqual(comVenda.available, false);
  assert.strictEqual(comVenda.motivo, settlement.MOTIVOS.NAO_INTEGRADO);

  const semVenda = settlement.avaliarConciliacao({ hasOrders: false });
  assert.strictEqual(semVenda.motivo, settlement.MOTIVOS.SEM_VENDA);
});

cenario("extensão não tem canal de ingestão, mas a função de ingestão funciona", () => {
  const coleta = extensao.coletar();
  assert.strictEqual(coleta.disponivel, false);
  assert.deepStrictEqual(coleta.observacoes, []);

  const bag = C.createEvidenceBag();
  assert.strictEqual(extensao.aplicarEvidenciasDom(bag, coleta), 0);

  // Pronta para o dia em que a extensão enviar observações.
  const registradas = extensao.aplicarEvidenciasDom(bag, {
    observacoes: [
      { field: C.FIELDS.PRICE, value: 99.9 },
      { field: C.FIELDS.COST, value: 10 }, // campo não aceito do DOM
    ],
    observedAt: new Date("2026-08-12T00:00:00Z"),
  });
  assert.strictEqual(registradas, 1, "custo nunca vem do DOM");
  assert.strictEqual(bag.list(C.FIELDS.PRICE)[0].source, C.SOURCES.EXTENSION_DOM);
});

// ── Cotação corrente compartilhada (shared/marketplaceCurrentQuoteService) ───
// Extraída do Motor nesta refatoração (AUDITORIA §7) — Automações e
// Diagnóstico continuam com cópia própria por enquanto (migração deles é a
// próxima rodada), mas o Motor já consome só este módulo.

cenario("comissão do ML é convertida de 0–100 para decimal; falha vira null", async () => {
  const fetchOk = async (clienteId, path) => {
    if (path.includes("listing_prices")) {
      return { ok: true, data: [{ sale_fee_amount: 12.5, sale_fee_details: { percentage_fee: 12.5 } }] };
    }
    if (path.includes("shipping_options/free")) {
      return { ok: true, data: { coverage: { all_country: { list_cost: 23.4 } } } };
    }
    return { ok: false, status: 404, data: null };
  };

  const resultado = await quoteService.buscarComissaoEFrete(
    {
      clienteId: 1,
      itemId: "MLB1",
      precoEfetivo: 100,
      listingTypeId: "gold_special",
      categoryId: "MLB1234",
      sellerId: "9",
      logisticType: "drop_off",
    },
    fetchOk
  );
  assert.strictEqual(resultado.comissaoValor, 12.5);
  assert.strictEqual(resultado.comissaoPercentual, 0.125, "percentual vira decimal");
  assert.strictEqual(resultado.fretePrevisto, 23.4);

  const fetchErro = async () => ({ ok: false, status: 500, data: null });
  const semDados = await quoteService.buscarComissaoEFrete(
    {
      clienteId: 1,
      itemId: "MLB1",
      precoEfetivo: 100,
      listingTypeId: "gold_special",
      categoryId: "MLB1234",
      sellerId: "9",
      logisticType: "drop_off",
    },
    fetchErro
  );
  assert.strictEqual(semDados.comissaoValor, null, "falha da API vira ausente, nunca 0");
  assert.strictEqual(semDados.fretePrevisto, null);
});

cenario("frete combinável não é consultado (não existe frete previsto)", async () => {
  const paths = [];
  const fetchFn = async (clienteId, path) => {
    paths.push(path);
    return { ok: true, data: [{ sale_fee_amount: 10, sale_fee_details: { percentage_fee: 10 } }] };
  };

  const resultado = await quoteService.buscarComissaoEFrete(
    {
      clienteId: 1,
      itemId: "MLB1",
      precoEfetivo: 100,
      listingTypeId: "gold_special",
      categoryId: "MLB1",
      sellerId: "9",
      logisticType: "not_specified",
    },
    fetchFn
  );

  assert.strictEqual(resultado.fretePrevisto, null);
  assert.ok(!paths.some((p) => p.includes("shipping_options")), "nenhuma chamada de frete");
});

cenario("obterCotacaoAtual junta preço + comissão + frete num contrato único", async () => {
  const cotacao = await quoteService.obterCotacaoAtual(
    {
      clienteId: 1,
      itemId: "MLB1",
      listingTypeId: "gold_special",
      categoryId: "MLB1",
      sellerId: "9",
      logisticType: "drop_off",
    },
    {
      resolverPrecosItemFn: async () => ({
        precoCheio: 120, precoPromocional: 100, precoEfetivo: 100, fonte: "sale_price",
      }),
      mlFetchFn: async (clienteId, path) =>
        path.includes("listing_prices")
          ? { ok: true, data: [{ sale_fee_amount: 12, sale_fee_details: { percentage_fee: 12 } }] }
          : { ok: true, data: { coverage: { all_country: { list_cost: 20 } } } },
    }
  );

  assert.strictEqual(cotacao.precoAtual, 100);
  assert.strictEqual(cotacao.precoOriginal, 120);
  assert.strictEqual(cotacao.precoPromocional, 100);
  assert.strictEqual(cotacao.comissaoValor, 12);
  assert.strictEqual(cotacao.comissaoPercentual, 0.12);
  assert.strictEqual(cotacao.fretePrevisto, 20);
  assert.deepStrictEqual(cotacao.faltantes, []);
});

cenario("aplicarEvidenciasProjetadas registra preço, comissão e frete do ML", async () => {
  const bag = C.createEvidenceBag();
  const observado = await meliApi.aplicarEvidenciasProjetadas(
    bag,
    {
      clienteId: 1,
      body: {
        id: "MLB1",
        title: "Produto",
        price: 120,
        listing_type_id: "gold_special",
        category_id: "MLB1",
        seller_id: "9",
        status: "active",
        shipping: { logistic_type: "drop_off" },
      },
      observedAt: new Date("2026-08-12T00:00:00Z"),
    },
    {
      resolverPrecosItemFn: async () => ({
        precoCheio: 120,
        precoPromocional: 100,
        precoEfetivo: 100,
        fonte: "sale_price",
      }),
      mlFetchFn: async (clienteId, path) =>
        path.includes("listing_prices")
          ? { ok: true, data: [{ sale_fee_amount: 12, sale_fee_details: { percentage_fee: 12 } }] }
          : { ok: true, data: { coverage: { all_country: { list_cost: 20 } } } },
    }
  );

  assert.strictEqual(observado.itemId, "MLB1");
  assert.deepStrictEqual(observado.faltantes, []);
  assert.strictEqual(bag.list(C.FIELDS.PRICE)[0].value, 100, "preço efetivo é o promocional");
  assert.strictEqual(bag.list(C.FIELDS.LIST_PRICE)[0].value, 120);
  assert.strictEqual(bag.list(C.FIELDS.PROMO_PRICE)[0].value, 100);
  assert.strictEqual(bag.list(C.FIELDS.COMMISSION)[0].value, 12);
  assert.strictEqual(bag.list(C.FIELDS.COMMISSION_RATE)[0].value, 0.12);
  assert.strictEqual(bag.list(C.FIELDS.FREIGHT)[0].value, 20);
  assert.ok(bag.list(C.FIELDS.PRICE).every((e) => e.source === C.SOURCES.MELI_API));
});

// ── Imagem do anúncio (metadado de identidade, zero request extra) ──────────

cenario("extrairImagem prioriza secure_thumbnail, depois thumbnail, depois pictures[0]", () => {
  assert.strictEqual(
    meliApi.extrairImagem({ secure_thumbnail: "https://x/a.jpg", thumbnail: "https://x/b.jpg" }),
    "https://x/a.jpg"
  );
  assert.strictEqual(meliApi.extrairImagem({ thumbnail: "https://x/b.jpg" }), "https://x/b.jpg");
  assert.strictEqual(
    meliApi.extrairImagem({ pictures: [{ secure_url: "https://x/c.jpg" }] }),
    "https://x/c.jpg"
  );
  assert.strictEqual(meliApi.extrairImagem({ pictures: [{ url: "https://x/d.jpg" }] }), "https://x/d.jpg");
});

cenario("extrairImagem nunca inventa imagem quando o contrato não trouxe nenhuma", () => {
  assert.strictEqual(meliApi.extrairImagem({}), null);
  assert.strictEqual(meliApi.extrairImagem({ thumbnail: "" }), null);
  assert.strictEqual(meliApi.extrairImagem({ pictures: [] }), null);
  assert.strictEqual(meliApi.extrairImagem(null), null);
});

cenario("aplicarEvidenciasProjetadas propaga a imagem do MESMO body, sem request novo", async () => {
  const bag = C.createEvidenceBag();
  const chamadasMl = [];
  const observado = await meliApi.aplicarEvidenciasProjetadas(
    bag,
    {
      clienteId: 1,
      body: {
        id: "MLB1",
        title: "Produto",
        price: 120,
        secure_thumbnail: "https://http2.mlstatic.com/D_NQ_NP_123.jpg",
        listing_type_id: "gold_special",
        category_id: "MLB1",
        seller_id: "9",
        status: "active",
        shipping: { logistic_type: "drop_off" },
      },
      observedAt: new Date("2026-08-12T00:00:00Z"),
    },
    {
      resolverPrecosItemFn: async () => ({
        precoCheio: 120, precoPromocional: null, precoEfetivo: 120, fonte: "sale_price",
      }),
      mlFetchFn: async (clienteId, path) => {
        chamadasMl.push(path);
        return path.includes("listing_prices")
          ? { ok: true, data: [{ sale_fee_amount: 12, sale_fee_details: { percentage_fee: 12 } }] }
          : { ok: true, data: { coverage: { all_country: { list_cost: 20 } } } };
      },
    }
  );

  assert.strictEqual(observado.image, "https://http2.mlstatic.com/D_NQ_NP_123.jpg");
  // Nenhuma chamada extra ao ML só para buscar imagem — as 2 chamadas são
  // as mesmas de sempre (listing_prices + shipping_options).
  assert.strictEqual(chamadasMl.length, 2);
});

cenario("aplicarEvidenciasProjetadas devolve image null quando o ML não trouxe nenhuma", async () => {
  const bag = C.createEvidenceBag();
  const observado = await meliApi.aplicarEvidenciasProjetadas(
    bag,
    { clienteId: 1, body: { id: "MLB2", title: "Sem foto", price: 50 }, observedAt: new Date() },
    {
      resolverPrecosItemFn: async () => ({ precoCheio: 50, precoPromocional: null, precoEfetivo: 50, fonte: "sale_price" }),
      mlFetchFn: async () => ({ ok: false, status: 404, data: null }),
    }
  );
  assert.strictEqual(observado.image, null);
});

// ── Runner ───────────────────────────────────────────────────────────────────

async function main() {
  let falhas = 0;
  for (const caso of casos) {
    try {
      await caso.fn();
      console.log(`  ✓ ${caso.nome}`);
    } catch (err) {
      falhas += 1;
      console.error(`  ✗ ${caso.nome}\n    ${err.message}`);
    }
  }
  if (falhas > 0) {
    console.error(`motorMargemAdapters: ${falhas} de ${casos.length} cenários falharam`);
    process.exitCode = 1;
  } else {
    console.log(`motorMargemAdapters: ok (${casos.length} cenários)`);
  }
}

main();
