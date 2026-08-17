// server/tests/motorMargemApi.test.js
// Testes do ORQUESTRADOR + contrato da API read-only da Central de Margem.
// Todas as dependências externas (contexto, base, Central de Vendas, ML) são
// injetadas: o teste roda sem banco, sem token e sem rede.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const service = require("../services/motorMargem/motorMargemService");
const controller = require("../controllers/motorMargemController");
const C = require("../services/motorMargem/core");

const NOW = new Date("2026-08-12T12:00:00.000Z");

const casos = [];
function cenario(nome, fn) {
  casos.push({ nome, fn });
}

// ── Cenário base ─────────────────────────────────────────────────────────────
// MLB1 saudável e vendido · MLB2 sem custo na base · MLB3 com frete divergente.

const CLIENTE = { id: 1, nome: "Cliente Teste", slug: "cliente-teste" };
const BASE = { id: 9, slug: "base-teste", nome: "Base Teste" };

const CUSTOS = new Map([
  ["MLB1", { produtoId: "MLB1", cost: 40, taxRate: 0.1, fixedFee: 0, observedAt: null }],
  ["MLB3", { produtoId: "MLB3", cost: 60, taxRate: 0.1, fixedFee: 0, observedAt: null }],
]);

const ANUNCIOS = {
  MLB1: { price: 100, commission: 12, commissionRate: 0.12, freight: 20, titulo: "Produto 1" },
  MLB2: { price: 80, commission: 9.6, commissionRate: 0.12, freight: 15, titulo: "Produto 2" },
  MLB3: { price: 100, commission: 12, commissionRate: 0.12, freight: 10, titulo: "Produto 3" },
};

function depsPadrao(overrides = {}) {
  return {
    now: NOW,
    exigirContexto: async () => ({ cliente: CLIENTE, base: BASE, mlUserId: "99" }),
    carregarCustos: async () => ({ index: CUSTOS, total: CUSTOS.size }),
    carregarVendas: async () => ({
      sincronizado: true,
      imports: [{ id: 1 }],
      pedidos: [{ id: 1, pedido_id: "P1", status: "pago", data_pedido: "2026-08-05" }],
      itens: [],
      componentes: [],
    }),
    agregarPorMlb: () => ({
      porMlb: new Map([
        [
          "MLB1",
          {
            mlb: "MLB1",
            sku: "SKU-1",
            titulo: "Produto 1",
            unidades: 2,
            receita: 200,
            itensContados: 1,
            pedidos: new Set(["1"]),
            ultimaVendaEm: "2026-08-05",
            comissao: { soma: 24, itensComValor: 1 },
            frete: { soma: 40, itensComValor: 1 },
            // Histórico persistido pela Central de Vendas — mesmos valores da
            // Base neste fixture (cost 40, taxRate 0.1), mas por um caminho
            // INDEPENDENTE: ver teste dedicado provando que Base atual mudar
            // não afeta o realizado.
            custo: { soma: 80, itensComValor: 1 },
            imposto: { soma: 20, itensComValor: 1 },
            resultadoPersistido: { soma: 36, itensComValor: 1 },
            precoUnitarioMin: 100,
            precoUnitarioMax: 100,
          },
        ],
        [
          "MLB3",
          {
            mlb: "MLB3",
            sku: "SKU-3",
            titulo: "Produto 3",
            unidades: 1,
            receita: 100,
            itensContados: 1,
            pedidos: new Set(["1"]),
            ultimaVendaEm: "2026-08-05",
            comissao: { soma: 12, itensComValor: 1 },
            // Frete realizado 25 contra 10 previsto → divergência.
            frete: { soma: 25, itensComValor: 1 },
            custo: { soma: 60, itensComValor: 1 },
            imposto: { soma: 10, itensComValor: 1 },
            resultadoPersistido: { soma: -7, itensComValor: 1 },
            precoUnitarioMin: 100,
            precoUnitarioMax: 100,
          },
        ],
      ]),
      reembolsoPorMlb: new Map(),
      naoAtribuido: { reembolso: 0 },
      reembolsos: { atribuidoMlb: 0, atribuidoPedido: 0, naoAtribuivel: 0 },
    }),
    buscarItensAtivos: async () => ({ ids: ["MLB1", "MLB2", "MLB3"], total: 3 }),
    buscarDetalhesItens: async ({ ids }) =>
      ids.map((id) => ({
        id,
        title: ANUNCIOS[id].titulo,
        price: ANUNCIOS[id].price,
        listing_type_id: "gold_special",
        category_id: "MLB1234",
        seller_id: "99",
        status: "active",
        shipping: { logistic_type: "drop_off" },
      })),
    aplicarEvidenciasProjetadas: async (bag, { body, observedAt }) => {
      const anuncio = ANUNCIOS[body.id];
      const comum = {
        source: C.SOURCES.MELI_API,
        kind: C.EVIDENCE_KINDS.PROJECTED,
        quality: C.EVIDENCE_QUALITY.MEASURED,
        observedAt,
      };
      bag.add(C.FIELDS.PRICE, { ...comum, value: anuncio.price });
      bag.add(C.FIELDS.LIST_PRICE, { ...comum, value: anuncio.price });
      bag.add(C.FIELDS.COMMISSION, { ...comum, value: anuncio.commission });
      bag.add(C.FIELDS.COMMISSION_RATE, { ...comum, value: anuncio.commissionRate });
      bag.add(C.FIELDS.FREIGHT, { ...comum, value: anuncio.freight });
      return {
        itemId: body.id,
        titulo: anuncio.titulo,
        sku: null,
        status: "active",
        listingTypeId: "gold_special",
        logisticType: "drop_off",
        precoEfetivo: anuncio.price,
        precoCheio: anuncio.price,
        precoPromocional: null,
        commission: anuncio.commission,
        commissionRate: anuncio.commissionRate,
        freight: anuncio.freight,
        faltantes: [],
      };
    },
    ...overrides,
  };
}

const params = { clienteSlug: "cliente-teste", dateFrom: "2026-08-01", dateTo: "2026-08-31" };

// ── Contrato ─────────────────────────────────────────────────────────────────

cenario("listarItens devolve o contrato completo do item de margem", async () => {
  const resposta = await service.listarItens(params, depsPadrao());

  assert.strictEqual(resposta.ok, true);
  assert.strictEqual(resposta.cliente.slug, "cliente-teste");
  assert.deepStrictEqual(resposta.periodo, { dateFrom: "2026-08-01", dateTo: "2026-08-31" });
  assert.strictEqual(resposta.itens.length, 3);

  const item = resposta.itens.find((i) => i.identity.itemId === "MLB1");
  for (const bloco of [
    "identity", "pricing", "costs", "marketplaceCosts", "settlement", "sales", "margin", "quality",
  ]) {
    assert.ok(item[bloco], `bloco ${bloco} presente no contrato`);
  }
  assert.strictEqual(item.identity.marketplace, "meli");
  assert.strictEqual(item.identity.sku, "SKU-1", "SKU vem da venda quando o anúncio não traz");

  // Projetado: 100 − 10 − 12 − 20 − 40 = 18 → 18%
  assert.strictEqual(item.margin.projected.marginPercent, 18);
  // Realizado: preço 100, comissão 12, frete 20 (40/2 unidades) → 18%
  assert.strictEqual(item.margin.realized.marginPercent, 18);
  assert.strictEqual(item.margin.projectionError.deltaPp, 0);
  assert.strictEqual(item.quality.status, C.STATUS.RECONCILING, "vendeu e o MP não conciliou");
  assert.strictEqual(item.settlement.available, false);
  assert.strictEqual(item.settlement.motivo, "MERCADO_PAGO_NAO_INTEGRADO");
});

cenario("item sem custo na base fica UNVALIDATED e não some da lista", async () => {
  const resposta = await service.listarItens(params, depsPadrao());
  const item = resposta.itens.find((i) => i.identity.itemId === "MLB2");

  assert.ok(item, "item sem custo continua listado");
  assert.strictEqual(item.quality.status, C.STATUS.UNVALIDATED);
  assert.strictEqual(item.margin.projected.margin, null);
  assert.strictEqual(item.diagnostico.temCustoNaBase, false);
  assert.strictEqual(item.diagnostico.baseSlug, "base-teste");
});

cenario("frete previsto × realizado divergente aparece como divergência do item", async () => {
  const resposta = await service.listarItens(params, depsPadrao());
  const item = resposta.itens.find((i) => i.identity.itemId === "MLB3");

  const divergencia = item.quality.divergences.find((d) => d.field === C.FIELDS.FREIGHT);
  assert.ok(divergencia, "divergência de frete presente");
  assert.strictEqual(divergencia.type, C.DIVERGENCE_TYPES.DRIFT);
  assert.strictEqual(divergencia.absolute, 15);
  assert.strictEqual(item.quality.status, C.STATUS.SUSPECT_DATA);
  // Projetado 100−10−12−10−60 = 8 (8%); realizado 100−10−12−25−60 = −7 (−7%).
  assert.strictEqual(item.margin.projected.marginPercent, 8);
  assert.strictEqual(item.margin.realized.marginPercent, -7);
  assert.strictEqual(item.margin.projectionError.deltaPp, -15);
});

cenario("resultado recalculado é comparável ao persistido pela Central de Vendas", async () => {
  const resposta = await service.listarItens(params, depsPadrao());
  const item = resposta.itens.find((i) => i.identity.itemId === "MLB1");

  // Contraprova: o núcleo recalcula e o valor persistido fica ao lado.
  assert.strictEqual(item.sales.resultadoPersistido, 36);
  assert.strictEqual(item.sales.resultadoRecalculado, 36);
  assert.strictEqual(item.sales.unidades, 2);
  assert.strictEqual(item.sales.pedidos, 1);
});

// ── Filtros, busca, ordenação, paginação ─────────────────────────────────────

cenario("filtro por status devolve só os itens pedidos", async () => {
  const resposta = await service.listarItens(
    { ...params, status: "UNVALIDATED" },
    depsPadrao()
  );
  assert.strictEqual(resposta.itens.length, 1);
  assert.strictEqual(resposta.itens[0].identity.itemId, "MLB2");
  assert.strictEqual(resposta.paginacao.itensCarregados, 3);
  assert.strictEqual(resposta.paginacao.itensNaPagina, 1);
  assert.strictEqual(resposta.paginacao.filtroAplicadoNaPagina, true);
});

cenario("filtro por divergência e por confiança", async () => {
  const comDivergencia = await service.listarItens(
    { ...params, comDivergencia: "true" },
    depsPadrao()
  );
  assert.deepStrictEqual(
    comDivergencia.itens.map((i) => i.identity.itemId),
    ["MLB3"]
  );

  const baixaConfianca = await service.listarItens({ ...params, confianca: "LOW" }, depsPadrao());
  assert.deepStrictEqual(
    baixaConfianca.itens.map((i) => i.identity.itemId),
    ["MLB3"]
  );
});

cenario("busca casa por MLB, SKU e título", async () => {
  const porId = await service.listarItens({ ...params, busca: "mlb3" }, depsPadrao());
  assert.deepStrictEqual(porId.itens.map((i) => i.identity.itemId), ["MLB3"]);

  const porTitulo = await service.listarItens({ ...params, busca: "Produto 2" }, depsPadrao());
  assert.deepStrictEqual(porTitulo.itens.map((i) => i.identity.itemId), ["MLB2"]);

  const porSku = await service.listarItens({ ...params, busca: "SKU-1" }, depsPadrao());
  assert.deepStrictEqual(porSku.itens.map((i) => i.identity.itemId), ["MLB1"]);
});

cenario("ordenação padrão coloca a pior margem primeiro e o sem-margem por último", async () => {
  const resposta = await service.listarItens(params, depsPadrao());
  assert.deepStrictEqual(
    resposta.itens.map((i) => i.identity.itemId),
    ["MLB3", "MLB1", "MLB2"],
    "−7% < 18% < (sem margem)"
  );

  const desc = await service.listarItens({ ...params, ordenacao: "margem_desc" }, depsPadrao());
  assert.strictEqual(desc.itens[0].identity.itemId, "MLB2", "sem margem vai para o topo no desc");
});

cenario("paginação respeita o teto do multiget do Mercado Livre", async () => {
  const chamadas = [];
  const deps = depsPadrao({
    buscarItensAtivos: async (args) => {
      chamadas.push(args);
      return { ids: ["MLB1"], total: 57 };
    },
  });

  const resposta = await service.listarItens({ ...params, page: "3", limit: "999" }, deps);
  assert.strictEqual(chamadas[0].limit, service.PAGE_LIMIT_MAX, "limit é limitado a 20");
  assert.strictEqual(chamadas[0].offset, 40, "page 3 × limit 20");
  assert.strictEqual(resposta.paginacao.totalItensMl, 57);
});

// ── Margem alvo ──────────────────────────────────────────────────────────────

cenario("margem alvo aceita fração e percentual e muda a classificação", async () => {
  assert.strictEqual(service.parseTargetMargin("0.25"), 0.25);
  assert.strictEqual(service.parseTargetMargin("25"), 0.25);
  assert.strictEqual(service.parseTargetMargin("abc"), C.DEFAULT_TARGET_MARGIN);
  assert.strictEqual(service.parseTargetMargin("0"), C.DEFAULT_TARGET_MARGIN);

  // Com meta de 25%, o item de 18% deixa de ser saudável.
  const resposta = await service.listarItens({ ...params, margemAlvo: "25" }, depsPadrao());
  const item = resposta.itens.find((i) => i.identity.itemId === "MLB1");
  assert.strictEqual(resposta.margemAlvo, 0.25);
  assert.strictEqual(item.quality.status, C.STATUS.LOW_MARGIN);
  assert.strictEqual(item.margin.target.marginTarget, 0.25);
  assert.strictEqual(item.margin.target.computable, true);
});

// ── Período ──────────────────────────────────────────────────────────────────

cenario("período padrão é de 30 dias e datas invertidas são corrigidas", () => {
  const padrao = service.resolverPeriodo({ now: new Date("2026-08-12T00:00:00Z") });
  assert.strictEqual(padrao.dateTo, "2026-08-12");
  assert.strictEqual(padrao.dateFrom, "2026-07-14");

  const invertido = service.resolverPeriodo({ dateFrom: "2026-08-31", dateTo: "2026-08-01" });
  assert.deepStrictEqual(invertido, { dateFrom: "2026-08-01", dateTo: "2026-08-31" });
});

// ── Resumo ───────────────────────────────────────────────────────────────────

cenario("resumo agrega placar, exceções e declara cobertura parcial", async () => {
  const resposta = await service.obterResumo({ ...params, maxItens: "20" }, depsPadrao());

  assert.strictEqual(resposta.ok, true);
  assert.strictEqual(resposta.cobertura.itensAnalisados, 3);
  assert.strictEqual(resposta.cobertura.totalItensMl, 3);
  assert.strictEqual(resposta.cobertura.parcial, false);

  assert.strictEqual(resposta.placar.porStatus.SUSPECT_DATA, 1);
  assert.strictEqual(resposta.placar.porStatus.UNVALIDATED, 1);
  assert.strictEqual(resposta.placar.porStatus.RECONCILING, 1);
  assert.strictEqual(resposta.placar.itensSemMargem, 1, "MLB2 não tem margem");
  assert.strictEqual(resposta.placar.itensComDivergencia, 1);
  // Erro médio de projeção: MLB1 0 pp, MLB3 −15 pp.
  assert.strictEqual(resposta.placar.erroProjecaoMedioPp, -7.5);

  // Fila de exceções: nenhum saudável, pior margem primeiro.
  assert.deepStrictEqual(
    resposta.excecoes.map((e) => e.itemId),
    ["MLB3", "MLB1", "MLB2"]
  );
  assert.ok(resposta.excecoes[0].problemaPrincipal, "exceção explica o problema");
});

cenario("resumo declara cobertura parcial quando o catálogo é maior que o teto", async () => {
  const deps = depsPadrao({
    buscarItensAtivos: async () => ({ ids: ["MLB1", "MLB2", "MLB3"], total: 500 }),
  });
  const resposta = await service.obterResumo({ ...params, maxItens: "20" }, deps);

  assert.strictEqual(resposta.cobertura.parcial, true);
  assert.strictEqual(resposta.cobertura.totalItensMl, 500);
  assert.ok(resposta.cobertura.motivoParcial, "motivo da amostragem é explícito");
});

// ── Workspace ────────────────────────────────────────────────────────────────
// Uma única varredura em batches <=20 alimenta planilha, filtros, KPIs e fila
// de divergências no frontend. Estes testes provam que o workspace enxerga
// itens além da antiga "página 1" de 20, sem nunca violar o teto do multiget.

function gerarCatalogo(n) {
  const ids = [];
  const anuncios = {};
  const custos = new Map();
  for (let i = 1; i <= n; i += 1) {
    const id = `MLB${String(i).padStart(4, "0")}`;
    ids.push(id);
    const price = 100 + (i % 5) * 10;
    anuncios[id] = { price, commission: price * 0.12, commissionRate: 0.12, freight: 15, titulo: `Produto ${i}` };
    custos.set(id, { produtoId: id, cost: price * 0.4, taxRate: 0.08, fixedFee: 0, observedAt: null });
  }
  return { ids, anuncios, custos };
}

function depsWorkspace({ n, total, searchIndex, divergenceIndex }) {
  const catalogo = gerarCatalogo(n);
  const chamadasMl = [];
  let searchId = null;
  if (searchIndex) {
    searchId = catalogo.ids[searchIndex - 1];
    catalogo.anuncios[searchId].titulo = "Produto Raro Único";
  }
  let divergenceId = null;
  const vendasPorMlb = new Map();
  if (divergenceIndex) {
    divergenceId = catalogo.ids[divergenceIndex - 1];
    const anuncio = catalogo.anuncios[divergenceId];
    vendasPorMlb.set(divergenceId, {
      mlb: divergenceId, sku: "SKU-DIV", titulo: anuncio.titulo,
      unidades: 1, receita: anuncio.price, itensContados: 1,
      pedidos: new Set(["9"]), ultimaVendaEm: "2026-08-05",
      comissao: { soma: anuncio.commission, itensComValor: 1 },
      // Frete realizado bem acima do previsto → DRIFT detectável.
      frete: { soma: anuncio.freight + 40, itensComValor: 1 },
      // Sem histórico de custo/imposto neste fixture — cobertura 0, sem
      // evidência REALIZED (não afeta o teste de divergência de frete).
      custo: { soma: 0, itensComValor: 0 },
      imposto: { soma: 0, itensComValor: 0 },
      resultadoPersistido: { soma: 0, itensComValor: 1 },
      precoUnitarioMin: anuncio.price, precoUnitarioMax: anuncio.price,
    });
  }

  const deps = {
    now: NOW,
    exigirContexto: async () => ({ cliente: CLIENTE, base: BASE, mlUserId: "99" }),
    carregarCustos: async () => ({ index: catalogo.custos, total: catalogo.custos.size }),
    carregarVendas: async () => ({ sincronizado: true, imports: [], pedidos: [], itens: [], componentes: [] }),
    agregarPorMlb: () => ({
      porMlb: vendasPorMlb,
      reembolsoPorMlb: new Map(),
      naoAtribuido: { reembolso: 0 },
      reembolsos: { atribuidoMlb: 0, atribuidoPedido: 0, naoAtribuivel: 0 },
    }),
    buscarItensAtivos: async ({ offset, limit }) => {
      chamadasMl.push({ offset, limit });
      return { ids: catalogo.ids.slice(offset, offset + limit), total: total ?? n };
    },
    buscarDetalhesItens: async ({ ids }) =>
      ids.map((id) => ({ id, title: catalogo.anuncios[id].titulo, secure_thumbnail: `https://img/${id}.jpg` })),
    aplicarEvidenciasProjetadas: async (bag, { body, observedAt }) => {
      const anuncio = catalogo.anuncios[body.id];
      const comum = { source: C.SOURCES.MELI_API, kind: C.EVIDENCE_KINDS.PROJECTED, quality: C.EVIDENCE_QUALITY.MEASURED, observedAt };
      bag.add(C.FIELDS.PRICE, { ...comum, value: anuncio.price });
      bag.add(C.FIELDS.LIST_PRICE, { ...comum, value: anuncio.price });
      bag.add(C.FIELDS.COMMISSION, { ...comum, value: anuncio.commission });
      bag.add(C.FIELDS.COMMISSION_RATE, { ...comum, value: anuncio.commissionRate });
      bag.add(C.FIELDS.FREIGHT, { ...comum, value: anuncio.freight });
      return {
        itemId: body.id, titulo: anuncio.titulo, sku: null, status: "active",
        image: body.secure_thumbnail || null,
        listingTypeId: "gold_special", logisticType: "drop_off",
        precoEfetivo: anuncio.price, precoCheio: anuncio.price, precoPromocional: null,
        commission: anuncio.commission, commissionRate: anuncio.commissionRate, freight: anuncio.freight,
        faltantes: [],
      };
    },
  };

  return { deps, catalogo, searchId, divergenceId, chamadasMl };
}

cenario("workspace agrega catálogo de 87 itens em batches <=20, sem violar o teto do ML", async () => {
  const { deps, chamadasMl } = depsWorkspace({ n: 87, total: 87 });
  const resposta = await service.obterWorkspace(params, deps);

  assert.strictEqual(resposta.ok, true);
  assert.strictEqual(resposta.itens.length, 87);
  assert.strictEqual(resposta.cobertura.carregados, 87);
  assert.strictEqual(resposta.cobertura.totalItensMl, 87);
  assert.strictEqual(resposta.cobertura.parcial, false, "87 de 87 é cobertura completa");
  assert.strictEqual(resposta.resumo.itensCarregados, 87);

  assert.deepStrictEqual(chamadasMl.map((c) => c.offset), [0, 20, 40, 60, 80]);
  assert.ok(chamadasMl.every((c) => c.limit <= service.PAGE_LIMIT_MAX), "nenhum batch pede mais de 20 IDs");
});

cenario("busca encontraria um item da antiga página 4 porque o workspace carrega o catálogo inteiro", async () => {
  // Índice 65 cairia na página 4 de uma paginação antiga de 20 por página.
  const { deps, searchId } = depsWorkspace({ n: 87, total: 87, searchIndex: 65 });
  const resposta = await service.obterWorkspace(params, deps);

  const item = resposta.itens.find((i) => i.itemId === searchId);
  assert.ok(item, "item da antiga página 4 precisa estar no workspace");
  assert.strictEqual(item.title, "Produto Raro Único");
});

cenario("divergência fora dos primeiros 20 itens aparece no workspace", async () => {
  const { deps, divergenceId } = depsWorkspace({ n: 87, total: 87, divergenceIndex: 73 });
  const resposta = await service.obterWorkspace(params, deps);

  const item = resposta.itens.find((i) => i.itemId === divergenceId);
  assert.ok(item, "item divergente precisa estar carregado");
  assert.ok(item.divergences.length > 0, "divergência de frete precisa aparecer no item");
  assert.ok(resposta.resumo.itensComDivergencia >= 1);
});

cenario("workspace propaga a imagem do ML para cada item, sem chamada extra", async () => {
  const { deps } = depsWorkspace({ n: 5, total: 5 });
  const resposta = await service.obterWorkspace(params, deps);
  assert.strictEqual(resposta.itens[0].image, "https://img/MLB0001.jpg");
});

cenario("REQUISITO DE ESCALA: catálogo de 1.037 anúncios declara cobertura parcial sem violar o teto", async () => {
  const { deps, chamadasMl } = depsWorkspace({ n: service.RESUMO_MAX_ITENS_TETO, total: 1037 });
  const resposta = await service.obterWorkspace(params, deps);

  // Catálogo completo é CONHECIDO mesmo sem estar todo carregado.
  assert.strictEqual(resposta.cobertura.totalItensMl, 1037);
  assert.strictEqual(resposta.cobertura.carregados, service.RESUMO_MAX_ITENS_TETO);
  assert.strictEqual(resposta.cobertura.parcial, true);
  assert.ok(resposta.cobertura.motivoParcial, "motivo da cobertura parcial é explícito");
  assert.strictEqual(resposta.parcial, true);

  assert.ok(chamadasMl.every((c) => c.limit <= service.PAGE_LIMIT_MAX), "nenhum batch excede 20 mesmo em catálogo de 1037");
  assert.strictEqual(chamadasMl.length, service.RESUMO_MAX_ITENS_TETO / service.PAGE_LIMIT_MAX);
});

cenario("workspace aceita maxItens explícito, sempre limitado ao teto seguro", async () => {
  const { deps } = depsWorkspace({ n: 50, total: 50 });
  const resposta = await service.obterWorkspace({ ...params, maxItens: String(service.RESUMO_MAX_ITENS_TETO * 5) }, deps);
  // Mesmo pedindo muito mais, o teto de segurança da leitura continua valendo.
  assert.strictEqual(resposta.cobertura.maxItens, service.RESUMO_MAX_ITENS_TETO);
});

// ── Preparação única do contexto (AUDITORIA §1 — prepareWorkspaceContext) ────
// Um workspace de 87 itens em 5 lotes de <=20 deve resolver contexto/Base/
// Central de Vendas/agregação UMA vez, não uma vez por lote.

cenario("contexto/Base/Central de Vendas/agregação são resolvidos 1x para um workspace de 87 itens em 5 lotes", async () => {
  const contadores = { exigirContexto: 0, carregarCustos: 0, carregarVendas: 0, agregarPorMlb: 0 };
  const { deps } = depsWorkspace({ n: 87, total: 87 });

  const instrumentado = {
    ...deps,
    exigirContexto: async (...args) => {
      contadores.exigirContexto += 1;
      return deps.exigirContexto(...args);
    },
    carregarCustos: async (...args) => {
      contadores.carregarCustos += 1;
      return deps.carregarCustos(...args);
    },
    carregarVendas: async (...args) => {
      contadores.carregarVendas += 1;
      return deps.carregarVendas(...args);
    },
    agregarPorMlb: (...args) => {
      contadores.agregarPorMlb += 1;
      return deps.agregarPorMlb(...args);
    },
  };

  const resposta = await service.obterWorkspace(params, instrumentado);

  assert.strictEqual(resposta.itens.length, 87);
  assert.strictEqual(contadores.exigirContexto, 1, "contexto: 1 leitura, não 5");
  assert.strictEqual(contadores.carregarCustos, 1, "Base: 1 leitura, não 5");
  assert.strictEqual(contadores.carregarVendas, 1, "Central de Vendas: 1 leitura, não 5");
  assert.strictEqual(contadores.agregarPorMlb, 1, "agregação por MLB: 1 execução, não 5");
});

cenario("obterResumo (mesmo helper de workspace) também resolve o contexto 1x", async () => {
  const contadores = { exigirContexto: 0 };
  const { deps } = depsWorkspace({ n: 45, total: 45 });
  const instrumentado = {
    ...deps,
    exigirContexto: async (...args) => {
      contadores.exigirContexto += 1;
      return deps.exigirContexto(...args);
    },
  };

  await service.obterResumo({ ...params, maxItens: "45" }, instrumentado);
  // 45 itens / 20 por lote = 3 lotes.
  assert.strictEqual(contadores.exigirContexto, 1, "3 lotes, 1 contexto só");
});

cenario("prepareWorkspaceContext expõe o contexto para enrichBatch reaproveitar entre lotes", async () => {
  const { deps } = depsWorkspace({ n: 5, total: 5 });
  const prepared = await service.prepareWorkspaceContext(params, deps);

  assert.strictEqual(prepared.cliente.slug, "cliente-teste");
  assert.ok(prepared.porMlb instanceof Map);
  assert.ok(prepared.reembolsoPorMlb instanceof Map);
  assert.ok(prepared.custos.index, "índice de custos da Base já resolvido");

  const lote1 = await service.enrichBatch(prepared, { offset: 0, limit: 20, targetMargin: 0.1 }, deps);
  const lote2 = await service.enrichBatch(prepared, { offset: 20, limit: 20, targetMargin: 0.1 }, deps);
  assert.strictEqual(lote1.totalItensMl, 5);
  assert.strictEqual(lote1.itens.length, 5, "só 5 existem, o resto do lote 1 já cobre tudo");
  assert.strictEqual(lote2.itens.length, 0, "lote 2 não encontra mais nada — não recarrega contexto para saber isso");
});

// ── Filtro/busca/paginação/drawer não chamam o Mercado Livre ────────────────
// Uma vez que o workspace foi carregado, interações do operador (trocar
// página, filtrar por status/confiança, buscar, abrir o drawer de um item)
// são operações PURAS sobre o array já carregado — nenhuma delas aceita
// `deps`/rede, então não têm como disparar uma nova chamada ao ML.

cenario("filtrar, buscar e paginar visualmente o workspace já carregado não chama o ML de novo", async () => {
  let chamadasMl = 0;
  const { deps } = depsWorkspace({ n: 30, total: 30 });
  const instrumentado = {
    ...deps,
    buscarItensAtivos: async (...args) => {
      chamadasMl += 1;
      return deps.buscarItensAtivos(...args);
    },
  };

  const workspace = await service.obterWorkspace(params, instrumentado);
  const chamadasApósCarga = chamadasMl;
  assert.ok(chamadasApósCarga > 0, "a carga inicial chama o ML normalmente");

  // Filtro por status — puro, sobre o array já carregado.
  const porStatus = service.aplicarFiltros(workspace.itens, { status: "HEALTHY" });
  // Busca por texto — idem.
  const porBusca = service.aplicarFiltros(workspace.itens, { busca: "produto" });
  // Filtro por divergência — idem.
  const porDivergencia = service.aplicarFiltros(workspace.itens, { comDivergencia: true });
  // "Paginação visual" — fatiar o array em memória, sem nova busca.
  const pagina2 = workspace.itens.slice(20, 40);
  // "Abrir o drawer" — os dados do item (evidências, divergências, diagnóstico)
  // já vieram no workspace; nenhuma chamada nova é necessária para exibi-los.
  const itemDoDrawer = workspace.itens[0];

  assert.ok(Array.isArray(porStatus));
  assert.ok(Array.isArray(porBusca));
  assert.ok(Array.isArray(porDivergencia));
  assert.ok(Array.isArray(pagina2));
  assert.ok(itemDoDrawer.fields, "o drawer lê evidências já carregadas no item");
  assert.ok(itemDoDrawer.divergences, "e as divergências já carregadas");

  assert.strictEqual(chamadasMl, chamadasApósCarga, "nenhuma das operações acima chamou o ML");
});

cenario("rota de workspace responde no controller com os mesmos aliases da raiz", async () => {
  const req = { params: { clienteSlug: "cliente-teste" }, query: { dateFrom: "2026-08-01", dateTo: "2026-08-31" } };
  let statusCode = null;
  let payload = null;
  const res = { status(code) { statusCode = code; return this; }, json(body) { payload = body; return this; } };

  const original = require("../services/motorMargem/motorMargemService").obterWorkspace;
  require("../services/motorMargem/motorMargemService").obterWorkspace = async () => ({
    ok: true, itens: [{ itemId: "MLB1", image: "https://img/1.jpg" }], cobertura: { carregados: 1, totalItensMl: 1, parcial: false },
  });
  try {
    await controller.obterWorkspace(req, res);
  } finally {
    require("../services/motorMargem/motorMargemService").obterWorkspace = original;
  }
  assert.strictEqual(statusCode, 200);
  assert.strictEqual(payload.ok, true);
  assert.strictEqual(payload.itens[0].image, "https://img/1.jpg");
});

// ── Detalhe de item ──────────────────────────────────────────────────────────

cenario("obterItem busca um único anúncio e devolve 404 quando não existe", async () => {
  const resposta = await service.obterItem({ ...params, itemId: "mlb3" }, depsPadrao());
  assert.strictEqual(resposta.item.identity.itemId, "MLB3");
  assert.ok(resposta.item.quality.divergences.length > 0);

  const deps = depsPadrao({ buscarDetalhesItens: async () => [] });
  await assert.rejects(
    () => service.obterItem({ ...params, itemId: "MLB404" }, deps),
    (err) => err.statusCode === 404 && err.payload.codigo === "ITEM_NAO_ENCONTRADO"
  );

  await assert.rejects(
    () => service.obterItem({ ...params, itemId: "" }, depsPadrao()),
    (err) => err.statusCode === 400
  );
});

// ── Rota raiz + compatibilidade com o frontend da Central ────────────────────

cenario("rota raiz devolve resumo da página + itens no mesmo payload", async () => {
  const resposta = await service.obterCentralMargem(params, depsPadrao());

  assert.strictEqual(resposta.ok, true);
  assert.strictEqual(resposta.itens.length, 3);
  assert.strictEqual(resposta.resumo.escopo, "pagina");
  assert.strictEqual(resposta.resumo.porStatus.UNVALIDATED, 1);
  assert.strictEqual(resposta.resumo.porStatus.SUSPECT_DATA, 1);
  assert.strictEqual(resposta.resumo.itensComDivergencia, 1);
  assert.strictEqual(resposta.parcial, false, "3 de 3 itens carregados");
});

cenario("itens da raiz trazem os aliases que o frontend da Central lê", async () => {
  const resposta = await service.obterCentralMargem(params, depsPadrao());
  const item = resposta.itens.find((i) => i.itemId === "MLB1");

  // Chaves planas esperadas por Portal/central-margem-api.js.
  assert.strictEqual(item.itemId, "MLB1");
  assert.strictEqual(item.title, "Produto 1");
  assert.strictEqual(item.sku, "SKU-1");
  assert.strictEqual(item.status, C.STATUS.RECONCILING);
  assert.strictEqual(item.confidence, C.LEVELS.HIGH);
  assert.strictEqual(item.projected.margin, 0.18);
  assert.strictEqual(item.projected.profit, 18);
  assert.strictEqual(item.projected.estimated, false);
  assert.strictEqual(item.realized.margin, 0.18);
  assert.strictEqual(item.realized.pending, false);
  assert.strictEqual(item.conciliacao, "Pendente");

  // `fields` é a camada de evidências crua, por variável.
  assert.ok(item.fields, "camada de evidências exposta");
  assert.strictEqual(item.fields.freight.selectedValue, 20);
  assert.ok(Array.isArray(item.fields.freight.evidences));
  assert.strictEqual(item.fields.freight.evidences.length, 2, "previsto + realizado");

  // O contrato canônico continua intacto ao lado dos aliases.
  assert.strictEqual(item.identity.itemId, "MLB1");
  assert.strictEqual(item.margin.projected.marginPercent, 18);
  assert.strictEqual(item.quality.status, C.STATUS.RECONCILING);
});

cenario("item sem margem sinaliza pending/estimated para o frontend", async () => {
  const resposta = await service.obterCentralMargem(params, depsPadrao());

  const semCusto = resposta.itens.find((i) => i.itemId === "MLB2");
  assert.strictEqual(semCusto.projected.margin, null);
  assert.strictEqual(semCusto.realized.pending, true);
  assert.strictEqual(semCusto.status, C.STATUS.UNVALIDATED);

  const divergente = resposta.itens.find((i) => i.itemId === "MLB3");
  assert.strictEqual(divergente.divergences.length, 1);
  assert.ok(divergente.problema, "problema principal preenchido");
});

// ── Contexto ─────────────────────────────────────────────────────────────────

cenario("contexto reporta cada fonte e por que ela está (in)disponível", async () => {
  const resposta = await service.obterContextoMargem(params, {
    resolverContexto: async () => ({
      cliente: CLIENTE,
      grant: { conectado: true, ml_user_id: "99" },
      base: BASE,
      basesMeli: [BASE],
      pronto: true,
      motivo: "OK",
      mensagem: null,
    }),
    carregarCustos: async () => ({ index: CUSTOS, total: 2 }),
    carregarVendas: async () => ({
      sincronizado: true,
      imports: [{ id: 1 }],
      pedidos: [{ id: 1 }],
      itens: [],
      componentes: [],
    }),
  });

  assert.strictEqual(resposta.pronto, true);
  assert.strictEqual(resposta.fontes.MELI_API.disponivel, true);
  assert.strictEqual(resposta.fontes.VENFORCE_BASE.disponivel, true);
  assert.strictEqual(resposta.fontes.VENFORCE_BASE.totalCustos, 2);
  assert.strictEqual(resposta.fontes.MELI_ORDER.disponivel, true);
  // As duas fontes que não existem hoje precisam sair explicitamente como false.
  assert.strictEqual(resposta.fontes.MERCADO_PAGO.disponivel, false);
  assert.strictEqual(resposta.fontes.EXTENSION_DOM.disponivel, false);
  assert.ok(resposta.fontes.MERCADO_PAGO.detalhe.includes("Mercado Pago"));
});

cenario("contexto não quebra quando a Central de Vendas falha", async () => {
  const resposta = await service.obterContextoMargem(params, {
    resolverContexto: async () => ({
      cliente: CLIENTE,
      grant: { conectado: false, ml_user_id: null },
      base: null,
      basesMeli: [],
      pronto: false,
      motivo: "GRANT_ML_NAO_CONECTADO",
      mensagem: "Cliente sem conta ML conectada.",
    }),
    carregarVendas: async () => {
      throw new Error("banco fora do ar");
    },
  });

  assert.strictEqual(resposta.pronto, false);
  assert.strictEqual(resposta.motivo, "GRANT_ML_NAO_CONECTADO");
  assert.strictEqual(resposta.fontes.MELI_API.disponivel, false);
  assert.strictEqual(resposta.fontes.MELI_ORDER.disponivel, false);
  assert.strictEqual(resposta.fontes.VENFORCE_BASE.disponivel, false);
});

// ── Rotas e controller ───────────────────────────────────────────────────────

cenario("todas as rotas montadas são GET (API read-only)", () => {
  const router = require("../routes/motorMargemRoutes");
  const rotas = router.stack.filter((layer) => layer.route).map((layer) => ({
    path: layer.route.path,
    methods: Object.keys(layer.route.methods),
  }));

  assert.strictEqual(rotas.length, 7);
  for (const rota of rotas) {
    assert.deepStrictEqual(rota.methods, ["get"], `${rota.path} precisa ser somente GET`);
  }
  assert.deepStrictEqual(
    rotas.map((r) => r.path).sort(),
    [
      "/:clienteSlug",
      "/:clienteSlug/contexto",
      "/:clienteSlug/itens",
      "/:clienteSlug/itens/:itemId",
      "/:clienteSlug/itens/:itemId/evidencias",
      "/:clienteSlug/resumo",
      "/:clienteSlug/workspace",
    ]
  );
  // A raiz é curinga: registrada por último, não pode engolir os subcaminhos.
  assert.strictEqual(rotas[rotas.length - 1].path, "/:clienteSlug");
});

cenario("a rota de evidências vem antes da rota de item (não é engolida)", () => {
  const router = require("../routes/motorMargemRoutes");
  const paths = router.stack.filter((l) => l.route).map((l) => l.route.path);
  assert.ok(
    paths.indexOf("/:clienteSlug/itens/:itemId/evidencias") < paths.indexOf("/:clienteSlug/itens/:itemId"),
    "a rota mais específica precisa ser registrada primeiro"
  );
});

cenario("o controller mascara campos sensíveis antes de responder", () => {
  const mascarado = controller.maskSensitiveData({
    ok: true,
    cliente: { slug: "x" },
    debug: { access_token: "abc", refresh_token: "def", api_key: "ghi" },
  });
  assert.strictEqual(mascarado.debug.access_token, "[REDACTED]");
  assert.strictEqual(mascarado.debug.refresh_token, "[REDACTED]");
  assert.strictEqual(mascarado.debug.api_key, "[REDACTED]");
  assert.strictEqual(mascarado.cliente.slug, "x");
});

cenario("erro de contexto chega ao cliente com o código de ação", async () => {
  const respostas = [];
  const res = {
    status(code) {
      this._code = code;
      return this;
    },
    json(payload) {
      respostas.push({ code: this._code, payload });
      return this;
    },
  };

  const erro = new Error("Cliente sem base MELI vinculada.");
  erro.statusCode = 409;
  erro.payload = { ok: false, codigo: "BASE_MELI_NAO_VINCULADA", erro: erro.message };

  const servicoOriginal = service.listarItens;
  service.listarItens = async () => {
    throw erro;
  };
  try {
    await controller.listarItens({ params: { clienteSlug: "c" }, query: {} }, res);
  } finally {
    service.listarItens = servicoOriginal;
  }

  assert.strictEqual(respostas[0].code, 409);
  assert.strictEqual(respostas[0].payload.codigo, "BASE_MELI_NAO_VINCULADA");
});

// ── Concorrência ─────────────────────────────────────────────────────────────

cenario("mapWithConcurrency preserva a ordem e respeita o limite", async () => {
  let ativos = 0;
  let pico = 0;
  const entrada = Array.from({ length: 12 }, (_, i) => i);

  const saida = await service.mapWithConcurrency(entrada, 5, async (valor) => {
    ativos += 1;
    pico = Math.max(pico, ativos);
    await new Promise((resolve) => setTimeout(resolve, 1));
    ativos -= 1;
    return valor * 2;
  });

  assert.deepStrictEqual(saida, entrada.map((v) => v * 2), "ordem preservada");
  assert.ok(pico <= 5, `pico de concorrência foi ${pico}`);
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
    console.error(`motorMargemApi: ${falhas} de ${casos.length} cenários falharam`);
    process.exitCode = 1;
  } else {
    console.log(`motorMargemApi: ok (${casos.length} cenários)`);
  }
}

main();
