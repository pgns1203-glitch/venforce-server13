// server/tests/meliAnunciosImagensVariacoes.test.js
//
// Adicionar imagem a um anúncio ML COM VARIAÇÕES (modelo legado):
//   GET  /anuncios-meli/:itemId/imagens/variacoes          (grupos de foto)
//   POST /anuncios-meli/:itemId/imagens?grupoVariacao=<k>  (envio)
//
// O que este teste protege (ver meliImagensService, bloco VARIAÇÕES):
//
//  1. a imagem vai para o GRUPO do atributo defines_picture (ex.: Cor Azul =
//     todas as variações Azul) e para nenhuma outra variação;
//  2. o PUT reenvia TODAS as fotos (ids) e TODAS as variações (id +
//     picture_ids) — omitir qualquer uma apagaria no ML;
//  3. o PUT é montado de um GET feito depois do upload, não da leitura inicial;
//  4. o erro do ML chega como veio; falha depois do upload não reenvia nada;
//  5. confirmação: variação ou foto sumida é falha CRÍTICA, nunca sucesso;
//  6. o snapshot é o mesmo que o sync gravaria para esse item.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const Module = require("module");
const sharp = require("sharp");

// ── stub do cliente ML ──────────────────────────────────────────────────────
let mlChamadas = [];
let mlHandler = null;

const originalLoad = Module._load;
Module._load = function loadWithMlFetchStub(request, parent, isMain) {
  if (request === "../../utils/mlClient" || request === "../utils/mlClient") {
    return {
      async mlFetch(clienteId, path, options = {}) {
        const multipart = options.body instanceof FormData;
        const chamada = {
          clienteId,
          path,
          metodo: options.method || "GET",
          mlUserId: options.mlUserId,
          form: multipart ? options.body : null,
          body: options.body && !multipart ? JSON.parse(options.body) : null,
        };
        mlChamadas.push(chamada);
        return mlHandler ? mlHandler(chamada) : { ok: true, status: 200, data: {} };
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const pool = require("../config/database");
const ctrl = require("../controllers/meliAnunciosController");
const { mapearItem } = require("../services/meliAnuncios/meliSyncService");
const imagens = require("../services/meliAnuncios/meliImagensService");

Module._load = originalLoad;

// ── fixtures ────────────────────────────────────────────────────────────────

const cliente = { id: 1, nome: "Cliente A", slug: "cliente-a", ativo: true };
const url = (id) => `https://http2.mlstatic.com/D_NQ_NP_${id}-F.jpg`;

// Camiseta: Azul P, Azul M, Preto P. COLOR define a foto; SIZE não.
function variacao(id, corId, cor, tam, pictureIds) {
  return {
    id,
    attribute_combinations: [
      { id: "COLOR", name: "Cor", value_id: corId, value_name: cor },
      { id: "SIZE", name: "Tamanho", value_id: null, value_name: tam },
    ],
    price: 50, available_quantity: 3, sold_quantity: 0,
    picture_ids: pictureIds,
  };
}

function itemMl() {
  return {
    id: "MLB555", catalog_listing: false, category_id: "MLB31447", user_product_id: null,
    pictures: [
      { id: "AZ1", secure_url: url("AZ1") },
      { id: "AZ2", secure_url: url("AZ2") },
      { id: "PR1", secure_url: url("PR1") },
    ],
    variations: [
      variacao(101, "52049", "Azul", "P", ["AZ1", "AZ2"]),
      variacao(102, "52049", "Azul", "M", ["AZ1", "AZ2"]),
      variacao(103, "52028", "Preto", "P", ["PR1"]),
    ],
    secure_thumbnail: "https://http2.mlstatic.com/D_AZ1-I.jpg",
  };
}

const ATRIBUTOS_CATEGORIA = [
  { id: "COLOR", name: "Cor", tags: { allow_variations: true, defines_picture: true } },
  { id: "SIZE", name: "Tamanho", tags: { allow_variations: true } },
  { id: "BRAND", name: "Marca", tags: { required: true } },
];

function anuncioFixture(over = {}) {
  return {
    id: 9, cliente_id: 1, cliente_slug: "cliente-a", item_id: "MLB555",
    titulo: "Camiseta", catalog_listing: false, family_name: null, variations_count: 3,
    pictures_json: [url("AZ1"), url("AZ2"), url("PR1")], pictures_count: 3,
    thumbnail: "https://http2.mlstatic.com/D_AZ1-I.jpg",
    cliente_conta_id: 10, ml_user_id: "111",
    ...over,
  };
}

// ML simulado com ESTADO: o PUT aplica de verdade pictures/variations, e os
// GETs seguintes enxergam o resultado — como o ML real.
function mlSimulado(opts = {}) {
  const estado = { item: opts.item || itemMl(), puts: 0, uploads: 0 };
  const handler = (c) => {
    if (c.metodo === "GET" && c.path.startsWith("/items/MLB555")) {
      return { ok: true, status: 200, data: JSON.parse(JSON.stringify(estado.item)) };
    }
    if (c.metodo === "GET" && c.path === `/categories/${estado.item.category_id}/attributes`) {
      return { ok: true, status: 200, data: opts.atributos || ATRIBUTOS_CATEGORIA };
    }
    if (c.path === "/pictures/items/upload") {
      estado.uploads += 1;
      return { ok: true, status: 201, data: { id: "NOVA", variations: [] } };
    }
    if (c.metodo === "PUT" && c.path === "/items/MLB555") {
      estado.puts += 1;
      const porId = Object.fromEntries(estado.item.pictures.map((p) => [p.id, p]));
      estado.item.pictures = c.body.pictures.map((p) => porId[p.id] || { id: p.id, secure_url: url(p.id) });
      const vPorId = Object.fromEntries(estado.item.variations.map((v) => [String(v.id), v]));
      // O ML real: variação omitida é removida.
      estado.item.variations = c.body.variations.map((v) => ({ ...vPorId[String(v.id)], picture_ids: v.picture_ids }));
      return { ok: true, status: 200, data: estado.item };
    }
    if (c.metodo === "POST" && c.path === "/items/MLB555/pictures") {
      throw new Error("o fluxo de variação não pode usar POST /items/{id}/pictures");
    }
    return { ok: false, status: 404, data: { message: "rota inesperada no teste: " + c.metodo + " " + c.path } };
  };
  return { estado, handler };
}

class MockDb {
  constructor({ anuncios = [] } = {}) { this.anuncios = anuncios; this.updates = 0; }
  async connect() { return { query: (sql, params) => this.query(sql, params), release() {} }; }
  async query(sql, params = []) {
    const q = String(sql).replace(/\s+/g, " ").trim();
    if (q.includes("FROM clientes WHERE LOWER(slug) = $1")) {
      return { rows: cliente.slug === params[0] ? [cliente] : [] };
    }
    if (q.includes("FROM clientes WHERE id = $1")) {
      return { rows: cliente.id === Number(params[0]) ? [cliente] : [] };
    }
    if (q.startsWith("SELECT * FROM meli_anuncios WHERE cliente_id = $1 AND item_id = $2")) {
      const row = this.anuncios.find((a) => a.cliente_id === params[0] && a.item_id === String(params[1]));
      return { rows: row ? [row] : [] };
    }
    if (q.startsWith("UPDATE meli_anuncios SET pictures_json")) {
      this.updates += 1;
      const row = this.anuncios.find((a) => a.cliente_id === params[0] && a.item_id === String(params[1]));
      if (!row) return { rows: [] };
      row.pictures_json = JSON.parse(params[2]);
      row.pictures_count = params[3];
      if (params[4]) row.thumbnail = params[4];
      return { rows: [row] };
    }
    if (q.startsWith("UPDATE")) { this.updates += 1; return { rows: [] }; }
    return { rows: [] };
  }
}

async function comDb(anuncio, fn) {
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  const db = new MockDb({ anuncios: [anuncio] });
  pool.query = (sql, params) => db.query(sql, params);
  pool.connect = () => db.connect();
  try { return await fn(db); } finally { pool.query = originalQuery; pool.connect = originalConnect; }
}

function fakeRes() {
  return {
    statusCode: 200,
    corpo: null,
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.corpo = obj; return this; },
  };
}

let PNG;

async function enviar({ grupo = "id:52049", handler, anuncio } = {}) {
  return comDb(anuncio || anuncioFixture(), async (db) => {
    mlChamadas = [];
    mlHandler = handler;
    const res = fakeRes();
    await ctrl.adicionarImagem({
      params: { itemId: "MLB555" },
      query: { clienteSlug: "cliente-a", grupoVariacao: grupo },
      body: {},
      file: { buffer: PNG, mimetype: "image/png", originalname: "azul.png", size: PNG.length },
    }, res);
    return { res, db };
  });
}

async function grupos(handler) {
  return comDb(anuncioFixture(), async () => {
    mlChamadas = [];
    mlHandler = handler;
    const res = fakeRes();
    await ctrl.gruposImagemVariacoes({ params: { itemId: "MLB555" }, query: { clienteSlug: "cliente-a" } }, res);
    return res;
  });
}

const seq = () => mlChamadas.map((c) => `${c.metodo} ${c.path.split("?")[0]}`);
const picIds = (item, vid) => item.variations.find((v) => String(v.id) === String(vid)).picture_ids;

let checks = 0;
function ok(msg) { checks += 1; console.log(`  ✓ ${msg}`); }

async function run() {
  PNG = await sharp({ create: { width: 800, height: 800, channels: 3, background: { r: 20, g: 40, b: 200 } } }).png().toBuffer();

  // 1. Grupos para a tela: agrupa pelo atributo defines_picture (Cor), com as
  //    fotos de cada grupo e o rótulo das combinações.
  {
    const { handler } = mlSimulado();
    const res = await grupos(handler);
    assert.strictEqual(res.statusCode, 200, JSON.stringify(res.corpo));
    assert.deepStrictEqual(res.corpo.atributo, { id: "COLOR", nome: "Cor" });
    assert.strictEqual(res.corpo.grupos.length, 2);
    const [azul, preto] = res.corpo.grupos;
    assert.strictEqual(azul.chave, "id:52049");
    assert.strictEqual(azul.valor, "Azul");
    assert.deepStrictEqual(azul.variacoes, [{ id: "101", rotulo: "P" }, { id: "102", rotulo: "M" }]);
    assert.deepStrictEqual(azul.fotos, [url("AZ1"), url("AZ2")]);
    assert.deepStrictEqual(preto.fotos, [url("PR1")]);
    assert.ok(!mlChamadas.some((c) => c.metodo !== "GET"), "listar grupos é só leitura");
    ok("grupos de foto seguem o atributo defines_picture (Cor), com as fotos de cada grupo");
  }

  // 2. Anúncio com UMA variação: upload + PUT funcionam e o snapshot recebe a
  //    lista relida.
  {
    const item = itemMl();
    item.variations = [variacao(101, "52049", "Azul", "P", ["AZ1", "AZ2"])];
    item.pictures = item.pictures.slice(0, 2);
    const ml = mlSimulado({ item });
    const { res, db } = await enviar({ handler: ml.handler, anuncio: anuncioFixture({ variations_count: 1 }) });
    assert.strictEqual(res.statusCode, 200, JSON.stringify(res.corpo));
    assert.strictEqual(res.corpo.ok, true);
    assert.strictEqual(res.corpo.pictureId, "NOVA");
    assert.deepStrictEqual(seq(), [
      "GET /items/MLB555",
      "GET /categories/MLB31447/attributes",
      "POST /pictures/items/upload",
      "GET /items/MLB555",
      "PUT /items/MLB555",
      "GET /items/MLB555",
    ]);
    assert.ok(mlChamadas.every((c) => c.mlUserId === "111"));
    assert.deepStrictEqual(picIds(ml.estado.item, 101), ["AZ1", "AZ2", "NOVA"]);
    assert.deepStrictEqual(db.anuncios[0].pictures_json, [url("AZ1"), url("AZ2"), url("NOVA")]);
    assert.strictEqual(res.corpo.grupo.valor, "Azul");
    ok("anúncio com uma variação: upload, PUT e snapshot com a lista relida do ML");
  }

  // 3. Múltiplas variações: a nova entra em Azul P e Azul M, NÃO em Preto P;
  //    o PUT leva todas as fotos e todas as variações.
  {
    const ml = mlSimulado();
    const { res } = await enviar({ handler: ml.handler });
    assert.strictEqual(res.corpo.ok, true, JSON.stringify(res.corpo));
    const put = mlChamadas.find((c) => c.metodo === "PUT");
    assert.deepStrictEqual(put.body, {
      pictures: [{ id: "AZ1" }, { id: "AZ2" }, { id: "PR1" }, { id: "NOVA" }],
      variations: [
        { id: 101, picture_ids: ["AZ1", "AZ2", "NOVA"] },
        { id: 102, picture_ids: ["AZ1", "AZ2", "NOVA"] },
        { id: 103, picture_ids: ["PR1"] },
      ],
    });
    assert.deepStrictEqual(picIds(ml.estado.item, 103), ["PR1"], "Preto não recebe a foto do Azul");
    assert.strictEqual(res.corpo.grupo.variacoes, 2);
    ok("múltiplas variações: foto vai para todo o grupo Azul e para nenhuma outra; PUT preserva tudo");
  }

  // 4. O PUT é montado do GET feito DEPOIS do upload: uma foto que entrou no
  //    meio do caminho é preservada.
  {
    const ml = mlSimulado();
    const handler = (c) => {
      const r = ml.handler(c);
      if (c.path === "/pictures/items/upload") {
        ml.estado.item.pictures.push({ id: "PR2", secure_url: url("PR2") });
        ml.estado.item.variations[2].picture_ids = ["PR1", "PR2"];
      }
      return r;
    };
    const { res } = await enviar({ handler });
    assert.strictEqual(res.corpo.ok, true, JSON.stringify(res.corpo));
    const put = mlChamadas.find((c) => c.metodo === "PUT");
    assert.ok(put.body.pictures.some((p) => p.id === "PR2"), "foto nova de outro grupo não pode ser apagada");
    assert.deepStrictEqual(put.body.variations[2].picture_ids, ["PR1", "PR2"]);
    ok("o PUT usa o estado lido depois do upload — nada que mudou no meio é apagado");
  }

  // 5. ML RECUSA o PUT: código/mensagem/causas originais, pictureId, snapshot
  //    intocado.
  {
    const corpoMl = {
      message: "Validation error", error: "validation_error", status: 400,
      cause: [{ code: "item.variations.pictures.max", message: "Variation 101 has more pictures than allowed.", type: "error", references: [] }],
    };
    const ml = mlSimulado();
    const { res, db } = await enviar({
      handler: (c) => (c.metodo === "PUT" ? { ok: false, status: 400, data: corpoMl } : ml.handler(c)),
    });
    assert.strictEqual(res.statusCode, 422);
    assert.strictEqual(res.corpo.etapa, "vinculo");
    assert.strictEqual(res.corpo.codigo, "item.variations.pictures.max");
    assert.strictEqual(res.corpo.motivo, corpoMl.cause[0].message);
    assert.deepStrictEqual(res.corpo.detalhesMl.causas, corpoMl.cause);
    assert.strictEqual(res.corpo.pictureId, "NOVA");
    assert.strictEqual(db.updates, 0);
    ok("recusa do ML no PUT: código, mensagem e causas reais; snapshot intocado");
  }

  // 6a. Falha de CONEXÃO depois do upload, mas o ML aplicou: sucesso, com UM
  //     upload e UM PUT (nada reenviado, nada duplicado).
  {
    const ml = mlSimulado();
    const { res, db } = await enviar({
      handler: (c) => {
        if (c.metodo === "PUT") { ml.handler(c); throw new Error("socket hang up"); }
        return ml.handler(c);
      },
    });
    assert.strictEqual(res.corpo.ok, true, JSON.stringify(res.corpo));
    assert.strictEqual(ml.estado.uploads, 1);
    assert.strictEqual(ml.estado.puts, 1);
    assert.deepStrictEqual(picIds(ml.estado.item, 101).filter((x) => x === "NOVA"), ["NOVA"], "sem foto duplicada");
    assert.strictEqual(db.anuncios[0].pictures_count, 4);
    ok("conexão caiu no PUT mas o ML aplicou: releitura prova, sucesso sem reenvio nem duplicata");
  }

  // 6b. 504 no PUT e releitura SEM a foto: erro real, nenhuma nova tentativa.
  {
    const ml = mlSimulado();
    const corpoMl = { message: "Gateway Timeout", error: "gateway_timeout", status: 504, cause: [] };
    const { res, db } = await enviar({
      handler: (c) => (c.metodo === "PUT" ? { ok: false, status: 504, data: corpoMl } : ml.handler(c)),
    });
    assert.strictEqual(res.corpo.ok, false);
    assert.strictEqual(res.corpo.codigo, "gateway_timeout");
    assert.strictEqual(res.corpo.pictureId, "NOVA");
    assert.strictEqual(mlChamadas.filter((c) => c.metodo === "PUT").length, 1, "nunca repete o PUT sozinho");
    assert.strictEqual(mlChamadas.filter((c) => c.path === "/pictures/items/upload").length, 1);
    assert.strictEqual(db.updates, 0);
    ok("5xx no PUT com foto ausente: erro real do ML, sem retry automático, snapshot intocado");
  }

  // 6c. Conexão caiu no PUT e a releitura também: VINCULO_INCERTO.
  {
    const ml = mlSimulado();
    let depoisDoPut = false;
    const { res, db } = await enviar({
      handler: (c) => {
        if (c.metodo === "PUT") { depoisDoPut = true; throw new Error("socket hang up"); }
        if (depoisDoPut) throw new Error("ECONNRESET");
        return ml.handler(c);
      },
    });
    assert.strictEqual(res.corpo.codigo, "VINCULO_INCERTO");
    assert.strictEqual(res.corpo.pictureId, "NOVA");
    assert.strictEqual(db.updates, 0);
    ok("PUT e releitura sem resposta: VINCULO_INCERTO pedindo conferência, snapshot intocado");
  }

  // 6d. O grupo sumiu entre o upload e o PUT: nada é escrito no anúncio.
  {
    const ml = mlSimulado();
    const handler = (c) => {
      const r = ml.handler(c);
      if (c.path === "/pictures/items/upload") {
        ml.estado.item.variations = ml.estado.item.variations.filter((v) => v.id === 103);
      }
      return r;
    };
    const { res } = await enviar({ handler });
    assert.strictEqual(res.corpo.codigo, "VARIACAO_GRUPO_INEXISTENTE");
    assert.strictEqual(res.corpo.pictureId, "NOVA");
    assert.ok(!mlChamadas.some((c) => c.metodo === "PUT"), "sem grupo, nenhum PUT");
    ok("grupo removido depois do upload: nenhum PUT, id da imagem devolvido");
  }

  // 7. Confirmação mostra variação a menos: falha CRÍTICA, nunca sucesso.
  {
    const ml = mlSimulado();
    const { res, db } = await enviar({
      handler: (c) => {
        const r = ml.handler(c);
        if (c.metodo === "PUT") ml.estado.item.variations.pop();
        return r;
      },
    });
    assert.strictEqual(res.corpo.ok, false);
    assert.strictEqual(res.corpo.codigo, "PERDA_DE_VARIACAO");
    assert.strictEqual(res.corpo.critico, true);
    assert.strictEqual(db.updates, 0);
    ok("variação sumida na confirmação: falha crítica, snapshot intocado");
  }

  // 8. Categoria sem defines_picture nas combinações: bloqueio, sem upload.
  {
    const ml = mlSimulado({ atributos: ATRIBUTOS_CATEGORIA.map((a) => ({ ...a, tags: { allow_variations: true } })) });
    const { res } = await enviar({ handler: ml.handler });
    assert.strictEqual(res.statusCode, 409);
    assert.strictEqual(res.corpo.codigo, "ATRIBUTO_FOTO_INDEFINIDO");
    assert.strictEqual(res.corpo.detalhesMl, undefined);
    assert.strictEqual(ml.estado.uploads, 0);
    ok("sem atributo defines_picture: bloqueio explicado, nenhum upload");
  }

  // 9. Grupo inexistente, User Product e catálogo: bloqueio antes do upload.
  {
    let ml = mlSimulado();
    let r = await enviar({ grupo: "id:99999", handler: ml.handler });
    assert.strictEqual(r.res.corpo.codigo, "VARIACAO_GRUPO_INEXISTENTE");
    assert.strictEqual(ml.estado.uploads, 0);

    const itemUp = itemMl();
    itemUp.user_product_id = "MLBU1";
    ml = mlSimulado({ item: itemUp });
    r = await enviar({ handler: ml.handler });
    assert.strictEqual(r.res.corpo.codigo, "IMAGENS_VARIACOES_USER_PRODUCT");
    assert.strictEqual(ml.estado.uploads, 0);

    ml = mlSimulado();
    r = await enviar({ handler: ml.handler, anuncio: anuncioFixture({ catalog_listing: true }) });
    assert.strictEqual(r.res.corpo.codigo, "IMAGENS_BLOQUEADAS_CATALOGO");
    assert.strictEqual(mlChamadas.length, 0);
    ok("grupo inexistente, User Product e catálogo: bloqueados antes do upload");
  }

  // 10. Sync: o snapshot gravado pelo envio é EXATAMENTE o que o sync grava
  //     lendo o mesmo item do ML — nada muda na próxima sincronização.
  {
    const ml = mlSimulado();
    const { res, db } = await enviar({ handler: ml.handler });
    assert.strictEqual(res.corpo.ok, true);
    const sync = mapearItem(ml.estado.item, 1, "cliente-a", 10, "111");
    assert.deepStrictEqual(db.anuncios[0].pictures_json, sync.pictures_json);
    assert.strictEqual(db.anuncios[0].pictures_count, sync.pictures_count);
    assert.strictEqual(sync.variations_count, 3, "o sync continua vendo as 3 variações");
    ok("sync depois do envio produz a mesma lista de fotos e as mesmas variações");
  }

  // 11. Chave por nome para característica personalizada (sem value_id).
  {
    const item = itemMl();
    for (const v of item.variations) v.attribute_combinations[0].value_id = null;
    const g = imagens.gruposDeFotoDasVariacoes(item, [{ id: "COLOR", nome: "Cor" }]);
    assert.strictEqual(g.ok, true);
    assert.deepStrictEqual(g.grupos.map((x) => x.chave), ["nome:azul", "nome:preto"]);
    ok("cor personalizada sem value_id agrupa pelo nome");
  }

  console.log(`\n✓ ${checks} verificações de imagem em variações`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
