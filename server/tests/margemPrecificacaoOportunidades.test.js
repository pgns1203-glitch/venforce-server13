// server/tests/margemPrecificacaoOportunidades.test.js
// Oportunidades de preço/promoção da Central de Margem (sem N+1) e refresh
// pontual do Margin Snapshot pós-escrita. Fake db, nenhum ML.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://127.0.0.1:1/vf-test";

const assert = require("assert");
const { listarOportunidades, motivoForaDoRanking, MOTIVO_FORA_DO_RANKING, rankearOportunidades, parseVeredito } = require("../services/motorMargem/precificacao/precificacaoOportunidadesService");
const { atualizarSnapshotDoItem } = require("../services/motorMargem/precificacao/precificacaoSnapshotItem");
const { computeMargin } = require("../services/motorMargem/core/marginEngine");
const { elegiveisReferencia } = require("./helpers/oportunidadesReferencia");

const casos = [];
function cenario(nome, fn) {
  casos.push({ nome, fn });
}

function snapRow(itemId, o = {}) {
  const price = o.price ?? 100;
  const rate = o.rate === undefined ? 0.12 : o.rate;
  return {
    item_id: itemId, titulo: `Produto ${itemId}`, image_url: null, price, cost: o.cost === undefined ? 40 : o.cost,
    tax_rate: o.tax === undefined ? 0.1 : o.tax, fixed_fee: 0, commission_rate: rate, freight: o.freight === undefined ? 15 : o.freight,
    commission: o.commission === undefined ? Math.round(price * (rate ?? 0.12) * 100) / 100 : o.commission,
    margin: 0.2, status: "HEALTHY", quality_json: o.quality || {},
  };
}

function diagRow(itemId, o = {}) {
  return {
    item_id: itemId, titulo: null, campanha: o.campanha || "Campanha", campanha_id: o.id || `P-${itemId}`,
    tipo_promocao: o.tipo || "DEAL", preco_original: 100, preco_promocao: o.preco ?? 90, desconto_total: 10,
    seller_percentage: 5, meli_percentage: o.meli ?? 5, retorno_ml: o.retorno ?? 0, payload_raw: { status: o.status || "candidate" },
  };
}

const STATUS_OK = ["candidate", "started", "active", "pending"];

// As Oportunidades leem UMA consulta de ELEGÍVEIS (o banco só seleciona; o
// cálculo, a ordem e a página são do serviço); aqui ela é respondida pela
// referência JS da mesma seleção. O SQL real é conferido contra essa
// referência em scripts/promoSnapshotSqlCheck.js.
function fakeDb({ head = [{ id: 11, created_at: new Date().toISOString(), parcial: false, itens_scaneados: 120 }], itens = [], snaps = [], anuncios = [] } = {}) {
  const queries = [];
  return {
    queries,
    linhasDevolvidas: 0,
    async query(sql, params) {
      queries.push({ sql, params });
      if (/FROM promocoes_diagnosticos/.test(sql)) {
        if (head === "sem-tabela") { const e = new Error("relation does not exist"); e.code = "42P01"; throw e; }
        return { rows: head };
      }
      // Retorno ML das promoções em andamento (margem atual): por padrão, nenhuma.
      if (/FROM promo_snapshot_contas c/.test(sql)) return { rows: this.rebates || [] };
      if (/WITH promos AS/.test(sql) && /FROM promocoes_diagnostico_itens/.test(sql)) {
        const promos = itens
          .map((r, i) => ({ ...r, _status: String((r.payload_raw && (r.payload_raw.status || r.payload_raw.statusPromocao)) || "").toLowerCase(), _id: i + 1 }))
          .filter((r) => r.item_id && Number(r.preco_promocao) > 0 && (!r._status || STATUS_OK.includes(r._status)))
          .map((r) => ({
            item_id: r.item_id, chave: String(r._id).padStart(6, "0"), preco_promo: r.preco_promocao, retorno: r.retorno_ml,
            fonte_titulo: r.titulo, promo_nome: r.campanha, promo_id: r.campanha_id, promo_tipo: r.tipo_promocao, promo_status: r._status || null,
          }));
        const snapPorItem = new Map(snaps.map((x) => [x.item_id, x]));
        const anuncioPorItem = new Map(anuncios.map((x) => [x.item_id, x]));
        const res = elegiveisReferencia({ promos, snapPorItem, anuncioPorItem });
        this.linhasDevolvidas = res.rows.length;
        return res;
      }
      throw new Error("SQL inesperado: " + sql);
    },
  };
}

function deps(db, vendas = new Map()) {
  return {
    db,
    resolverContaDoCliente: async () => ({ cliente: { id: 3, slug: "loja-a" }, conta: { id: 7, nome: "Conta A" } }),
    obterConta: async () => ({ id: 7, external_account_id: "555" }),
    carregarRealizada: async () => ({ porMlb: vendas, periodo: { dateFrom: "2026-08-31", dateTo: "2026-09-29" } }),
    now: () => new Date(),
    // Conta sem Promo Snapshot ainda: a Central cai no diagnóstico legado.
    promo: {
      estadoComAutoTrigger: async () => ({ estado: { state: "never_synced", hasSnapshot: false, workerEnabled: false }, gatilho: { acao: "worker_desabilitado" } }),
      syncPublico: (e, g) => ({ ...e, autoTrigger: g.acao }),
      listarElegiveis: async () => { throw new Error("não deveria ler o snapshot"); },
    },
  };
}

cenario("sem diagnóstico concluído (ou tabela inexistente): indisponível, com a explicação da dependência bulk", async () => {
  const r = await listarOportunidades({ clienteSlug: "loja-a", clienteContaId: 7 }, deps(fakeDb({ head: [] })));
  assert.strictEqual(r.disponivel, false);
  // Sem Promo Snapshot e sem diagnóstico legado: indisponível, explicando o
  // estado da sincronização (não manda mais o operador para a tela antiga).
  assert.strictEqual(r.motivo, "SEM_SNAPSHOT_PROMOCOES");
  assert.ok(!/Promoções ML/.test(r.mensagem));
  const r2 = await listarOportunidades({ clienteSlug: "loja-a", clienteContaId: 7 }, deps(fakeDb({ head: "sem-tabela" })));
  assert.strictEqual(r2.disponivel, false);
});

cenario("diagnóstico filtrado pela CONTA (seller_id = conta ML), nunca pelo cliente inteiro", async () => {
  const db = fakeDb({ head: [] });
  await listarOportunidades({ clienteSlug: "loja-a", clienteContaId: 7 }, deps(db));
  const q = db.queries.find((x) => /promocoes_diagnosticos/.test(x.sql));
  assert.deepStrictEqual(q.params, [3, "555"]);
});

cenario("ranking explicável: veredito → com histórico → ΔLC × unidades; margem pelo marginEngine; 1 linha por item", async () => {
  const itens = [
    diagRow("MLB1", { retorno: 0 }),
    diagRow("MLB2", { retorno: 4.5 }),
    diagRow("MLB3", { retorno: 0 }),
    diagRow("MLB3", { id: "P-MLB3-b", retorno: 0, preco: 95 }),
    diagRow("MLB4", { retorno: 0, preco: 50 }), // LC' negativo → nao_entrar → fora da lista padrão
    diagRow("MLB5", { status: "finished" }), // indisponível → fora
    diagRow("MLB6", {}), // sem snapshot → fora
  ];
  const snaps = [snapRow("MLB1"), snapRow("MLB2"), snapRow("MLB3"), snapRow("MLB4"), snapRow("MLB5")];
  const vendas = new Map([["MLB1", { unidades: 3, receita: 300 }], ["MLB3", { unidades: 10, receita: 900 }]]);
  const r = await listarOportunidades({ clienteSlug: "loja-a", clienteContaId: 7 }, deps(fakeDb({ itens, snaps }), vendas));
  assert.strictEqual(r.disponivel, true);
  // Os três perdem LC por unidade (entrar_se_girar): MLB1 (3 un × −7,80 = −23,40) antes de MLB3
  // (promoção de 95: 10 un × −3,90 = −39,00); MLB2 não tem histórico e vem depois dos que têm.
  assert.deepStrictEqual(r.oportunidades.map((o) => o.itemId), ["MLB1", "MLB3", "MLB2"]);
  assert.deepStrictEqual(r.oportunidades.map((o) => o.impacto_lc), [-23.4, -39, null]);
  assert.deepStrictEqual(r.oportunidades.map((o) => o.flags.sem_historico), [false, false, true]);
  const mlb2 = r.oportunidades[2];
  const esperado = computeMargin({ price: 90, cost: 40, taxRate: 0.1, fixedFee: 0, commission: 10.8, freight: 15, rebate: 4.5 });
  assert.strictEqual(mlb2.margemDepois, esperado.margin, "a conta é a do computeMargin (via calcularCenario)");
  assert.strictEqual(mlb2.lucroDepois, esperado.profit);
  assert.strictEqual(mlb2.estimado, true);
  assert.strictEqual(mlb2.cotacao.ao_vivo, false);
  assert.strictEqual(mlb2.flags.mudou_faixa_frete, null, "a faixa de frete só se sabe cotando: a lista não afirma");
  assert.strictEqual(mlb2.veredito, "entrar_se_girar");
  assert.strictEqual(mlb2.ml_banca, 4.5);
  assert.strictEqual(mlb2.seller_banca, 5.5);
  assert.ok(/retorno ML/.test(mlb2.motivo));
  const mlb3 = r.oportunidades[1];
  assert.strictEqual(mlb3.precoPromocao, 95, "MLB3: a melhor promoção do mesmo item (menor perda por unidade)");
  assert.strictEqual(mlb3.opcoes_total, 2);
  assert.strictEqual(r.fonte.frescor, "atual");
  assert.deepStrictEqual(r.filtro, { veredito: ["entrar", "entrar_se_girar"] });
  assert.deepStrictEqual(r.contagem, { entrar: 0, entrar_se_girar: 3, nao_entrar: 1, bloqueado: 0 });
});

cenario("`entrar` vem antes de `entrar_se_girar`; sem histórico, ΔLC por unidade; `veredito=todos` traz também nao_entrar", async () => {
  const itens = [
    diagRow("MLB1", { preco: 90, retorno: 0 }), // perde LC → entrar_se_girar
    diagRow("MLB2", { preco: 90, retorno: 12 }), // retorno cobre o desconto → entrar
    diagRow("MLB3", { preco: 90, retorno: 10 }), // entrar, ΔLC menor
    diagRow("MLB4", { preco: 30, retorno: 0 }), // nao_entrar
  ];
  const snaps = ["MLB1", "MLB2", "MLB3", "MLB4"].map((id) => snapRow(id));
  const vendas = new Map([["MLB1", { unidades: 50 }], ["MLB3", { unidades: 2 }]]);
  const padrao = await listarOportunidades({ clienteSlug: "loja-a", clienteContaId: 7 }, deps(fakeDb({ itens, snaps }), vendas));
  // MLB3 tem histórico (2 un) e MLB2 não: dentro de `entrar`, quem tem histórico vem primeiro.
  assert.deepStrictEqual(padrao.oportunidades.map((o) => [o.itemId, o.veredito]), [["MLB3", "entrar"], ["MLB2", "entrar"], ["MLB1", "entrar_se_girar"]]);
  assert.ok(padrao.oportunidades[0].delta_lc >= 0 && padrao.oportunidades[2].delta_lc < 0);
  const todos = await listarOportunidades({ clienteSlug: "loja-a", clienteContaId: 7, veredito: "todos" }, deps(fakeDb({ itens, snaps }), vendas));
  assert.deepStrictEqual(todos.oportunidades.map((o) => o.itemId), ["MLB3", "MLB2", "MLB1", "MLB4"]);
  assert.strictEqual(todos.oportunidades[3].veredito, "nao_entrar");
  assert.strictEqual(todos.oportunidades[3].empate_volume, null);
  assert.strictEqual(todos.filtro.veredito, "todos");
  assert.strictEqual(todos.total, 4);
  const so = await listarOportunidades({ clienteSlug: "loja-a", clienteContaId: 7, veredito: "nao_entrar" }, deps(fakeDb({ itens, snaps }), vendas));
  assert.deepStrictEqual(so.oportunidades.map((o) => o.itemId), ["MLB4"]);
  assert.strictEqual(so.total, 1);
});

cenario("sem histórico de vendas: flag sem_historico e ordem por ΔLC por unidade; vendas indisponíveis também não pesam", async () => {
  const itens = [diagRow("MLB1", { preco: 90, retorno: 1 }), diagRow("MLB2", { preco: 90, retorno: 6 })];
  const snaps = [snapRow("MLB1"), snapRow("MLB2")];
  const r = await listarOportunidades({ clienteSlug: "loja-a", clienteContaId: 7, veredito: "todos" }, deps(fakeDb({ itens, snaps })));
  assert.deepStrictEqual(r.oportunidades.map((o) => o.itemId), ["MLB2", "MLB1"], "maior ΔLC por unidade primeiro");
  assert.ok(r.oportunidades.every((o) => o.flags.sem_historico === true && o.impacto_lc === null && o.unidades === 0));
  const d = deps(fakeDb({ itens, snaps }));
  d.carregarRealizada = async () => ({ porMlb: new Map(), periodo: null, indisponivel: { motivo: "SEM_SINCRONIZACAO", mensagem: "x" } });
  const indisp = await listarOportunidades({ clienteSlug: "loja-a", clienteContaId: 7, veredito: "todos" }, d);
  assert.ok(indisp.oportunidades.every((o) => o.unidades === null && o.flags.sem_historico === true), "unidades null (não 0), sem peso no ranking");
});

cenario("insumo ausente não some da lista: vira `bloqueado` com o motivo (e nunca estima)", async () => {
  const itens = [diagRow("MLB1"), diagRow("MLB2"), diagRow("MLB3"), diagRow("MLB4")];
  const snaps = [
    snapRow("MLB1", { rate: null, commission: 12 }), // sem taxa de comissão: sem estimativa de comissão'
    snapRow("MLB2", { tax: null }), // sem imposto
    snapRow("MLB3", { freight: null }), // sem frete e logística desconhecida
    snapRow("MLB4", { cost: null }),
  ];
  const padrao = await listarOportunidades({ clienteSlug: "loja-a", clienteContaId: 7 }, deps(fakeDb({ itens, snaps })));
  assert.strictEqual(padrao.oportunidades.length, 0, "a lista padrão só traz o que vale entrar");
  assert.strictEqual(padrao.contagem.bloqueado, 4);
  const todos = await listarOportunidades({ clienteSlug: "loja-a", clienteContaId: 7, veredito: "bloqueado" }, deps(fakeDb({ itens, snaps })));
  const motivos = Object.fromEntries(todos.oportunidades.map((o) => [o.itemId, o.veredito_motivo]));
  assert.deepStrictEqual(motivos, { MLB1: "comissao_indisponivel", MLB2: "aliquota_ausente", MLB3: "frete_atual_ausente", MLB4: "custo_ausente" });
  assert.ok(todos.oportunidades.every((o) => o.margemDepois === null && o.lucroDepois === null && o.delta_lc === null));
});

cenario("logística combinável: frete ausente é zero DECLARADO (não bloqueia); o tipo vem do cadastro do anúncio", async () => {
  const itens = [diagRow("MLB1", { preco: 90 }), diagRow("MLB2", { preco: 90 })];
  const snaps = [snapRow("MLB1", { freight: null }), snapRow("MLB2", { freight: null })];
  const anuncios = [{ item_id: "MLB1", logistic_type: "custom" }]; // MLB2 sem cadastro
  const r = await listarOportunidades({ clienteSlug: "loja-a", clienteContaId: 7, veredito: "todos" }, deps(fakeDb({ itens, snaps, anuncios })));
  const por = Object.fromEntries(r.oportunidades.map((o) => [o.itemId, o]));
  assert.notStrictEqual(por.MLB1.veredito, "bloqueado");
  assert.strictEqual(por.MLB1.cenario.frete, 0);
  assert.strictEqual(por.MLB2.veredito, "bloqueado");
});

cenario("margem atual com retorno ML da promoção em andamento: ΔLC parte da MESMA composição de hoje; rebate ambíguo bloqueia", async () => {
  const itens = [diagRow("MLB1", { preco: 90 }), diagRow("MLB2", { preco: 90 })];
  const snaps = [snapRow("MLB1"), snapRow("MLB2")];
  const sem = await listarOportunidades({ clienteSlug: "loja-a", clienteContaId: 7 }, deps(fakeDb({ itens, snaps })));
  const db = fakeDb({ itens, snaps });
  db.rebates = [{ item_id: "MLB1", promocoes: 1, subsidio: "3.30" }, { item_id: "MLB2", promocoes: 2, subsidio: "5.00" }];
  const com = await listarOportunidades({ clienteSlug: "loja-a", clienteContaId: 7, veredito: "todos" }, deps(db));
  const a = Object.fromEntries(sem.oportunidades.map((o) => [o.itemId, o]));
  const b = Object.fromEntries(com.oportunidades.map((o) => [o.itemId, o]));
  assert.strictEqual(b.MLB1.margemAtualRebate, 3.3);
  assert.strictEqual(b.MLB1.atual.lc, Math.round((a.MLB1.atual.lc + 3.3) * 100) / 100, "LC de hoje inclui o retorno");
  assert.strictEqual(Math.round((a.MLB1.delta_lc - b.MLB1.delta_lc) * 100) / 100, 3.3, "ΔLC é medido contra a margem de hoje com retorno");
  assert.strictEqual(b.MLB2.veredito, "bloqueado");
  assert.strictEqual(b.MLB2.veredito_motivo, "rebate_ambiguo");
  assert.strictEqual(b.MLB2.flags.rebate_ambiguo, true);
});

cenario("filtro `veredito` desconhecido: 400 antes de qualquer leitura (nunca ignorado em silêncio)", async () => {
  const db = fakeDb({ itens: [diagRow("MLB1")], snaps: [snapRow("MLB1")] });
  await assert.rejects(
    () => listarOportunidades({ clienteSlug: "loja-a", clienteContaId: 7, veredito: "talvez" }, deps(db)),
    (err) => err.statusCode === 400 && err.code === "FILTRO_INVALIDO"
  );
  assert.strictEqual(db.queries.length, 0);
  assert.deepStrictEqual(parseVeredito(undefined), ["entrar", "entrar_se_girar"]);
  assert.deepStrictEqual(parseVeredito("Entrar, nao_entrar"), ["entrar", "nao_entrar"]);
  assert.strictEqual(parseVeredito("todos"), null);
});

cenario("rankearOportunidades é pura e estável: mesma entrada embaralhada → mesma página", () => {
  const mk = (itemId, delta, unidades) => ({
    itemId, veredito: delta >= 0 ? "entrar" : "entrar_se_girar", delta_lc: delta, impacto_lc: unidades ? delta * unidades : null,
    flags: { sem_historico: !unidades }, promocao: { chave: itemId },
  });
  const base = [mk("A", 2, 10), mk("B", 5, 1), mk("C", -1, 4), mk("D", 1, 0), mk("E", 3, 0), mk("F", -4, 9)];
  const esperado = rankearOportunidades(base, { page: 1, limit: 10 }).pagina.map((c) => c.itemId);
  assert.deepStrictEqual(esperado, ["A", "B", "E", "D", "C", "F"]);
  for (const shuffled of [[...base].reverse(), [base[3], base[0], base[5], base[1], base[4], base[2]]]) {
    assert.deepStrictEqual(rankearOportunidades(shuffled, { page: 1, limit: 10 }).pagina.map((c) => c.itemId), esperado);
  }
  const p2 = rankearOportunidades(base, { page: 2, limit: 4 });
  assert.deepStrictEqual([p2.total, p2.hasNext, p2.pagina.map((c) => c.itemId)], [6, false, ["C", "F"]]);
});

cenario("motivoForaDoRanking: started/active = ativa; P' >= preço atual (ou sem preço atual) = sem_desconto_efetivo; senão elegível", () => {
  assert.strictEqual(motivoForaDoRanking({ status: "started", precoPromo: 90, precoAtual: 100 }), MOTIVO_FORA_DO_RANKING.ATIVA);
  assert.strictEqual(motivoForaDoRanking({ status: "ACTIVE", precoPromo: 90, precoAtual: 100 }), "ativa");
  assert.strictEqual(motivoForaDoRanking({ status: "candidate", precoPromo: 100, precoAtual: 100 }), "sem_desconto_efetivo", "P' igual ao atual não é desconto");
  assert.strictEqual(motivoForaDoRanking({ status: "candidate", precoPromo: 104, precoAtual: 100 }), "sem_desconto_efetivo");
  assert.strictEqual(motivoForaDoRanking({ status: "pending", precoPromo: 90, precoAtual: null }), "sem_desconto_efetivo", "sem preço atual não afirma desconto");
  assert.strictEqual(motivoForaDoRanking({ status: "candidate", precoPromo: 94.9 - 5.13, precoAtual: 94.9 }), null);
  assert.strictEqual(motivoForaDoRanking({ status: null, precoPromo: 90, precoAtual: 100 }), null, "status vazio (legado) segue aceito");
});

cenario("fonte LEGADA: promoção started/active e P' >= preço atual ficam fora do ranking", async () => {
  const itens = [
    diagRow("MLB1", { preco: 90 }), // elegível
    diagRow("MLB2", { preco: 90, status: "started" }), // ativa
    diagRow("MLB3", { preco: 90, status: "active" }), // ativa
    diagRow("MLB4", { preco: 100 }), // P' = preço atual
    diagRow("MLB5", { preco: 105 }), // P' > preço atual
    diagRow("MLB6", { preco: 90, status: "pending" }), // elegível
  ];
  const snaps = ["MLB1", "MLB2", "MLB3", "MLB4", "MLB5", "MLB6"].map((id) => snapRow(id));
  const r = await listarOportunidades({ clienteSlug: "loja-a", clienteContaId: 7 }, deps(fakeDb({ itens, snaps })));
  assert.strictEqual(r.fonte.tipo, "diagnostico_legado");
  assert.deepStrictEqual(r.oportunidades.map((o) => o.itemId).sort(), ["MLB1", "MLB6"]);
  assert.ok(r.oportunidades.every((o) => o.precoPromocao < o.precoAtual));
  assert.strictEqual(r.total, 2);
});

cenario("fonte PROMO SNAPSHOT: mesma regra — started/active e P' >= preço atual fora; o resto entra", async () => {
  const promos = [
    { item_id: "MLB1", chave: "a", preco_promo: 90, retorno: 0, promo_status: "candidate" },
    { item_id: "MLB2", chave: "b", preco_promo: 90, retorno: 3.3, promo_status: "started" },
    { item_id: "MLB3", chave: "c", preco_promo: 90, retorno: 0, promo_status: "active" },
    { item_id: "MLB4", chave: "d", preco_promo: 100, retorno: 0, promo_status: "candidate" },
    { item_id: "MLB5", chave: "e", preco_promo: 99.99, retorno: 0, promo_status: "pending" },
  ];
  const snapPorItem = new Map(["MLB1", "MLB2", "MLB3", "MLB4", "MLB5"].map((id) => [id, snapRow(id)]));
  const d = deps(fakeDb());
  d.promo = {
    estadoComAutoTrigger: async () => ({ estado: { state: "ready", hasSnapshot: true, snapshotRunId: 9, snapshotAt: new Date().toISOString(), total: 5, workerEnabled: true }, gatilho: { acao: "nenhuma" } }),
    syncPublico: (e) => ({ ...e }),
    listarElegiveis: async () => elegiveisReferencia({ promos, snapPorItem }),
  };
  const r = await listarOportunidades({ clienteSlug: "loja-a", clienteContaId: 7 }, d);
  assert.strictEqual(r.fonte.tipo, "promo_snapshot");
  assert.deepStrictEqual(r.oportunidades.map((o) => o.itemId).sort(), ["MLB1", "MLB5"]);
  assert.ok(r.oportunidades.every((o) => o.precoPromocao < o.precoAtual && !["started", "active"].includes(o.promocao.status)));
});

cenario("performance: 3 consultas ao banco (cabeçalho, elegíveis, rebates da conta) para a conta inteira, página fatiada no serviço, zero ML", async () => {
  const itens = Array.from({ length: 300 }, (_, i) => diagRow(`MLB${i + 1}`));
  const snaps = itens.map((r) => snapRow(r.item_id));
  const db = fakeDb({ itens, snaps });
  const r = await listarOportunidades({ clienteSlug: "loja-a", clienteContaId: 7, page: 3, limit: 20 }, deps(db));
  assert.strictEqual(db.queries.length, 3, "cabeçalho do diagnóstico + UMA consulta de elegíveis + UMA de rebates da conta (nunca por item)");
  const elegiveis = db.queries.find((q) => /WITH promos AS/.test(q.sql));
  const rebates = db.queries.find((q) => /FROM promo_snapshot_contas c/.test(q.sql));
  assert.strictEqual(rebates.params[3], null, "rebates da conta inteira numa consulta só");
  assert.ok(!/LIMIT|OFFSET/.test(elegiveis.sql), "a página não é do banco: a ordem depende do cálculo do núcleo");
  assert.ok(!/ROUND\(|margem_depois|lucro/i.test(elegiveis.sql), "nenhuma fórmula financeira no SQL");
  assert.strictEqual(db.linhasDevolvidas, 300);
  assert.deepStrictEqual([r.page, r.limit, r.total, r.hasNext, r.oportunidades.length], [3, 20, 300, true, 20]);
  const ultima = await listarOportunidades({ clienteSlug: "loja-a", clienteContaId: 7, page: 6, limit: 50 }, deps(fakeDb({ itens, snaps })));
  assert.deepStrictEqual([ultima.hasNext, ultima.oportunidades.length], [false, 50]);
  const alem = await listarOportunidades({ clienteSlug: "loja-a", clienteContaId: 7, page: 7, limit: 50 }, deps(fakeDb({ itens, snaps })));
  assert.deepStrictEqual([alem.hasNext, alem.oportunidades.length, alem.total], [false, 0, 300]);
});

// ── Refresh pontual do snapshot ────────────────────────────────────────────

cenario("snapshot do item: contexto SEM vendas, 1 item, run_id nulo, upsert com a conta explícita", async () => {
  const chamadas = { prepare: null, enrich: null, upsert: null };
  const item = {
    identity: { itemId: "MLB100", sku: "S", titulo: "T", image: null },
    fields: { price: { projected: { value: 114.9 } } },
    margin: { projected: { profit: 19.6, margin: 0.17, marginPercent: 17, missing: [], assumed: [] }, target: { marginTarget: 0.1 } },
    quality: { status: "HEALTHY", confidence: "HIGH", confidenceByField: {}, reasons: [], divergences: [] },
  };
  const r = await atualizarSnapshotDoItem(
    { clienteSlug: "loja-a", clienteId: 3, clienteContaId: 7, itemId: "MLB100" },
    {
      limiter: { aguardarVez: async () => {} },
      prepareWorkspaceContext: async (params, d) => { chamadas.prepare = { params, vendas: await d.carregarVendas() }; return { base: { id: 4 }, now: new Date("2026-09-30T12:00:00Z") }; },
      enrichBatch: async (_p, opts) => { chamadas.enrich = opts; return { itens: [item] }; },
      upsertProjectionSnapshot: async (dados) => { chamadas.upsert = dados; },
    }
  );
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(chamadas.prepare.params, { clienteSlug: "loja-a", clienteContaId: 7 });
  assert.deepStrictEqual(chamadas.prepare.vendas.pedidos, []);
  assert.deepStrictEqual(chamadas.enrich, { itemIds: ["MLB100"] });
  assert.strictEqual(chamadas.upsert.runId, null);
  assert.strictEqual(chamadas.upsert.clienteContaId, 7);
  assert.strictEqual(chamadas.upsert.baseId, 4);
  assert.strictEqual(chamadas.upsert.margin, 0.17);
});

cenario("snapshot do item: chamadas concorrentes do mesmo item compartilham 1 leitura (single-flight)", async () => {
  let enrich = 0;
  let liberar;
  const trava = new Promise((r) => { liberar = r; });
  const d = {
    limiter: { aguardarVez: async () => {} },
    prepareWorkspaceContext: async () => ({ base: null, now: null }),
    enrichBatch: async () => { enrich += 1; await trava; return { itens: [] }; },
    upsertProjectionSnapshot: async () => {},
  };
  const p = { clienteSlug: "loja-a", clienteId: 3, clienteContaId: 7, itemId: "MLB200" };
  const a = atualizarSnapshotDoItem(p, d);
  const b = atualizarSnapshotDoItem(p, d);
  assert.strictEqual(a, b);
  await new Promise((r) => setImmediate(r));
  liberar();
  const r = await a;
  assert.strictEqual(r.ok, false);
  assert.strictEqual(enrich, 1);
});

async function main() {
  let falhas = 0;
  for (const caso of casos) {
    try {
      await caso.fn();
      console.log(`  ✓ ${caso.nome}`);
    } catch (err) {
      falhas += 1;
      console.error(`  ✗ ${caso.nome}\n    ${err.stack || err.message}`);
    }
  }
  if (falhas > 0) {
    console.error(`margemPrecificacaoOportunidades: ${falhas} de ${casos.length} cenários falharam`);
    process.exitCode = 1;
  } else {
    console.log(`margemPrecificacaoOportunidades: ok (${casos.length} cenários)`);
  }
}

main();
