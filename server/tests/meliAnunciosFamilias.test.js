// server/tests/meliAnunciosFamilias.test.js
//
// LISTAGEM UNIFICADA de anúncios ML — uma lista só, com agrupador quando o
// Mercado Livre agrupou o produto.
//
//   GET /anuncios-meli/familias            -> a lista (linhas familia|item)
//   GET /anuncios-meli/familias/:familyId  -> a expansão de um agrupador
//
// Ver docs/AUDITORIA_ANUNCIOS_ML_LISTAGEM_UNIFICADA.md. O que estes testes
// protegem, além do que já protegiam antes:
//
//   · anúncio agrupado e anúncio sem agrupamento vivem na MESMA lista, na
//     mesma paginação — nunca em dois blocos;
//   · estoque do agrupador soma por USER PRODUCT distinto, não por MLB. Um UP
//     com 3 MLBs conta o estoque UMA vez. É a regra que a doc do ML fixa
//     (available_quantity é sincronizado entre os itens de um mesmo UP);
//   · vendidos, ao contrário, soma por ITEM — sold_quantity não está na lista
//     de campos sincronizados por UP;
//   · busca/status/filtro casam por item e trazem o GRUPO inteiro, com os
//     agregados do grupo inteiro (filtrar não muda o estoque do produto).
//
// Regra canônica da modelagem (decisão explícita, não presumida):
//   meli_anuncios        = autoridade de account-scope (cliente_conta_id)
//   meli_user_products   = autoridade da hierarquia (user_product_id -> family_id)
//
// meli_user_products.cliente_conta_id NUNCA é usado como fronteira de
// segurança — toda leitura parte de meli_anuncios já filtrado pela conta, e
// só então junta com meli_user_products para achar a família.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");

const pool = require("../config/database");
const meliFamiliaService = require("../services/meliAnuncios/meliFamiliaService");
const ctrl = require("../controllers/meliAnunciosController");

// ── fixtures ────────────────────────────────────────────────────────────────

const cliente = { id: 1, nome: "Cliente A", slug: "cliente-a", ativo: true };

function grantFixture({ id, cliente_id, ml_user_id }) {
  return {
    id, cliente_id, ml_user_id,
    access_token: "tok", refresh_token: "ref",
    expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    token_status: "valid", is_primary: false,
    refresh_failures: 0, updated_at: new Date().toISOString(),
  };
}

function anuncioFixture(over = {}) {
  return {
    cliente_id: 1,
    item_id: "MLB1",
    user_product_id: "UP1",
    cliente_conta_id: 10,
    titulo: "Produto 1",
    status: "active",
    preco: 10,
    moeda: "BRL",
    estoque: 5,
    vendidos: 0,
    sku: "SKU1",
    thumbnail: "http://thumb/1",
    permalink: "http://ml/1",
    pictures_count: 5,
    is_full: false,
    revisado: false,
    score_venforce: null,
    score_motivo: null,
    catalog_listing: false,
    family_name: null,
    updated_at: null,
    ...over,
  };
}

function upFixture(over = {}) {
  return {
    cliente_id: 1,
    user_product_id: "UP1",
    family_id: "FAM1",
    family_name: "Familia 1",
    site_id: "MLB",
    domain_id: "MLB-DOM",
    ...over,
  };
}

// ── MockDb ──────────────────────────────────────────────────────────────────
//
// As leituras usam CTEs que seriam frágeis de casar por texto exato. Cada
// query real carrega uma tag única (comentário SQL) só para o mock reconhecer
// QUAL consulta é — a lógica de junção/agregação é recalculada aqui em
// memória, espelhando exatamente o que o Postgres faria com os mesmos dados.

function contaFiltro(a, clienteContaId, includeLegacy) {
  if (clienteContaId == null) return true;
  if (includeLegacy) return a.cliente_conta_id === clienteContaId || a.cliente_conta_id == null;
  return a.cliente_conta_id === clienteContaId;
}

// Espelha os predicados de `selecionados` (busca + status + card de KPI). Em
// vez de adivinhar o filtro pelo texto da query inteira — onde
// `b.status = 'paused'` aparece também nos COUNT(*) FILTER dos agregados —, o
// mock extrai só o WHERE daquela CTE e testa contra ele. Sem isso, um
// agregado passaria por filtro.
function casaSelecionado(whereMatch, linha, qTerm, statusParam) {
  const a = linha.a;
  const contem = (v) => Boolean(v && String(v).toLowerCase().includes(qTerm));

  if (whereMatch.includes("b.titulo ILIKE")) {
    const casou = contem(a.titulo) || contem(a.item_id) || contem(a.sku) ||
      contem(linha.up_family_name) || contem(a.user_product_id);
    if (!casou) return false;
  }
  if (whereMatch.includes("b.status = $") && a.status !== statusParam) return false;

  if (whereMatch.includes("COALESCE(b.pictures_count, 0) < 3") && (a.pictures_count || 0) >= 3) return false;
  if (whereMatch.includes("COALESCE(b.score_venforce, 0) < 60") && (a.score_venforce || 0) >= 60) return false;
  if (whereMatch.includes("(b.sku IS NULL OR b.sku = '')") && a.sku) return false;
  if (whereMatch.includes("b.score_motivo = 'Ficha técnica incompleta'") &&
      a.score_motivo !== "Ficha técnica incompleta") return false;
  if (whereMatch.includes("b.status = 'paused'") && a.status !== "paused") return false;
  if (whereMatch.includes("COALESCE(b.score_venforce, 0) >= 80") && (a.score_venforce || 0) < 80) return false;
  if (whereMatch.includes("COALESCE(b.score_venforce, 0) >= 60 AND") &&
      !((a.score_venforce || 0) >= 60 && (a.score_venforce || 0) < 80)) return false;
  if (whereMatch.includes("b.is_full = true") && a.is_full !== true) return false;
  if (whereMatch.includes("b.family_id IS NULL") && linha.family_id != null) return false;

  return true;
}

class MockDb {
  constructor({ contas = [], grants = [], anuncios = [], userProducts = [] } = {}) {
    this.contas = contas;
    this.grants = grants;
    this.anuncios = anuncios;
    this.userProducts = userProducts;
  }

  async connect() {
    return { query: (sql, params) => this.query(sql, params), release() {} };
  }

  upFor(clienteId, userProductId) {
    return this.userProducts.find(
      (u) => u.cliente_id === clienteId && u.user_product_id === userProductId
    );
  }

  // A CTE `base` da consulta unificada: meli_anuncios já filtrado pela conta,
  // com LEFT JOIN em meli_user_products e a chave de grupo derivada.
  baseCte(clienteId, clienteContaId, includeLegacy) {
    return this.anuncios
      .filter((a) => a.cliente_id === clienteId && contaFiltro(a, clienteContaId, includeLegacy))
      .map((a) => {
        const up = a.user_product_id ? this.upFor(clienteId, a.user_product_id) : null;
        const familyId = up && up.family_id != null ? up.family_id : null;
        return {
          a,
          family_id: familyId,
          up_family_name: up ? up.family_name : null,
          grupo_key: familyId != null ? `fam:${familyId}` : `item:${a.item_id}`,
        };
      });
  }

  async query(sql, params = []) {
    const q = String(sql).replace(/\s+/g, " ").trim();

    // --- fundação Cliente/Conta (mesmo padrão dos outros testes do módulo) --
    if (q.includes("FROM clientes WHERE id = $1")) {
      return { rows: cliente.id === Number(params[0]) ? [cliente] : [] };
    }
    if (q.includes("FROM clientes WHERE LOWER(slug) = $1")) {
      return { rows: cliente.slug === params[0] ? [cliente] : [] };
    }
    if (q.startsWith("SELECT * FROM cliente_contas WHERE id = $1")) {
      const conta = this.contas.find((c) => c.id === Number(params[0]));
      return { rows: conta ? [conta] : [] };
    }
    if (q.includes("FROM cliente_contas WHERE cliente_id = $1 AND marketplace = $2 AND ativo = true ORDER BY is_primary")) {
      return { rows: this.contas.filter((c) => c.cliente_id === params[0] && c.marketplace === params[1] && c.ativo !== false) };
    }
    if (q.includes("COUNT(*)::int AS total FROM cliente_contas")) {
      const total = this.contas.filter((c) => c.cliente_id === params[0] && c.ativo !== false && c.marketplace === "meli").length;
      return { rows: [{ total }] };
    }
    if (q.includes("t.cliente_id = $1 AND t.ml_user_id = $2")) {
      const row = this.grants.find((g) => g.cliente_id === params[0] && String(g.ml_user_id) === String(params[1]));
      return { rows: row ? [row] : [] };
    }
    if (q.includes("FROM ml_tokens t") && q.includes("WHERE t.cliente_id = $1")) {
      return { rows: this.grants.filter((g) => g.cliente_id === params[0]) };
    }
    if (q.includes("base_cliente_vinculos")) {
      return { rows: [] };
    }
    if (q.startsWith("CREATE TABLE") || q.startsWith("ALTER TABLE") || q.startsWith("CREATE INDEX")) {
      return { rows: [] };
    }

    // --- LISTAR_AGRUPADO_PAGINA -------------------------------------------
    if (q.includes("-- LISTAR_AGRUPADO_PAGINA")) {
      let i = 0;
      const clienteId = params[i++];
      const temConta = q.includes("a.cliente_conta_id = $");
      const includeLegacy = temConta ? q.includes("OR a.cliente_conta_id IS NULL)") : true;
      const clienteContaId = temConta ? params[i++] : null;
      const temQ = q.includes("b.titulo ILIKE $");
      const qTerm = temQ ? String(params[i++]).replace(/^%|%$/g, "").toLowerCase() : null;
      const temStatus = q.includes("b.status = $");
      const statusParam = temStatus ? params[i++] : null;
      const lim = params[i++];
      const offset = params[i++];

      const whereMatch = (q.match(/FROM base b WHERE (.*?) \), grupos AS/) || [])[1] || "TRUE";
      this.matchWhere = whereMatch; // exposto para os testes de predicado

      const base = this.baseCte(clienteId, clienteContaId, includeLegacy);

      // estoque_por_up -> estoque_grupo: colapsa por UP distinto ANTES de
      // somar. É o coração da regra de estoque.
      const estoquePorGrupo = new Map();
      for (const linha of base) {
        const upKey = linha.a.user_product_id || `item:${linha.a.item_id}`;
        const porUp = estoquePorGrupo.get(linha.grupo_key) || new Map();
        const atual = porUp.has(upKey) ? porUp.get(upKey) : null;
        const valor = linha.a.estoque == null ? null : Number(linha.a.estoque);
        porUp.set(upKey, atual == null ? valor : (valor == null ? atual : Math.max(atual, valor)));
        estoquePorGrupo.set(linha.grupo_key, porUp);
      }

      const selecionados = new Set(
        base.filter((l) => casaSelecionado(whereMatch, l, qTerm, statusParam)).map((l) => l.grupo_key)
      );

      const num = (v) => (v == null ? null : Number(v));
      const grupos = new Map();
      for (const linha of base) {
        const g = grupos.get(linha.grupo_key) || {
          grupo_key: linha.grupo_key,
          family_id: linha.family_id,
          family_name: null,
          item_id: null,
          total_itens: 0,
          ups: new Set(),
          vendidos_total: 0,
          preco_min: null, preco_max: null, moeda: null,
          score_min: null,
          total_ativos: 0, total_pausados: 0, total_encerrados: 0,
          ord_revisado: null, ord_score: null, ord_updated: null,
        };
        const a = linha.a;
        g.total_itens++;
        if (a.user_product_id) g.ups.add(a.user_product_id);
        if (linha.up_family_name != null) {
          g.family_name = g.family_name == null || linha.up_family_name > g.family_name
            ? linha.up_family_name : g.family_name;
        }
        g.item_id = g.item_id == null || String(a.item_id) < g.item_id ? String(a.item_id) : g.item_id;
        g.vendidos_total += Number(a.vendidos || 0);
        if (num(a.preco) != null) {
          g.preco_min = g.preco_min == null ? num(a.preco) : Math.min(g.preco_min, num(a.preco));
          g.preco_max = g.preco_max == null ? num(a.preco) : Math.max(g.preco_max, num(a.preco));
        }
        if (a.moeda != null) g.moeda = g.moeda == null || a.moeda < g.moeda ? a.moeda : g.moeda;
        if (num(a.score_venforce) != null) {
          g.score_min = g.score_min == null ? num(a.score_venforce) : Math.min(g.score_min, num(a.score_venforce));
        }
        if (a.status === "active") g.total_ativos++;
        if (a.status === "paused") g.total_pausados++;
        if (a.status === "closed") g.total_encerrados++;
        const rev = a.revisado ? 1 : 0;
        g.ord_revisado = g.ord_revisado == null ? rev : Math.min(g.ord_revisado, rev);
        const sc = a.score_venforce == null ? -1 : Number(a.score_venforce);
        g.ord_score = g.ord_score == null ? sc : Math.min(g.ord_score, sc);
        const upd = a.updated_at ? new Date(a.updated_at).getTime() : null;
        if (upd != null) g.ord_updated = g.ord_updated == null ? upd : Math.max(g.ord_updated, upd);
        grupos.set(linha.grupo_key, g);
      }

      let lista = Array.from(grupos.values()).filter((g) => selecionados.has(g.grupo_key));

      lista.sort((x, y) => {
        if (x.ord_revisado !== y.ord_revisado) return x.ord_revisado - y.ord_revisado;
        if (x.ord_score !== y.ord_score) return x.ord_score - y.ord_score;
        // DESC NULLS LAST
        const xu = x.ord_updated, yu = y.ord_updated;
        if (xu !== yu) {
          if (xu == null) return 1;
          if (yu == null) return -1;
          return yu - xu;
        }
        return String(x.grupo_key).localeCompare(String(y.grupo_key));
      });

      const totalGrupos = lista.length;
      const pagina = lista.slice(offset, offset + lim).map((g) => {
        const porUp = estoquePorGrupo.get(g.grupo_key) || new Map();
        let estoqueTotal = null;
        for (const v of porUp.values()) {
          if (v == null) continue;
          estoqueTotal = (estoqueTotal == null ? 0 : estoqueTotal) + v;
        }
        return {
          grupo_key: g.grupo_key,
          family_id: g.family_id,
          family_name: g.family_name,
          item_id: g.item_id,
          total_itens: g.total_itens,
          total_user_products: g.ups.size,
          vendidos_total: g.vendidos_total,
          preco_min: g.preco_min,
          preco_max: g.preco_max,
          moeda: g.moeda,
          score_min: g.score_min,
          total_ativos: g.total_ativos,
          total_pausados: g.total_pausados,
          total_encerrados: g.total_encerrados,
          estoque_total: estoqueTotal,
          total_grupos: totalGrupos,
        };
      });
      return { rows: pagina };
    }

    // --- LISTAR_CHAVES_FILTRADAS --------------------------------------------
    if (q.includes("-- LISTAR_CHAVES_FILTRADAS")) {
      let i = 0;
      const clienteId = params[i++];
      const temConta = q.includes("a.cliente_conta_id = $");
      const includeLegacy = temConta ? q.includes("OR a.cliente_conta_id IS NULL)") : true;
      const clienteContaId = temConta ? params[i++] : null;
      const temQ = q.includes("b.titulo ILIKE $");
      const qTerm = temQ ? String(params[i++]).replace(/^%|%$/g, "").toLowerCase() : null;
      const temStatus = q.includes("b.status = $");
      const statusParam = temStatus ? params[i++] : null;

      const whereMatch = (q.match(/FROM base b WHERE (.*?) \)/) || [])[1] || "TRUE";
      const base = this.baseCte(clienteId, clienteContaId, includeLegacy);
      const selecionados = base.filter((l) => casaSelecionado(whereMatch, l, qTerm, statusParam));

      const grupos = new Map();
      for (const linha of selecionados) {
        const g = grupos.get(linha.grupo_key) || { grupo_key: linha.grupo_key, family_id: null, item_id: null };
        if (g.family_id == null) g.family_id = linha.family_id;
        if (g.item_id == null || String(linha.a.item_id) < g.item_id) g.item_id = String(linha.a.item_id);
        grupos.set(linha.grupo_key, g);
      }
      return { rows: Array.from(grupos.values()) };
    }

    // --- LISTAR_AGRUPADO_ITENS_DA_PAGINA -----------------------------------
    if (q.includes("-- LISTAR_AGRUPADO_ITENS_DA_PAGINA")) {
      let i = 0;
      const clienteId = params[i++];
      const temConta = q.includes("a.cliente_conta_id = $");
      const includeLegacy = temConta ? q.includes("OR a.cliente_conta_id IS NULL)") : true;
      const clienteContaId = temConta ? params[i++] : null;
      const itemIds = new Set(params[i++]);

      this.itensPedidos = Array.from(itemIds); // para o teste de custo por página

      const rows = this.anuncios
        .filter((a) => a.cliente_id === clienteId && itemIds.has(a.item_id) &&
                       contaFiltro(a, clienteContaId, includeLegacy))
        .map((a) => ({ ...a }));
      return { rows };
    }

    // --- LISTAR_FAMILIAS_CAPA_DA_PAGINA -----------------------------------
    //
    // Espelha o DISTINCT ON do Postgres: dentro de cada família, ordena os
    // itens do escopo pela mesma régua da consulta real e fica com o
    // primeiro. Com termo de busca, quem casa com o termo vem antes.
    if (q.includes("-- LISTAR_FAMILIAS_CAPA_DA_PAGINA")) {
      let i = 0;
      const clienteId = params[i++];
      const temConta = q.includes("a.cliente_conta_id = $");
      const includeLegacy = temConta ? q.includes("OR a.cliente_conta_id IS NULL)") : true;
      const clienteContaId = temConta ? params[i++] : null;
      const familyIds = params[i++];
      const temQ = q.includes("ILIKE $");
      const qTerm = temQ ? String(params[i++]).replace(/^%|%$/g, "").toLowerCase() : null;

      this.capaFamilyIds = familyIds;          // para o teste de custo por página
      const alvo = new Set(familyIds);

      const casa = (a, up) => {
        if (!qTerm) return false;
        return Boolean(
          (a.titulo && a.titulo.toLowerCase().includes(qTerm)) ||
          (a.sku && a.sku.toLowerCase().includes(qTerm)) ||
          (a.item_id && a.item_id.toLowerCase().includes(qTerm)) ||
          (up.user_product_id && up.user_product_id.toLowerCase().includes(qTerm))
        );
      };

      const candidatos = this.anuncios
        .filter((a) => a.cliente_id === clienteId && a.user_product_id != null && contaFiltro(a, clienteContaId, includeLegacy))
        .map((a) => ({ a, up: this.upFor(clienteId, a.user_product_id) }))
        .filter(({ up }) => up && up.family_id != null && alvo.has(up.family_id));

      const num = (v) => (v == null ? -Infinity : Number(v));
      const porFamilia = new Map();
      for (const c of candidatos) {
        const atual = porFamilia.get(c.up.family_id);
        if (!atual || melhor(c, atual) < 0) porFamilia.set(c.up.family_id, c);
      }

      function melhor(x, y) {
        const chaves = [
          [casa(y.a, y.up) ? 1 : 0, casa(x.a, x.up) ? 1 : 0],
          [y.a.thumbnail ? 1 : 0, x.a.thumbnail ? 1 : 0],
          [num(y.a.vendidos), num(x.a.vendidos)],
          [y.a.status === "active" ? 1 : 0, x.a.status === "active" ? 1 : 0],
          [num(y.a.estoque), num(x.a.estoque)],
        ];
        for (const [b, a] of chaves) if (a !== b) return a - b < 0 ? 1 : -1;
        return String(x.a.item_id).localeCompare(String(y.a.item_id));
      }

      return {
        rows: Array.from(porFamilia.values()).map(({ a, up }) => ({
          family_id: up.family_id,
          user_product_id: up.user_product_id,
          thumbnail: a.thumbnail,
        })),
      };
    }

    // --- FAMILIA_DETALHE_ITENS --------------------------------------------
    if (q.includes("-- FAMILIA_DETALHE_ITENS")) {
      let i = 0;
      const clienteId = params[i++];
      const familyId = params[i++];
      const temConta = q.includes("a.cliente_conta_id = $");
      const includeLegacy = temConta ? q.includes("OR a.cliente_conta_id IS NULL)") : true;
      const clienteContaId = temConta ? params[i++] : null;

      const escopo = this.anuncios.filter(
        (a) => a.cliente_id === clienteId && a.user_product_id != null && contaFiltro(a, clienteContaId, includeLegacy)
      );

      const rows = [];
      for (const a of escopo) {
        const up = this.upFor(clienteId, a.user_product_id);
        if (!up || up.family_id !== familyId) continue;
        rows.push({
          item_id: a.item_id,
          user_product_id: a.user_product_id,
          titulo: a.titulo,
          status: a.status,
          preco: a.preco,
          moeda: a.moeda,
          estoque: a.estoque,
          vendidos: a.vendidos,
          score_venforce: a.score_venforce,
          sku: a.sku,
          thumbnail: a.thumbnail,
          permalink: a.permalink,
          // Coluna que já existia em meli_anuncios e passou a ser projetada
          // também aqui: sem o nível do MLBU na tela, a condição comercial
          // (Clássico / Premium) é o que distingue dois MLBs da mesma variação.
          listing_type_id: a.listing_type_id == null ? null : a.listing_type_id,
          // Mesmas colunas que a listagem plana já lê para o card avulso —
          // sem elas o card do MLB dentro da família não consegue montar os
          // mesmos badges (Catálogo/Full/fotos/Revisado) do card legado.
          pictures_count: a.pictures_count,
          is_full: a.is_full,
          revisado: a.revisado,
          catalog_listing: a.catalog_listing,
          site_id: up.site_id,
          domain_id: up.domain_id,
          family_name: up.family_name,
        });
      }
      rows.sort((x, y) =>
        x.user_product_id === y.user_product_id
          ? String(x.item_id).localeCompare(String(y.item_id))
          : String(x.user_product_id).localeCompare(String(y.user_product_id))
      );
      return { rows };
    }

    // --- FAMILIAS_ITENS_BULK ------------------------------------------------
    if (q.includes("-- FAMILIAS_ITENS_BULK")) {
      let i = 0;
      const clienteId = params[i++];
      const familyIds = params[i++];
      const temConta = q.includes("a.cliente_conta_id = $");
      const includeLegacy = temConta ? q.includes("OR a.cliente_conta_id IS NULL)") : true;
      const clienteContaId = temConta ? params[i++] : null;

      const escopo = this.anuncios.filter(
        (a) => a.cliente_id === clienteId && a.user_product_id != null && contaFiltro(a, clienteContaId, includeLegacy)
      );

      const rows = [];
      for (const a of escopo) {
        const up = this.upFor(clienteId, a.user_product_id);
        if (!up || !familyIds.includes(up.family_id)) continue;
        rows.push({ item_id: a.item_id, family_id: up.family_id });
      }
      return { rows };
    }

    return { rows: [] };
  }
}

function withMockDb(dbOpts, fn) {
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  const db = new MockDb(dbOpts);
  pool.query = (sql, params) => db.query(sql, params);
  pool.connect = () => db.connect();
  return Promise.resolve()
    .then(() => fn(db))
    .finally(() => {
      pool.query = originalQuery;
      pool.connect = originalConnect;
    });
}

function fakeRes() {
  return {
    statusCode: 200,
    corpo: null,
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.corpo = obj; return this; },
  };
}

const contaA = { id: 10, cliente_id: 1, marketplace: "meli", external_account_id: "111", nome: "Conta A", ativo: true, is_primary: true };
const contaB = { id: 20, cliente_id: 1, marketplace: "meli", external_account_id: "222", nome: "Conta B", ativo: true, is_primary: false };

const porChave = (r) => {
  const m = new Map();
  for (const linha of r.anuncios) m.set(linha.key, linha);
  return m;
};

async function run() {
  // A. Hierarquia normal: Família -> múltiplos UPs -> múltiplos MLBs, tudo
  //    colapsado em UMA linha de agrupador.
  await withMockDb({
    anuncios: [
      anuncioFixture({ item_id: "MLB1a", user_product_id: "UP1" }),
      anuncioFixture({ item_id: "MLB1b", user_product_id: "UP1" }),
      anuncioFixture({ item_id: "MLB2a", user_product_id: "UP2" }),
      anuncioFixture({ item_id: "MLB2b", user_product_id: "UP2" }),
    ],
    userProducts: [
      upFixture({ user_product_id: "UP1" }),
      upFixture({ user_product_id: "UP2" }),
    ],
  }, async () => {
    const r = await meliFamiliaService.listarAgrupado({ clienteId: 1 });
    assert.strictEqual(r.anuncios.length, 1, "4 MLBs de 1 família = 1 linha");
    const fam = r.anuncios[0];
    assert.strictEqual(fam.tipo, "familia");
    assert.strictEqual(fam.key, "fam:FAM1");
    assert.strictEqual(fam.family_id, "FAM1");
    assert.strictEqual(fam.total_user_products, 2);
    assert.strictEqual(fam.total_itens, 4);
    console.log("  ✓ A. Família -> UPs -> MLBs colapsa em uma linha de agrupador");
  });

  // ── A LISTA É UMA SÓ ───────────────────────────────────────────────────
  //
  // O bug de produto que motivou a missão: a tela tinha duas listagens, e um
  // anúncio mudava de bloco quando o ML migrava o item para o modelo de User
  // Products, sem nada ter mudado no anúncio.

  // B. Agrupados e não agrupados na MESMA lista e na MESMA paginação.
  await withMockDb({
    anuncios: [
      anuncioFixture({ item_id: "MLB-FAM-1", user_product_id: "UP1" }),
      anuncioFixture({ item_id: "MLB-FAM-2", user_product_id: "UP2" }),
      // sem User Product: legado nunca migrado (relação 1:1, diz a doc)
      anuncioFixture({ item_id: "MLB-SOLO", user_product_id: null }),
      // com UP, mas o UP não tem família
      anuncioFixture({ item_id: "MLB-SEM-FAM", user_product_id: "UP-SF" }),
      // com UP referenciado que não existe em meli_user_products (órfão)
      anuncioFixture({ item_id: "MLB-ORFAO", user_product_id: "UP-FANTASMA" }),
    ],
    userProducts: [
      upFixture({ user_product_id: "UP1" }),
      upFixture({ user_product_id: "UP2" }),
      upFixture({ user_product_id: "UP-SF", family_id: null, family_name: null }),
    ],
  }, async () => {
    const r = await meliFamiliaService.listarAgrupado({ clienteId: 1 });
    assert.strictEqual(r.anuncios.length, 4, "1 agrupador + 3 individuais = 4 linhas");
    assert.strictEqual(r.paginacao.total, 4, "o total é de LINHAS, uma contagem só");

    const chaves = porChave(r);
    assert.strictEqual(chaves.get("fam:FAM1").tipo, "familia");
    assert.strictEqual(chaves.get("fam:FAM1").total_itens, 2);
    for (const id of ["MLB-SOLO", "MLB-SEM-FAM", "MLB-ORFAO"]) {
      const linha = chaves.get("item:" + id);
      assert.ok(linha, id + " precisa estar na MESMA lista");
      assert.strictEqual(linha.tipo, "item");
      assert.strictEqual(linha.family_id, null);
      assert.strictEqual(linha.item_id, id);
    }
    console.log("  ✓ B. os 3 caminhos de 'sem agrupamento' entram na mesma lista dos agrupados");
  });

  // C. A linha individual carrega os campos completos do anúncio — a tela não
  //    precisa de um renderizador mais pobre para ela.
  await withMockDb({
    anuncios: [anuncioFixture({
      item_id: "MLB-SOLO", user_product_id: null, titulo: "Solo", sku: "SKU-SOLO",
      preco: 42.5, estoque: 7, vendidos: 3, score_venforce: 71, is_full: true,
      thumbnail: "http://thumb/solo", permalink: "http://ml/solo", pictures_count: 2,
    })],
  }, async () => {
    const r = await meliFamiliaService.listarAgrupado({ clienteId: 1 });
    const linha = r.anuncios[0];
    assert.strictEqual(linha.tipo, "item");
    assert.strictEqual(linha.titulo, "Solo");
    assert.strictEqual(linha.sku, "SKU-SOLO");
    assert.strictEqual(linha.score_venforce, 71);
    assert.strictEqual(linha.is_full, true);
    assert.strictEqual(linha.pictures_count, 2);
    assert.strictEqual(linha.permalink, "http://ml/solo");
    assert.strictEqual(linha.estoque, 7, "o anúncio individual mantém o próprio estoque");
    assert.strictEqual(linha.estoque_total, 7, "e o total do grupo de um é o próprio estoque");
    console.log("  ✓ C. a linha individual traz o registro completo do anúncio");
  });

  // ── ESTOQUE: SOMA POR USER PRODUCT, NUNCA POR MLB ──────────────────────
  //
  // user-products.md lista available_quantity entre os campos que o ML
  // SINCRONIZA em todos os itens do mesmo user_product_id, e
  // estoque-distribuido.md trata o estoque como propriedade do UP. Somar item
  // a item duplicaria.

  // D. O exemplo do pedido: 3 MLBUs × 100 = 300.
  await withMockDb({
    anuncios: [
      anuncioFixture({ item_id: "MLB-AZUL-P", user_product_id: "MLBU-P", estoque: 100 }),
      anuncioFixture({ item_id: "MLB-AZUL-M", user_product_id: "MLBU-M", estoque: 100 }),
      anuncioFixture({ item_id: "MLB-AZUL-G", user_product_id: "MLBU-G", estoque: 100 }),
    ],
    userProducts: [
      upFixture({ user_product_id: "MLBU-P", family_name: "Kit 2 Camisetas De Pesca Tucunaré" }),
      upFixture({ user_product_id: "MLBU-M", family_name: "Kit 2 Camisetas De Pesca Tucunaré" }),
      upFixture({ user_product_id: "MLBU-G", family_name: "Kit 2 Camisetas De Pesca Tucunaré" }),
    ],
  }, async () => {
    const r = await meliFamiliaService.listarAgrupado({ clienteId: 1 });
    assert.strictEqual(r.anuncios.length, 1);
    assert.strictEqual(r.anuncios[0].total_user_products, 3);
    assert.strictEqual(r.anuncios[0].estoque_total, 300, "3 MLBUs × 100 = 300");
    console.log("  ✓ D. estoque do agrupador = soma dos MLBUs (3 × 100 = 300)");
  });

  // E. O caso que um SUM ingênuo erraria: UP com 3 MLBs. O estoque do UP vale
  //    UMA vez (o ML replica available_quantity entre os itens dele).
  await withMockDb({
    anuncios: [
      anuncioFixture({ item_id: "MLB-a1", user_product_id: "UP1", estoque: 100 }),
      anuncioFixture({ item_id: "MLB-a2", user_product_id: "UP1", estoque: 100 }),
      anuncioFixture({ item_id: "MLB-a3", user_product_id: "UP1", estoque: 100 }),
      anuncioFixture({ item_id: "MLB-b1", user_product_id: "UP2", estoque: 40 }),
    ],
    userProducts: [upFixture({ user_product_id: "UP1" }), upFixture({ user_product_id: "UP2" })],
  }, async () => {
    const r = await meliFamiliaService.listarAgrupado({ clienteId: 1 });
    assert.strictEqual(r.anuncios[0].total_itens, 4);
    assert.strictEqual(r.anuncios[0].total_user_products, 2);
    assert.strictEqual(
      r.anuncios[0].estoque_total, 140,
      "UP1 (3 MLBs a 100) conta 100 UMA vez, não 300; + UP2 40 = 140"
    );
    console.log("  ✓ E. UP com 3 MLBs não multiplica o estoque (140, não 340)");
  });

  // F. Vendidos segue a regra OPOSTA, e de propósito: sold_quantity não está
  //    entre os campos sincronizados por UP, então soma item a item.
  await withMockDb({
    anuncios: [
      anuncioFixture({ item_id: "MLB-a1", user_product_id: "UP1", estoque: 10, vendidos: 4 }),
      anuncioFixture({ item_id: "MLB-a2", user_product_id: "UP1", estoque: 10, vendidos: 6 }),
      anuncioFixture({ item_id: "MLB-b1", user_product_id: "UP2", estoque: 10, vendidos: 1 }),
    ],
    userProducts: [upFixture({ user_product_id: "UP1" }), upFixture({ user_product_id: "UP2" })],
  }, async () => {
    const r = await meliFamiliaService.listarAgrupado({ clienteId: 1 });
    assert.strictEqual(r.anuncios[0].estoque_total, 20, "estoque colapsa por UP: 10 + 10");
    assert.strictEqual(r.anuncios[0].vendidos_total, 11, "vendidos soma por item: 4 + 6 + 1");
    console.log("  ✓ F. estoque soma por UP, vendidos soma por item");
  });

  // G. Estoque desconhecido em todo o grupo devolve null (a tela mostra "—"),
  //    não 0: "não sei" não é "zero".
  await withMockDb({
    anuncios: [
      anuncioFixture({ item_id: "MLB-a", user_product_id: "UP1", estoque: null }),
      anuncioFixture({ item_id: "MLB-b", user_product_id: "UP2", estoque: null }),
    ],
    userProducts: [upFixture({ user_product_id: "UP1" }), upFixture({ user_product_id: "UP2" })],
  }, async () => {
    const r = await meliFamiliaService.listarAgrupado({ clienteId: 1 });
    assert.strictEqual(r.anuncios[0].estoque_total, null, "sem estoque conhecido = null, não 0");
    console.log("  ✓ G. estoque desconhecido em todo o grupo devolve null, não 0");
  });

  // ── AGREGADOS RESTANTES DA LINHA DE AGRUPADOR ──────────────────────────

  // H. Preço: faixa (min/max), porque "preço por variação" é a iniciativa.
  //    Status: consenso, ou "misto" — a família não tem status no ML.
  await withMockDb({
    anuncios: [
      anuncioFixture({ item_id: "MLB-a", user_product_id: "UP1", preco: 89.9, status: "active", score_venforce: 88 }),
      anuncioFixture({ item_id: "MLB-b", user_product_id: "UP2", preco: 129.9, status: "paused", score_venforce: 42 }),
    ],
    userProducts: [upFixture({ user_product_id: "UP1" }), upFixture({ user_product_id: "UP2" })],
  }, async () => {
    const fam = (await meliFamiliaService.listarAgrupado({ clienteId: 1 })).anuncios[0];
    assert.strictEqual(Number(fam.preco_min), 89.9);
    assert.strictEqual(Number(fam.preco_max), 129.9);
    assert.strictEqual(fam.moeda, "BRL");
    assert.strictEqual(fam.score_min, 42, "o score do agrupador é o PIOR do grupo");
    assert.deepStrictEqual(fam.status_contagem, { ativos: 1, pausados: 1, encerrados: 0 });
    console.log("  ✓ H. preço em faixa, score mínimo e contagem de status por agrupador");
  });

  // ── ORDENAÇÃO ÚNICA ────────────────────────────────────────────────────

  // I. Agrupador e anúncio individual disputam a MESMA ordem: a ordem
  //    operacional (não revisado primeiro, pior score primeiro) vale para os
  //    dois, e o grupo sobe tanto quanto o seu pior item.
  await withMockDb({
    anuncios: [
      anuncioFixture({ item_id: "MLB-BOM", user_product_id: null, score_venforce: 95, revisado: true }),
      anuncioFixture({ item_id: "MLB-RUIM", user_product_id: null, score_venforce: 20, revisado: false }),
      // a família tem um item ótimo e um péssimo: ela precisa subir pelo péssimo
      anuncioFixture({ item_id: "MLB-F-OK", user_product_id: "UP1", score_venforce: 99, revisado: false }),
      anuncioFixture({ item_id: "MLB-F-MAL", user_product_id: "UP2", score_venforce: 10, revisado: false }),
    ],
    userProducts: [upFixture({ user_product_id: "UP1" }), upFixture({ user_product_id: "UP2" })],
  }, async () => {
    const r = await meliFamiliaService.listarAgrupado({ clienteId: 1 });
    const ordem = r.anuncios.map((l) => l.key);
    assert.deepStrictEqual(ordem, ["fam:FAM1", "item:MLB-RUIM", "item:MLB-BOM"],
      "a família (pior score 10) vem antes do individual de score 20, e o revisado fica por último");
    console.log("  ✓ I. uma ordenação só: o grupo sobe pelo seu pior item");
  });

  // J. Paginação conta LINHAS (grupos), misturando os dois tipos.
  await withMockDb({
    anuncios: [
      ...Array.from({ length: 10 }, (_, i) => anuncioFixture({ item_id: `MLB-F1-${i}`, user_product_id: "UP1" })),
      anuncioFixture({ item_id: "MLB-SOLO-1", user_product_id: null }),
      anuncioFixture({ item_id: "MLB-SOLO-2", user_product_id: null }),
    ],
    userProducts: [upFixture({ user_product_id: "UP1" })],
  }, async () => {
    const r = await meliFamiliaService.listarAgrupado({ clienteId: 1, page: 1, limit: 2 });
    assert.strictEqual(r.anuncios.length, 2, "limit=2 traz 2 LINHAS, não 2 itens");
    assert.strictEqual(r.paginacao.total, 3, "1 agrupador + 2 individuais = 3 linhas");
    assert.strictEqual(r.paginacao.totalPaginas, 2);
    const p2 = await meliFamiliaService.listarAgrupado({ clienteId: 1, page: 2, limit: 2 });
    assert.strictEqual(p2.anuncios.length, 1);
    const todas = r.anuncios.concat(p2.anuncios).map((l) => l.key);
    assert.strictEqual(new Set(todas).size, 3, "nenhuma linha repete nem desaparece entre páginas");
    console.log("  ✓ J. paginação conta linhas, agrupadas e individuais juntas");
  });

  // ── BUSCA E FILTROS SOBRE A LISTA INTEIRA ──────────────────────────────

  // K. Busca por family_name, titulo, sku, user_product_id, item_id — e o
  //    grupo inteiro vem, nunca só o item que casou.
  const fixturesK = {
    anuncios: [
      anuncioFixture({ item_id: "MLB-CAMISA", user_product_id: "UP-CAMISA", titulo: "Camisa Azul", sku: "SKU-A" }),
      anuncioFixture({ item_id: "MLB-CAMISA-2", user_product_id: "UP-CAMISA-2", titulo: "Camisa Preta", sku: "SKU-A2" }),
      anuncioFixture({ item_id: "MLB-CALCA", user_product_id: "UP-CALCA", titulo: "Calça Preta", sku: "SKU-B" }),
    ],
    userProducts: [
      upFixture({ user_product_id: "UP-CAMISA", family_id: "FAM-CAMISA", family_name: "Familia Camisas" }),
      upFixture({ user_product_id: "UP-CAMISA-2", family_id: "FAM-CAMISA", family_name: "Familia Camisas" }),
      upFixture({ user_product_id: "UP-CALCA", family_id: "FAM-CALCA", family_name: "Familia Calcas" }),
    ],
  };
  const casosK = [
    ["Familia Camisas", "fam:FAM-CAMISA"],
    ["Azul", "fam:FAM-CAMISA"],
    ["SKU-B", "fam:FAM-CALCA"],
    ["UP-CALCA", "fam:FAM-CALCA"],
    ["MLB-CAMISA", "fam:FAM-CAMISA"],
  ];
  for (const [termo, esperado] of casosK) {
    await withMockDb(fixturesK, async () => {
      const r = await meliFamiliaService.listarAgrupado({ clienteId: 1, q: termo });
      assert.strictEqual(r.anuncios.length, 1, `q="${termo}" deveria achar exatamente 1 linha`);
      assert.strictEqual(r.anuncios[0].key, esperado, `q="${termo}" deveria achar ${esperado}`);
    });
  }
  // "Azul" casa só MLB-CAMISA, mas a linha traz a família inteira (2 itens).
  await withMockDb(fixturesK, async () => {
    const r = await meliFamiliaService.listarAgrupado({ clienteId: 1, q: "Azul" });
    assert.strictEqual(r.anuncios[0].total_itens, 2,
      "busca casa por item, mas a linha é do GRUPO inteiro");
  });
  console.log("  ✓ K. busca por family_name/titulo/sku/user_product_id/item_id traz o grupo inteiro");

  // L. Os cards de KPI valem para a lista inteira — e um deles casando dentro
  //    de uma família traz a família.
  await withMockDb({
    anuncios: [
      anuncioFixture({ item_id: "MLB-F-OK", user_product_id: "UP1", pictures_count: 8, estoque: 10 }),
      anuncioFixture({ item_id: "MLB-F-POBRE", user_product_id: "UP2", pictures_count: 1, estoque: 10 }),
      anuncioFixture({ item_id: "MLB-SOLO-OK", user_product_id: null, pictures_count: 6 }),
      anuncioFixture({ item_id: "MLB-SOLO-POBRE", user_product_id: null, pictures_count: 0 }),
    ],
    userProducts: [upFixture({ user_product_id: "UP1" }), upFixture({ user_product_id: "UP2" })],
  }, async () => {
    const r = await meliFamiliaService.listarAgrupado({ clienteId: 1, filtro: "sem_fotos" });
    const chaves = r.anuncios.map((l) => l.key).sort();
    assert.deepStrictEqual(chaves, ["fam:FAM1", "item:MLB-SOLO-POBRE"],
      "o filtro alcança os dois tipos de linha");
    // E o agregado NÃO encolhe para o subconjunto que casou.
    const fam = r.anuncios.find((l) => l.key === "fam:FAM1");
    assert.strictEqual(fam.total_itens, 2, "o agrupador continua contando os 2 itens");
    assert.strictEqual(fam.estoque_total, 20, "estoque de um produto é do produto, não do filtro");
    console.log("  ✓ L. filtro de KPI alcança as duas formas de linha e não encolhe agregados");
  });

  // M. Filtro por status idem, e no mesmo parâmetro de sempre.
  await withMockDb({
    anuncios: [
      anuncioFixture({ item_id: "MLB-F-ATIVO", user_product_id: "UP1", status: "active" }),
      anuncioFixture({ item_id: "MLB-SOLO-PAUSADO", user_product_id: null, status: "paused" }),
      anuncioFixture({ item_id: "MLB-SOLO-ATIVO", user_product_id: null, status: "active" }),
    ],
    userProducts: [upFixture({ user_product_id: "UP1" })],
  }, async () => {
    const r = await meliFamiliaService.listarAgrupado({ clienteId: 1, status: "paused" });
    assert.deepStrictEqual(r.anuncios.map((l) => l.key), ["item:MLB-SOLO-PAUSADO"]);
    console.log("  ✓ M. status recorta a lista unificada");
  });

  // N. O recorte "sem_agrupamento" continua existindo como diagnóstico, agora
  //    como um filtro qualquer — e cobre os três caminhos num predicado só.
  await withMockDb({
    anuncios: [
      anuncioFixture({ item_id: "MLB-FAM", user_product_id: "UP1" }),
      anuncioFixture({ item_id: "MLB-SOLO", user_product_id: null }),
      anuncioFixture({ item_id: "MLB-SEM-FAM", user_product_id: "UP-SF" }),
      anuncioFixture({ item_id: "MLB-ORFAO", user_product_id: "UP-FANTASMA" }),
    ],
    userProducts: [
      upFixture({ user_product_id: "UP1" }),
      upFixture({ user_product_id: "UP-SF", family_id: null }),
    ],
  }, async () => {
    const r = await meliFamiliaService.listarAgrupado({ clienteId: 1, filtro: "sem_agrupamento" });
    const chaves = r.anuncios.map((l) => l.key).sort();
    assert.deepStrictEqual(chaves, ["item:MLB-ORFAO", "item:MLB-SEM-FAM", "item:MLB-SOLO"]);
    console.log("  ✓ N. filtro sem_agrupamento cobre os 3 caminhos e não é mais uma aba");
  });

  // ── ACCOUNT-SCOPE (invariantes preservadas) ────────────────────────────

  // O. Família exclusiva da Conta B não aparece na listagem da Conta A.
  await withMockDb({
    anuncios: [
      anuncioFixture({ item_id: "MLB-A", user_product_id: "UP-A", cliente_conta_id: 10 }),
      anuncioFixture({ item_id: "MLB-B", user_product_id: "UP-B", cliente_conta_id: 20 }),
    ],
    userProducts: [
      upFixture({ user_product_id: "UP-A", family_id: "FAM-A" }),
      upFixture({ user_product_id: "UP-B", family_id: "FAM-B" }),
    ],
  }, async () => {
    const r = await meliFamiliaService.listarAgrupado({ clienteId: 1, clienteContaId: 10, includeLegacy: false });
    const chaves = r.anuncios.map((l) => l.key);
    assert.ok(chaves.includes("fam:FAM-A"), "FAM-A (da própria conta) deve aparecer");
    assert.ok(!chaves.includes("fam:FAM-B"), "FAM-B (exclusiva da Conta B) não pode aparecer para a Conta A");
    console.log("  ✓ O. família exclusiva da Conta B fica fora da listagem da Conta A");
  });

  // P. O LEFT JOIN não alarga o escopo: anúncio individual de outra conta
  //    também fica fora. (A regressão possível era justamente esta.)
  await withMockDb({
    anuncios: [
      anuncioFixture({ item_id: "MLB-SOLO-A", user_product_id: null, cliente_conta_id: 10 }),
      anuncioFixture({ item_id: "MLB-SOLO-B", user_product_id: null, cliente_conta_id: 20 }),
    ],
  }, async () => {
    const r = await meliFamiliaService.listarAgrupado({ clienteId: 1, clienteContaId: 10, includeLegacy: false });
    assert.deepStrictEqual(r.anuncios.map((l) => l.key), ["item:MLB-SOLO-A"]);
    console.log("  ✓ P. o LEFT JOIN não vaza anúncio individual de outra conta");
  });

  // Q. Estoque de outra conta não entra na soma do agrupador.
  await withMockDb({
    anuncios: [
      anuncioFixture({ item_id: "MLB-A", user_product_id: "UP1", cliente_conta_id: 10, estoque: 10 }),
      anuncioFixture({ item_id: "MLB-B", user_product_id: "UP2", cliente_conta_id: 20, estoque: 999 }),
    ],
    userProducts: [upFixture({ user_product_id: "UP1" }), upFixture({ user_product_id: "UP2" })],
  }, async () => {
    const r = await meliFamiliaService.listarAgrupado({ clienteId: 1, clienteContaId: 10, includeLegacy: false });
    assert.strictEqual(r.anuncios[0].estoque_total, 10, "o UP da Conta B não pode somar no estoque da Conta A");
    assert.strictEqual(r.anuncios[0].total_user_products, 1);
    console.log("  ✓ Q. a soma de estoque respeita o account-scope");
  });

  // R. Detalhe cross-account: Conta A pede familyId exclusivo da B -> 404.
  await withMockDb({
    anuncios: [anuncioFixture({ item_id: "MLB-B", user_product_id: "UP-B", cliente_conta_id: 20 })],
    userProducts: [upFixture({ user_product_id: "UP-B", family_id: "FAM-B" })],
    contas: [contaA, contaB],
    grants: [grantFixture({ id: 100, cliente_id: 1, ml_user_id: "111" }), grantFixture({ id: 101, cliente_id: 1, ml_user_id: "222" })],
  }, async () => {
    const direto = await meliFamiliaService.obterFamiliaDetalhe({ clienteId: 1, familyId: "FAM-B", clienteContaId: 10, includeLegacy: false });
    assert.strictEqual(direto, null, "família exclusiva da Conta B deve resolver como inexistente para a Conta A");

    const req = { params: { familyId: "FAM-B" }, query: { clienteSlug: "cliente-a", clienteContaId: "10" } };
    const res = fakeRes();
    await ctrl.detalheFamilia(req, res);
    assert.strictEqual(res.statusCode, 404, "o endpoint HTTP deve responder 404, não vazar a família da outra conta");
    console.log("  ✓ R. detalhe cross-account responde 404 (service e HTTP)");
  });

  // S. Família compartilhada entre contas: Conta A só recebe os MLBs do escopo A.
  await withMockDb({
    anuncios: [
      anuncioFixture({ item_id: "MLB-A", user_product_id: "UP-S", cliente_conta_id: 10, listing_type_id: "gold_pro" }),
      anuncioFixture({ item_id: "MLB-B", user_product_id: "UP-S", cliente_conta_id: 20 }),
    ],
    userProducts: [upFixture({ user_product_id: "UP-S", family_id: "FAM-S" })],
  }, async () => {
    const familia = await meliFamiliaService.obterFamiliaDetalhe({ clienteId: 1, familyId: "FAM-S", clienteContaId: 10, includeLegacy: false });
    assert.ok(familia, "família compartilhada deve existir para a Conta A (ela também tem itens)");
    const todosItens = familia.user_products.flatMap((up) => up.itens);
    assert.strictEqual(todosItens.length, 1, "só o item da Conta A pode aparecer");
    assert.strictEqual(todosItens[0].item_id, "MLB-A");
    // A expansão mostra os MLBs direto abaixo do agrupador, sem o nível do
    // MLBU: a condição comercial é o que diferencia dois anúncios da mesma
    // variação, então listing_type_id tem de chegar ao front.
    assert.strictEqual(todosItens[0].listing_type_id, "gold_pro",
      "o detalhe da família precisa trazer a condição comercial do anúncio");
    console.log("  ✓ S. família compartilhada: Conta A só vê os MLBs do seu escopo (com condição comercial)");
  });

  // S2. O card do MLB dentro da família precisa dos mesmos campos de badge
  //     que o card legado (Catálogo/Full/fotos/Revisado) — ver auditoria
  //     "padronizar card MLB dentro de agrupadores". Sem eles no detalhe da
  //     família, o front nunca consegue montar os badges, mesmo tendo a
  //     lógica pronta (são as mesmas colunas que já existem em meli_anuncios
  //     e a listagem plana já lê para o card avulso).
  await withMockDb({
    anuncios: [
      anuncioFixture({
        item_id: "MLB-BADGE", user_product_id: "UP-BADGE",
        pictures_count: 1, is_full: true, revisado: true, catalog_listing: true,
      }),
    ],
    userProducts: [upFixture({ user_product_id: "UP-BADGE", family_id: "FAM-BADGE" })],
  }, async () => {
    const familia = await meliFamiliaService.obterFamiliaDetalhe({ clienteId: 1, familyId: "FAM-BADGE", clienteContaId: 10, includeLegacy: false });
    const item = familia.user_products.flatMap((up) => up.itens)[0];
    assert.strictEqual(item.pictures_count, 1, "pictures_count precisa chegar ao front para o badge de fotos");
    assert.strictEqual(item.is_full, true, "is_full precisa chegar ao front para o badge Full");
    assert.strictEqual(item.revisado, true, "revisado precisa chegar ao front para o badge Revisado");
    assert.strictEqual(item.catalog_listing, true, "catalog_listing precisa chegar ao front para o badge Catálogo");
    console.log("  ✓ S2. detalhe da família traz pictures_count/is_full/revisado/catalog_listing (mesmos badges do card legado)");
  });

  // T. includeLegacy=true inclui linhas com cliente_conta_id NULL.
  await withMockDb({
    anuncios: [anuncioFixture({ item_id: "MLB-LEG", user_product_id: "UP-LEG", cliente_conta_id: null })],
    userProducts: [upFixture({ user_product_id: "UP-LEG", family_id: "FAM-LEG" })],
  }, async () => {
    const r = await meliFamiliaService.listarAgrupado({ clienteId: 1, clienteContaId: 10, includeLegacy: true });
    assert.ok(r.anuncios.some((l) => l.key === "fam:FAM-LEG"), "includeLegacy=true deve incluir item com conta NULL");
    console.log("  ✓ T. includeLegacy=true inclui linhas legadas (cliente_conta_id NULL)");
  });

  // U. includeLegacy=false não inclui linhas NULL.
  await withMockDb({
    anuncios: [anuncioFixture({ item_id: "MLB-LEG", user_product_id: "UP-LEG", cliente_conta_id: null })],
    userProducts: [upFixture({ user_product_id: "UP-LEG", family_id: "FAM-LEG" })],
  }, async () => {
    const r = await meliFamiliaService.listarAgrupado({ clienteId: 1, clienteContaId: 10, includeLegacy: false });
    assert.ok(!r.anuncios.some((l) => l.key === "fam:FAM-LEG"), "includeLegacy=false não pode incluir item com conta NULL");
    console.log("  ✓ U. includeLegacy=false exclui linhas legadas (cliente_conta_id NULL)");
  });

  // ── CONTRATO HTTP E ROTEAMENTO ─────────────────────────────────────────

  // V. O endpoint devolve UMA lista (`anuncios`) e nenhum bloco separado.
  await withMockDb({
    anuncios: [
      anuncioFixture({ item_id: "MLB-FAM", user_product_id: "UP1" }),
      anuncioFixture({ item_id: "MLB-SOLO", user_product_id: null }),
    ],
    userProducts: [upFixture({ user_product_id: "UP1" })],
    contas: [contaA],
    grants: [grantFixture({ id: 1, cliente_id: 1, ml_user_id: "111" })],
  }, async () => {
    const res = fakeRes();
    await ctrl.listarAgrupado({ query: { clienteSlug: "cliente-a", clienteContaId: "10" } }, res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.corpo.ok, true);
    assert.ok(Array.isArray(res.corpo.anuncios), "a resposta expõe `anuncios`");
    assert.strictEqual(res.corpo.anuncios.length, 2);
    assert.ok(!("familias" in res.corpo), "não pode existir um bloco `familias` separado");
    assert.ok(!("sem_user_product" in res.corpo), "não pode existir um bloco `sem_user_product`");
    assert.strictEqual(res.corpo.paginacao.total, 2, "uma paginação só, de linhas");
    console.log("  ✓ V. GET /familias responde uma lista só, sem blocos separados");
  });

  // W. Ordem de rota: GET /familias nunca cai em detalhe(itemId="familias").
  {
    const router = require("../routes/meliAnunciosRoutes");
    const rotasGet = router.stack
      .filter((camada) => camada.route && camada.route.methods && camada.route.methods.get)
      .map((camada) => camada.route.path);
    const idxFamilias = rotasGet.indexOf("/familias");
    const idxFamiliaDetalhe = rotasGet.indexOf("/familias/:familyId");
    const idxItemId = rotasGet.indexOf("/:itemId");
    assert.ok(idxFamilias !== -1, "GET /familias precisa estar registrada");
    assert.ok(idxFamiliaDetalhe !== -1, "GET /familias/:familyId precisa estar registrada");
    assert.ok(idxItemId !== -1, "GET /:itemId (rota existente) precisa continuar registrada");
    assert.ok(idxFamilias < idxItemId, "GET /familias precisa vir ANTES de GET /:itemId");
    assert.ok(idxFamiliaDetalhe < idxItemId, "GET /familias/:familyId precisa vir ANTES de GET /:itemId");
    console.log("  ✓ W. /familias e /familias/:familyId registradas antes de /:itemId");
  }

  // X. A listagem unificada não chama a API do Mercado Livre.
  await withMockDb({
    anuncios: [
      anuncioFixture({ item_id: "MLB1", user_product_id: "UP1" }),
      anuncioFixture({ item_id: "MLB-SOLO", user_product_id: null }),
    ],
    userProducts: [upFixture({ user_product_id: "UP1" })],
  }, async () => {
    const Module = require("module");
    const originalLoad = Module._load;
    Module._load = function loadThatThrows(request, parent, isMain) {
      if (request === "../../utils/mlClient" || request === "../utils/mlClient") {
        throw new Error("mlFetch não pode ser chamado pela listagem unificada");
      }
      return originalLoad.call(this, request, parent, isMain);
    };
    try {
      await meliFamiliaService.listarAgrupado({ clienteId: 1 });
      await meliFamiliaService.obterFamiliaDetalhe({ clienteId: 1, familyId: "FAM1" });
    } finally {
      Module._load = originalLoad;
    }
    console.log("  ✓ X. a listagem unificada não chama a API do Mercado Livre");
  });

  // ── Capa do agrupador (cover) ──────────────────────────────────────────
  //
  // Calculada em LEITURA a partir de meli_user_products -> meli_anuncios.
  // Nada é persistido: nenhuma coluna nova, nenhum thumbnail gravado.
  // Sem busca, a capa é o anúncio que melhor representa a família (o mais
  // vendido, com imagem). Com busca, é a variação que casa com o termo.

  const upsFam1 = [upFixture({ user_product_id: "UP1" }), upFixture({ user_product_id: "UP2" })];

  // Y. Sem busca: manda o mais vendido, não a ordem de item_id.
  await withMockDb({
    anuncios: [
      anuncioFixture({ item_id: "MLB-a", user_product_id: "UP1", vendidos: 3, thumbnail: "http://thumb/a" }),
      anuncioFixture({ item_id: "MLB-b", user_product_id: "UP2", vendidos: 41, thumbnail: "http://thumb/b" }),
      anuncioFixture({ item_id: "MLB-c", user_product_id: "UP2", vendidos: 7, thumbnail: "http://thumb/c" }),
    ],
    userProducts: upsFam1,
  }, async () => {
    const r = await meliFamiliaService.listarAgrupado({ clienteId: 1 });
    assert.deepStrictEqual(r.anuncios[0].cover, { thumbnail: "http://thumb/b", user_product_id: "UP2" });
    console.log("  ✓ Y. capa sem busca = anúncio mais vendido da família");
  });

  // Z. Anúncio sem imagem não vira capa, mesmo sendo disparado o mais vendido.
  await withMockDb({
    anuncios: [
      anuncioFixture({ item_id: "MLB-a", user_product_id: "UP1", vendidos: 99, thumbnail: null }),
      anuncioFixture({ item_id: "MLB-b", user_product_id: "UP2", vendidos: 5, thumbnail: "http://thumb/b" }),
    ],
    userProducts: upsFam1,
  }, async () => {
    const r = await meliFamiliaService.listarAgrupado({ clienteId: 1 });
    assert.deepStrictEqual(r.anuncios[0].cover, { thumbnail: "http://thumb/b", user_product_id: "UP2" });
    console.log("  ✓ Z. anúncio sem imagem não vira capa");
  });

  // AA. Empate em vendidos: o ativo representa melhor que o pausado.
  await withMockDb({
    anuncios: [
      anuncioFixture({ item_id: "MLB-a", user_product_id: "UP1", vendidos: 4, status: "paused", thumbnail: "http://thumb/a" }),
      anuncioFixture({ item_id: "MLB-b", user_product_id: "UP2", vendidos: 4, status: "active", thumbnail: "http://thumb/b" }),
    ],
    userProducts: upsFam1,
  }, async () => {
    const r = await meliFamiliaService.listarAgrupado({ clienteId: 1 });
    assert.deepStrictEqual(r.anuncios[0].cover, { thumbnail: "http://thumb/b", user_product_id: "UP2" });
    console.log("  ✓ AA. empate em vendidos: ativo ganha de pausado");
  });

  // AB. Com busca: a capa é a variação relevante para o termo, não a campeã
  //     de vendas da família.
  await withMockDb({
    anuncios: [
      anuncioFixture({ item_id: "MLB-a", user_product_id: "UP1", titulo: "Camiseta Preta P", vendidos: 50, thumbnail: "http://thumb/a" }),
      anuncioFixture({ item_id: "MLB-b", user_product_id: "UP2", titulo: "Camiseta Azul G", vendidos: 2, thumbnail: "http://thumb/b" }),
    ],
    userProducts: upsFam1,
  }, async () => {
    const r = await meliFamiliaService.listarAgrupado({ clienteId: 1, q: "Azul" });
    assert.deepStrictEqual(r.anuncios[0].cover, { thumbnail: "http://thumb/b", user_product_id: "UP2" });
    console.log("  ✓ AB. com busca, a capa é a variação que casa com o termo");
  });

  // AC. Busca que casa só pelo nome da família: nenhum item é "mais
  //     relevante", então vale a régua padrão (mais vendido).
  await withMockDb({
    anuncios: [
      anuncioFixture({ item_id: "MLB-a", user_product_id: "UP1", titulo: "Camiseta Preta P", vendidos: 50, thumbnail: "http://thumb/a" }),
      anuncioFixture({ item_id: "MLB-b", user_product_id: "UP2", titulo: "Camiseta Azul G", vendidos: 2, thumbnail: "http://thumb/b" }),
    ],
    userProducts: upsFam1,
  }, async () => {
    const r = await meliFamiliaService.listarAgrupado({ clienteId: 1, q: "Familia" });
    assert.deepStrictEqual(r.anuncios[0].cover, { thumbnail: "http://thumb/a", user_product_id: "UP1" });
    console.log("  ✓ AC. busca que casa só pela família cai na régua padrão");
  });

  // AD. Família sem nenhuma imagem: contrato estável — `cover` continua
  //     objeto, com thumbnail null. O front decide o placeholder.
  await withMockDb({
    anuncios: [
      anuncioFixture({ item_id: "MLB-a", user_product_id: "UP1", vendidos: 1, thumbnail: null }),
      anuncioFixture({ item_id: "MLB-b", user_product_id: "UP1", vendidos: 9, thumbnail: null }),
    ],
    userProducts: [upFixture({ user_product_id: "UP1" })],
  }, async () => {
    const r = await meliFamiliaService.listarAgrupado({ clienteId: 1 });
    assert.deepStrictEqual(r.anuncios[0].cover, { thumbnail: null, user_product_id: "UP1" });
    console.log("  ✓ AD. família sem imagem: cover.thumbnail null, user_product_id preenchido");
  });

  // AE. A capa respeita o account-scope: o campeão de vendas da Conta B não
  //     pode virar a capa que a Conta A enxerga.
  await withMockDb({
    contas: [contaA, contaB],
    grants: [grantFixture({ id: 1, cliente_id: 1, ml_user_id: "111" })],
    anuncios: [
      anuncioFixture({ item_id: "MLB-a", user_product_id: "UP1", cliente_conta_id: 10, vendidos: 1, thumbnail: "http://thumb/a" }),
      anuncioFixture({ item_id: "MLB-b", user_product_id: "UP1", cliente_conta_id: 20, vendidos: 99, thumbnail: "http://thumb/b" }),
    ],
    userProducts: [upFixture({ user_product_id: "UP1" })],
  }, async () => {
    const r = await meliFamiliaService.listarAgrupado({ clienteId: 1, clienteContaId: 10, includeLegacy: false });
    assert.deepStrictEqual(r.anuncios[0].cover, { thumbnail: "http://thumb/a", user_product_id: "UP1" });
    console.log("  ✓ AE. a capa nunca vem de anúncio de outra conta");
  });

  // AF. Capa e campos de item são buscados só para as linhas da PÁGINA — o
  //     custo não cresce com o tamanho do catálogo.
  await withMockDb({
    anuncios: [
      // 3 famílias (nomes crescentes) + 2 individuais, tudo com score
      // controlado para a ordem ser previsível.
      anuncioFixture({ item_id: "MLB-1", user_product_id: "UP1", score_venforce: 10 }),
      anuncioFixture({ item_id: "MLB-2", user_product_id: "UP2", score_venforce: 20 }),
      anuncioFixture({ item_id: "MLB-3", user_product_id: "UP3", score_venforce: 30 }),
      anuncioFixture({ item_id: "MLB-SOLO-1", user_product_id: null, score_venforce: 40 }),
      anuncioFixture({ item_id: "MLB-SOLO-2", user_product_id: null, score_venforce: 50 }),
    ],
    userProducts: [
      upFixture({ user_product_id: "UP1", family_id: "FAM1", family_name: "A familia" }),
      upFixture({ user_product_id: "UP2", family_id: "FAM2", family_name: "B familia" }),
      upFixture({ user_product_id: "UP3", family_id: "FAM3", family_name: "C familia" }),
    ],
  }, async (db) => {
    const r = await meliFamiliaService.listarAgrupado({ clienteId: 1, page: 1, limit: 2 });
    assert.deepStrictEqual(r.anuncios.map((l) => l.key), ["fam:FAM1", "fam:FAM2"]);
    assert.deepStrictEqual(db.capaFamilyIds, ["FAM1", "FAM2"], "a capa varreu famílias fora da página");
    assert.strictEqual(db.itensPedidos, undefined,
      "página sem linha individual não deve nem disparar a consulta de itens");

    const p3 = await meliFamiliaService.listarAgrupado({ clienteId: 1, page: 3, limit: 2 });
    assert.deepStrictEqual(p3.anuncios.map((l) => l.key), ["item:MLB-SOLO-2"]);
    assert.deepStrictEqual(db.itensPedidos, ["MLB-SOLO-2"], "a consulta de itens varreu fora da página");
    console.log("  ✓ AF. capa e campos de item são buscados só para as linhas da página");
  });

  // ── resolverItensDeFamilias — resolução bulk p/ ordenação por família ─────
  // (auditoria "Anúncios ML — filtros de performance": o front manda só
  // `familias=FAM1|FAM2`, o backend resolve os MLBs filhos.)

  // AG. Resolve os itens de VÁRIAS famílias em uma consulta só, agrupados por
  //     family_id — nunca mistura os filhos de duas famílias.
  await withMockDb({
    anuncios: [
      anuncioFixture({ item_id: "MLB-A1", user_product_id: "UP1" }),
      anuncioFixture({ item_id: "MLB-A2", user_product_id: "UP1" }),
      anuncioFixture({ item_id: "MLB-B1", user_product_id: "UP2" }),
      anuncioFixture({ item_id: "MLB-FORA", user_product_id: "UP3" }), // família não pedida
    ],
    userProducts: [
      upFixture({ user_product_id: "UP1", family_id: "FAM1" }),
      upFixture({ user_product_id: "UP2", family_id: "FAM2" }),
      upFixture({ user_product_id: "UP3", family_id: "FAM3" }),
    ],
  }, async () => {
    const r = await meliFamiliaService.resolverItensDeFamilias({ clienteId: 1, familyIds: ["FAM1", "FAM2"] });
    assert.deepStrictEqual(r.get("FAM1").sort(), ["MLB-A1", "MLB-A2"]);
    assert.deepStrictEqual(r.get("FAM2").sort(), ["MLB-B1"]);
    assert.strictEqual(r.get("FAM3"), undefined, "família não pedida não pode aparecer no resultado");
    console.log("  ✓ AG. resolverItensDeFamilias: resolve várias famílias em 1 consulta, sem misturar filhos");
  });

  // AH. clienteContaId isola a resolução — MLB de outra conta não pode
  //     aparecer como filho da família nesta conta.
  await withMockDb({
    anuncios: [
      anuncioFixture({ item_id: "MLB-CONTA10", user_product_id: "UP1", cliente_conta_id: 10 }),
      anuncioFixture({ item_id: "MLB-CONTA11", user_product_id: "UP1", cliente_conta_id: 11 }),
    ],
    userProducts: [upFixture({ user_product_id: "UP1", family_id: "FAM1" })],
  }, async () => {
    const r = await meliFamiliaService.resolverItensDeFamilias({
      clienteId: 1, clienteContaId: 10, includeLegacy: false, familyIds: ["FAM1"],
    });
    assert.deepStrictEqual(r.get("FAM1"), ["MLB-CONTA10"], "não pode vazar item de outra conta");
    console.log("  ✓ AH. resolverItensDeFamilias isola por clienteContaId — nunca mistura contas");
  });

  // AI. familyIds vazio: zero consulta, Map vazio (mesma postura de itemIds
  //     vazio no resto do módulo).
  await withMockDb({ anuncios: [], userProducts: [] }, async () => {
    const r = await meliFamiliaService.resolverItensDeFamilias({ clienteId: 1, familyIds: [] });
    assert.strictEqual(r.size, 0);
    console.log("  ✓ AI. resolverItensDeFamilias com familyIds vazio: Map vazio, sem consulta");
  });

  // AJ. listarChavesFiltradas devolve TODO o catálogo filtrado, sem
  //     LIMIT/OFFSET — é a base do ranking global (ver Task 5).
  await withMockDb({
    anuncios: [
      anuncioFixture({ item_id: "MLB1", user_product_id: null }),
      anuncioFixture({ item_id: "MLB2", user_product_id: "UP1" }),
      anuncioFixture({ item_id: "MLB3", user_product_id: "UP1" }),
      anuncioFixture({ item_id: "MLB4", user_product_id: null, status: "paused" }),
    ],
    userProducts: [upFixture({ user_product_id: "UP1", family_id: "FAM1" })],
  }, async () => {
    const chaves = await meliFamiliaService.listarChavesFiltradas({ clienteId: 1 });
    const porChave = new Map(chaves.map((c) => [c.grupo_key, c]));
    assert.strictEqual(chaves.length, 3, "MLB2+MLB3 colapsam em 1 grupo (FAM1); MLB1 e MLB4 ficam avulsos");
    assert.strictEqual(porChave.get("fam:FAM1").item_id, "MLB2");
    assert.strictEqual(porChave.get("item:MLB1").family_id, null);
    console.log("  ✓ AJ. listarChavesFiltradas: catálogo inteiro, sem paginação, família colapsada");
  });

  // AK. listarChavesFiltradas respeita status/q — mesmo predicado de
  //     listarAgrupado (casaSelecionado), nunca lista item fora do filtro.
  await withMockDb({
    anuncios: [
      anuncioFixture({ item_id: "MLB1", status: "active" }),
      anuncioFixture({ item_id: "MLB2", status: "paused" }),
    ],
    userProducts: [],
  }, async () => {
    const chaves = await meliFamiliaService.listarChavesFiltradas({ clienteId: 1, status: "paused" });
    assert.deepStrictEqual(chaves.map((c) => c.item_id), ["MLB2"]);
    console.log("  ✓ AK. listarChavesFiltradas: filtro de status restringe o catálogo inteiro");
  });

  // AL. clienteContaId isola o catálogo — mesma garantia de sempre.
  await withMockDb({
    anuncios: [
      anuncioFixture({ item_id: "MLB-C10", cliente_conta_id: 10 }),
      anuncioFixture({ item_id: "MLB-C11", cliente_conta_id: 11 }),
    ],
    userProducts: [],
  }, async () => {
    const chaves = await meliFamiliaService.listarChavesFiltradas({
      clienteId: 1, clienteContaId: 10, includeLegacy: false,
    });
    assert.deepStrictEqual(chaves.map((c) => c.item_id), ["MLB-C10"]);
    console.log("  ✓ AL. listarChavesFiltradas isola por clienteContaId");
  });

  console.log("meliAnunciosFamilias.test.js passed");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
