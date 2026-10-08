// server/tests/meliAnunciosFiltrosCombinaveis.test.js
//
// Filtros COMBINÁVEIS da lista de Anúncios ML + o recorte "Sem custo".
//
// O que este teste protege:
//
//  1. `filtro` e `status` aceitam lista (vírgula); valor único gera o MESMO
//     SQL de antes (contrato dos testes de listagem intacto);
//  2. eixos diferentes combinam por E; faixas do mesmo eixo (status, score)
//     combinam por OU — combinar por E daria lista sempre vazia;
//  3. valor desconhecido continua ignorado;
//  4. "sem_custo" só entra com a Base resolvida (param base_id, mesma chave
//     com/sem prefixo MLB da leitura de custos); sem Base é ignorado;
//  5. o controller resolve a Base pelo contexto do Motor só quando o filtro
//     pede, e avisa em `filtrosIgnorados` quando não há Base;
//  6. o resumo traz `semCusto` (null + motivo sem Base) e
//     resolverBaseDeCustos nunca lança.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");

const familiaService = require("../services/meliAnuncios/meliFamiliaService");
const anunciosService = require("../services/meliAnuncios/meliAnunciosService");
const custosLoteService = require("../services/meliAnuncios/meliCustosLoteService");
const ctrl = require("../controllers/meliAnunciosController");

let casos = 0;
async function caso(nome, fn) {
  await fn();
  casos++;
  console.log("  ✓ " + nome);
}

function respostaFalsa() {
  return {
    statusCode: 200,
    corpo: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.corpo = b; return this; },
  };
}

(async () => {
  // ── 1–4: construirFiltroBase (puro) ──────────────────────────────────────
  await caso("filtro único gera o mesmo predicado de antes", async () => {
    const r = familiaService.construirFiltroBase({ clienteId: 1, filtro: "sem_sku", status: "active" });
    assert.deepStrictEqual(r.params, [1, "active"]);
    assert.strictEqual(r.matchSql, "b.status = $2 AND (b.sku IS NULL OR b.sku = '')");
  });

  await caso("eixos diferentes combinam por E", async () => {
    const r = familiaService.construirFiltroBase({ clienteId: 1, filtro: "sem_sku,mercado_full" });
    assert.strictEqual(r.matchSql, "(b.sku IS NULL OR b.sku = '') AND b.is_full = true");
  });

  await caso("faixas de score combinam por OU", async () => {
    const r = familiaService.construirFiltroBase({ clienteId: 1, filtro: "score_baixo,score_medio,sem_sku" });
    assert.ok(r.matchSql.startsWith("(b.sku IS NULL OR b.sku = '') AND ("), r.matchSql);
    assert.ok(r.matchSql.includes("COALESCE(b.score_venforce, 0) < 60 OR (COALESCE(b.score_venforce, 0) >= 60"), r.matchSql);
  });

  await caso("vários status viram ANY(lista)", async () => {
    const r = familiaService.construirFiltroBase({ clienteId: 1, status: "active,paused" });
    assert.deepStrictEqual(r.params, [1, ["active", "paused"]]);
    assert.strictEqual(r.matchSql, "b.status = ANY($2::text[])");
    assert.strictEqual(r.nextParamIndex, 3);
  });

  await caso("valor desconhecido e repetido são ignorados", async () => {
    const r = familiaService.construirFiltroBase({ clienteId: 1, filtro: "xpto,sem_sku,sem_sku" });
    assert.strictEqual(r.matchSql, "(b.sku IS NULL OR b.sku = '')");
    assert.deepStrictEqual(familiaService.normalizarFiltros("a, sem_custo ,"), ["sem_custo"]);
  });

  await caso("sem_custo com Base: NOT EXISTS na Base, chave com e sem MLB", async () => {
    const r = familiaService.construirFiltroBase({
      clienteId: 1, clienteContaId: 10, q: "kit", status: "active", filtro: "sem_custo,sem_sku", baseCustoId: 77,
    });
    assert.deepStrictEqual(r.params, [1, 10, "%kit%", "active", 77]);
    assert.ok(r.matchSql.includes("NOT EXISTS (SELECT 1 FROM custos c"), r.matchSql);
    assert.ok(/c\.base_id = \$5/.test(r.matchSql), r.matchSql);
    assert.ok(r.matchSql.includes("c.sku_id = ''") && r.matchSql.includes("c.custo_produto IS NOT NULL"));
    assert.ok(r.matchSql.includes("REGEXP_REPLACE(UPPER(b.item_id), '^MLB', '')"));
    assert.ok(r.matchSql.includes("(b.sku IS NULL OR b.sku = '')"));
    assert.strictEqual(r.nextParamIndex, 6);
  });

  await caso("sem_custo sem Base é ignorado (não filtra nada às cegas)", async () => {
    const r = familiaService.construirFiltroBase({ clienteId: 1, filtro: "sem_custo" });
    assert.deepStrictEqual(r.params, [1]);
    assert.strictEqual(r.matchSql, "TRUE");
  });

  // ── 5: controller listarAgrupado ─────────────────────────────────────────
  const original = {
    resolverCliente: anunciosService.resolverCliente,
    listarAgrupado: familiaService.listarAgrupado,
    resolverBaseDeCustos: custosLoteService.resolverBaseDeCustos,
    contarSemCusto: familiaService.contarSemCusto,
    obterResumo: anunciosService.obterResumo,
  };
  let chamadaLista = null;
  let basesResolvidas = 0;
  let baseStub = { base: { id: 77, slug: "base-a", nome: "Base A" }, motivo: "OK", mensagem: null };
  anunciosService.resolverCliente = async () => ({ id: 1, slug: "cliente-a", nome: "Cliente A" });
  familiaService.listarAgrupado = async (args) => {
    chamadaLista = args;
    return { anuncios: [], paginacao: { page: 1, limit: 20, total: 0, totalPaginas: 1 } };
  };
  custosLoteService.resolverBaseDeCustos = async () => { basesResolvidas++; return baseStub; };

  try {
    await caso("controller: sem_custo resolve a Base e repassa baseCustoId", async () => {
      const res = respostaFalsa();
      await ctrl.listarAgrupado({ query: { clienteSlug: "cliente-a", filtro: "sem_custo,sem_sku", status: "active" } }, res);
      assert.strictEqual(res.corpo.ok, true);
      assert.strictEqual(chamadaLista.baseCustoId, 77);
      assert.strictEqual(chamadaLista.filtro, "sem_custo,sem_sku");
      assert.strictEqual(res.corpo.filtrosIgnorados, undefined);
    });

    await caso("controller: sem sem_custo não resolve Base", async () => {
      basesResolvidas = 0;
      const res = respostaFalsa();
      await ctrl.listarAgrupado({ query: { clienteSlug: "cliente-a", filtro: "sem_sku" } }, res);
      assert.strictEqual(basesResolvidas, 0);
      assert.strictEqual(chamadaLista.baseCustoId, null);
    });

    await caso("controller: sem Base, sem_custo vai em filtrosIgnorados", async () => {
      baseStub = { base: null, motivo: "BASE_MELI_NAO_VINCULADA", mensagem: "Nenhuma base vinculada." };
      const res = respostaFalsa();
      await ctrl.listarAgrupado({ query: { clienteSlug: "cliente-a", filtro: "sem_custo" } }, res);
      assert.strictEqual(chamadaLista.baseCustoId, null);
      assert.deepStrictEqual(res.corpo.filtrosIgnorados, [{ filtro: "sem_custo", motivo: "Nenhuma base vinculada." }]);
    });

    // ── 6: resumo ──────────────────────────────────────────────────────────
    anunciosService.obterResumo = async () => ({ total: 10, ativos: 8 });
    familiaService.contarSemCusto = async ({ baseCustoId }) => (baseCustoId === 77 ? 4 : -1);

    await caso("resumo: semCusto conta pela Base do contexto", async () => {
      baseStub = { base: { id: 77, slug: "base-a", nome: "Base A" }, motivo: "OK", mensagem: null };
      const res = respostaFalsa();
      await ctrl.resumo({ query: { clienteSlug: "cliente-a" } }, res);
      assert.strictEqual(res.corpo.resumo.semCusto, 4);
      assert.strictEqual(res.corpo.resumo.semCustoMotivo, null);
    });

    await caso("resumo: sem Base, semCusto é null com motivo (nunca zero)", async () => {
      baseStub = { base: null, motivo: "BASE_MELI_NAO_VINCULADA", mensagem: "Nenhuma base vinculada." };
      const res = respostaFalsa();
      await ctrl.resumo({ query: { clienteSlug: "cliente-a" } }, res);
      assert.strictEqual(res.corpo.resumo.semCusto, null);
      assert.strictEqual(res.corpo.resumo.semCustoMotivo, "Nenhuma base vinculada.");
    });
  } finally {
    Object.assign(anunciosService, { resolverCliente: original.resolverCliente, obterResumo: original.obterResumo });
    Object.assign(familiaService, { listarAgrupado: original.listarAgrupado, contarSemCusto: original.contarSemCusto });
    custosLoteService.resolverBaseDeCustos = original.resolverBaseDeCustos;
  }

  await caso("resumo: card Score médio conta a faixa 60–79 (o filtro), não a média", async () => {
    const pool = require("../config/database");
    const queryOriginal = pool.query;
    let sqlResumo = "";
    pool.query = async (sql) => {
      const q = String(sql).replace(/\s+/g, " ");
      if (!q.includes("AS ativos")) return { rows: [] };
      sqlResumo = q;
      // Catálogo do print (Red Fish): todos ≥ 80, média 91, ninguém na faixa média.
      return { rows: [{ total: 175, ativos: 156, score_muito_bom: 175, score_baixo: 0, score_faixa_media: 0, score_medio: 91 }] };
    };
    try {
      const r = await anunciosService.obterResumo(1);
      assert.strictEqual(r.scoreFaixaMedia, 0, "o card tem de mostrar 0 — é o que o filtro devolve");
      assert.strictEqual(r.scoreMedio, 91, "a média continua disponível, com o nome de média");
      assert.ok(sqlResumo.includes("COALESCE(score_venforce,0) >= 60 AND COALESCE(score_venforce,0) < 80)::int AS score_faixa_media"), sqlResumo);
    } finally {
      pool.query = queryOriginal;
    }
  });

  await caso("resolverBaseDeCustos nunca lança (erro estrutural vira base null)", async () => {
    const erro = Object.assign(new Error("x"), { statusCode: 409, payload: { codigo: "CONTA_AMBIGUA", erro: "Escolha a conta." } });
    const r = await custosLoteService.resolverBaseDeCustos(
      { clienteSlug: "cliente-a" },
      { resolverContextoPrecificacao: async () => { throw erro; } }
    );
    assert.deepStrictEqual(r, { base: null, motivo: "CONTA_AMBIGUA", mensagem: "Escolha a conta." });
    const ok = await custosLoteService.resolverBaseDeCustos(
      { clienteSlug: "cliente-a" },
      { resolverContextoPrecificacao: async () => ({ pronto: true, base: { id: 5, slug: "b", nome: "B", ativo: true }, motivo: "OK" }) }
    );
    assert.deepStrictEqual(ok.base, { id: 5, slug: "b", nome: "B" });
  });

  console.log(`\n${casos}/${casos} casos`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
