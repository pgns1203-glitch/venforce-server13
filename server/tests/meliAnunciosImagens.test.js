// server/tests/meliAnunciosImagens.test.js
//
// Adicionar imagem a um anúncio ML (POST /anuncios-meli/:itemId/imagens).
//
// O que este teste protege:
//
//  1. o fluxo é arquivo → validação → JPG (Sharp) → GET /items (elegibilidade
//     ao vivo) → POST /pictures/items/upload (multipart "file") →
//     POST /items/{id}/pictures {id} → GET /items → snapshot. Nessa ordem, com
//     o ml_user_id do próprio anúncio;
//  2. o snapshot local só muda com a lista que o ML devolveu — recusa em
//     qualquer etapa não deixa foto "salva" que o anúncio real não tem;
//  3. o erro do ML chega como veio: código, mensagem e causas originais;
//     recusa LOCAL (arquivo inválido, bloqueio) não finge ser do ML;
//  4. catálogo e variações são bloqueados nesta versão — pela linha local e,
//     se ela estiver desatualizada, pelo item lido agora do ML — antes de
//     qualquer upload;
//  5. o mlClient não força Content-Type JSON num corpo multipart.

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

Module._load = originalLoad;

// ── fixtures ────────────────────────────────────────────────────────────────

const cliente = { id: 1, nome: "Cliente A", slug: "cliente-a", ativo: true };
const FOTOS_ANTES = ["https://http2.mlstatic.com/D_NQ_NP_1-F.jpg", "https://http2.mlstatic.com/D_NQ_NP_2-F.jpg"];

function anuncioFixture(over = {}) {
  return {
    id: 7, cliente_id: 1, cliente_slug: "cliente-a", item_id: "MLB123",
    titulo: "Fone Bluetooth", catalog_listing: false, family_name: null, variations_count: 0,
    pictures_json: FOTOS_ANTES.slice(), pictures_count: 2,
    thumbnail: "https://http2.mlstatic.com/D_1-I.jpg",
    cliente_conta_id: 10, ml_user_id: "111",
    ...over,
  };
}

function itemMl(over = {}) {
  return {
    id: "MLB123", catalog_listing: false, variations: [],
    pictures: [{ id: "1-MLB", secure_url: FOTOS_ANTES[0] }, { id: "2-MLB", secure_url: FOTOS_ANTES[1] }],
    secure_thumbnail: "https://http2.mlstatic.com/D_1-I.jpg",
    ...over,
  };
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

function withMockDb(opts, fn) {
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  const db = new MockDb(opts);
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

function arquivo(buffer, mimetype, originalname) {
  return { buffer, mimetype, originalname: originalname || "foto", size: buffer.length };
}

let PNG_ALFA; // PNG 800x600 com transparência — tem que sair JPG opaco
let PNG_GRANDE; // 2400x1200 — tem que sair limitado a 1920 no maior lado

async function enviar(anuncioLinha, file, handler, query) {
  let resultado;
  await withMockDb({ anuncios: [anuncioLinha] }, async (db) => {
    mlChamadas = [];
    mlHandler = handler;
    const res = fakeRes();
    await ctrl.adicionarImagem({
      params: { itemId: "MLB123" },
      query: query || { clienteSlug: "cliente-a" },
      body: {},
      file,
    }, res);
    resultado = { res, db };
  });
  return resultado;
}

// Handler do caminho feliz: GET /items devolve o item (depois do vínculo, já
// com a foto nova), upload devolve o id, vínculo aceita.
function handlerFeliz(estado = {}) {
  let vinculado = false;
  return (c) => {
    if (c.metodo === "GET" && c.path.startsWith("/items/MLB123")) {
      const base = itemMl(estado.item || {});
      if (vinculado) base.pictures = base.pictures.concat([{ id: "999-MLB", secure_url: "https://http2.mlstatic.com/D_NQ_NP_999-F.jpg" }]);
      return { ok: true, status: 200, data: base };
    }
    if (c.path === "/pictures/items/upload") return { ok: true, status: 201, data: { id: "999-MLB", variations: [] } };
    if (c.path === "/items/MLB123/pictures") { vinculado = true; return { ok: true, status: 200, data: { id: "999-MLB" } }; }
    return { ok: false, status: 404, data: { message: "rota inesperada no teste" } };
  };
}

let checks = 0;
function ok(msg) { checks += 1; console.log(`  ✓ ${msg}`); }

async function run() {
  PNG_ALFA = await sharp({ create: { width: 800, height: 600, channels: 4, background: { r: 200, g: 0, b: 0, alpha: 0.4 } } }).png().toBuffer();
  PNG_GRANDE = await sharp({ create: { width: 2400, height: 1200, channels: 3, background: { r: 10, g: 120, b: 200 } } }).png().toBuffer();

  // 1. Caminho feliz: ordem das chamadas, multipart correto, JPG de verdade,
  //    ml_user_id do anúncio e snapshot com a lista RELIDA do ML.
  {
    const { res, db } = await enviar(anuncioFixture(), arquivo(PNG_ALFA, "image/png", "produto.png"), handlerFeliz());
    assert.strictEqual(res.statusCode, 200, JSON.stringify(res.corpo));
    assert.strictEqual(res.corpo.ok, true);
    assert.strictEqual(res.corpo.pictureId, "999-MLB");

    const seq = mlChamadas.map((c) => `${c.metodo} ${c.path.split("?")[0]}`);
    assert.deepStrictEqual(seq, [
      "GET /items/MLB123",
      "POST /pictures/items/upload",
      "POST /items/MLB123/pictures",
      "GET /items/MLB123",
    ]);
    assert.ok(mlChamadas.every((c) => c.mlUserId === "111"), "toda chamada precisa usar o ml_user_id do anúncio");

    const up = mlChamadas[1];
    assert.ok(up.form, "o upload precisa ir como multipart (FormData)");
    const f = up.form.get("file");
    assert.ok(f && typeof f.arrayBuffer === "function", 'o arquivo vai no campo "file" (contrato do ML)');
    assert.strictEqual(f.type, "image/jpeg");
    const bytes = Buffer.from(await f.arrayBuffer());
    assert.ok(bytes[0] === 0xff && bytes[1] === 0xd8, "o arquivo enviado ao ML precisa ser JPEG de verdade");
    const meta = await sharp(bytes).metadata();
    assert.strictEqual(meta.format, "jpeg");
    assert.strictEqual(meta.hasAlpha, false, "PNG com transparência precisa sair opaco (fundo branco)");
    assert.strictEqual(meta.width, 800);

    assert.deepStrictEqual(mlChamadas[2].body, { id: "999-MLB" }, "o vínculo leva o id que o upload devolveu");

    const linha = db.anuncios[0];
    assert.deepStrictEqual(linha.pictures_json, FOTOS_ANTES.concat(["https://http2.mlstatic.com/D_NQ_NP_999-F.jpg"]));
    assert.strictEqual(linha.pictures_count, 3);
    assert.strictEqual(res.corpo.anuncio.pictures_count, 3, "a resposta traz a linha já atualizada");
    assert.strictEqual(res.corpo.confirmacaoPendente, false);
    assert.strictEqual(res.corpo.imagem.abaixoDoMinimoMl, false);
    ok("upload vai ao ML como multipart JPG, é vinculado com o id devolvido e o snapshot recebe a lista relida");
  }

  // 2. Imagem maior que 1920 é reduzida no maior lado, sem distorcer.
  {
    const { res } = await enviar(anuncioFixture(), arquivo(PNG_GRANDE, "image/png"), handlerFeliz());
    assert.strictEqual(res.corpo.ok, true);
    const meta = await sharp(Buffer.from(await mlChamadas[1].form.get("file").arrayBuffer())).metadata();
    assert.strictEqual(meta.width, 1920);
    assert.strictEqual(meta.height, 960);
    ok("imagem acima de 1920 px é reduzida ao máximo documentado pelo ML, mantendo a proporção");
  }

  // 3. ML RECUSA o upload: código/mensagem/causas originais preservados,
  //    nenhum vínculo tentado, snapshot intocado.
  {
    const corpoMl = {
      message: "Picture is below the minimum allowed size.", error: "validation_error", status: 400,
      cause: [{ code: "509", message: "Picture id 650349-MLA10B is below the minimum allowed size.", type: "error", references: [] }],
    };
    const { res, db } = await enviar(anuncioFixture(), arquivo(PNG_ALFA, "image/png"), (c) => {
      if (c.path === "/pictures/items/upload") return { ok: false, status: 400, data: corpoMl };
      return handlerFeliz()(c);
    });
    assert.strictEqual(res.statusCode, 422);
    assert.strictEqual(res.corpo.ok, false);
    assert.strictEqual(res.corpo.etapa, "upload");
    assert.strictEqual(res.corpo.codigo, "509", "código do ML preservado");
    assert.strictEqual(res.corpo.motivo, corpoMl.cause[0].message, "mensagem original do ML preservada");
    assert.strictEqual(res.corpo.detalhesMl.status, 400);
    assert.strictEqual(res.corpo.detalhesMl.message, corpoMl.message);
    assert.deepStrictEqual(res.corpo.detalhesMl.causas, corpoMl.cause);
    assert.ok(!mlChamadas.some((c) => c.path === "/items/MLB123/pictures"), "upload recusado não pode ser vinculado");
    assert.strictEqual(db.updates, 0, "recusa não pode tocar o snapshot");
    assert.deepStrictEqual(db.anuncios[0].pictures_json, FOTOS_ANTES);
    ok("recusa do ML no upload: código, mensagem e causas reais chegam à tela; snapshot intocado");
  }

  // 4. ML RECUSA o vínculo: erro real + o id da imagem que já subiu.
  {
    const corpoMl = { message: "Item has reached the maximum number of pictures", error: "bad_request", status: 400, cause: [] };
    const { res, db } = await enviar(anuncioFixture(), arquivo(PNG_ALFA, "image/png"), (c) => {
      if (c.path === "/items/MLB123/pictures") return { ok: false, status: 400, data: corpoMl };
      return handlerFeliz()(c);
    });
    assert.strictEqual(res.corpo.ok, false);
    assert.strictEqual(res.corpo.etapa, "vinculo");
    assert.strictEqual(res.corpo.codigo, "bad_request");
    assert.strictEqual(res.corpo.motivo, corpoMl.message);
    assert.strictEqual(res.corpo.pictureId, "999-MLB", "a imagem subiu ao CDN: o id volta, sem fingir que nada aconteceu");
    assert.strictEqual(db.updates, 0);
    ok("recusa do ML no vínculo: motivo real preservado e snapshot intocado");
  }

  // 5. Catálogo pela linha local: bloqueado ANTES de qualquer chamada ao ML.
  {
    const { res, db } = await enviar(anuncioFixture({ catalog_listing: true }), arquivo(PNG_ALFA, "image/png"), handlerFeliz());
    assert.strictEqual(res.statusCode, 409);
    assert.strictEqual(res.corpo.codigo, "IMAGENS_BLOQUEADAS_CATALOGO");
    assert.strictEqual(res.corpo.etapa, "bloqueio");
    assert.ok(/catálogo/i.test(res.corpo.motivo));
    assert.strictEqual(res.corpo.detalhesMl, undefined, "bloqueio local não pode se passar por resposta do ML");
    assert.strictEqual(mlChamadas.length, 0, "catálogo não gasta chamada ao ML");
    assert.strictEqual(db.updates, 0);
    ok("anúncio de catálogo (linha local) é bloqueado sem chamar o ML");
  }

  // 6. Catálogo só no ML (linha antiga, catalog_listing NULL): a leitura ao
  //    vivo bloqueia antes do upload.
  {
    const { res } = await enviar(
      anuncioFixture({ catalog_listing: null }),
      arquivo(PNG_ALFA, "image/png"),
      handlerFeliz({ item: { catalog_listing: true } })
    );
    assert.strictEqual(res.corpo.codigo, "IMAGENS_BLOQUEADAS_CATALOGO");
    assert.deepStrictEqual(mlChamadas.map((c) => c.metodo + " " + c.path.split("?")[0]), ["GET /items/MLB123"]);
    ok("catálogo confirmado só na leitura ao vivo também bloqueia — antes do upload");
  }

  // 7. Variações: bloqueadas pela linha local e pela leitura ao vivo.
  {
    const local = await enviar(anuncioFixture({ variations_count: 3 }), arquivo(PNG_ALFA, "image/png"), handlerFeliz());
    assert.strictEqual(local.res.statusCode, 409);
    assert.strictEqual(local.res.corpo.codigo, "IMAGENS_BLOQUEADAS_VARIACOES");
    assert.ok(/variações/i.test(local.res.corpo.motivo));
    assert.strictEqual(mlChamadas.length, 0);

    const aoVivo = await enviar(
      anuncioFixture({ variations_count: null }),
      arquivo(PNG_ALFA, "image/png"),
      handlerFeliz({ item: { variations: [{ id: 1 }, { id: 2 }] } })
    );
    assert.strictEqual(aoVivo.res.corpo.codigo, "IMAGENS_BLOQUEADAS_VARIACOES");
    assert.ok(!mlChamadas.some((c) => c.path === "/pictures/items/upload"), "variação não pode chegar ao upload");
    ok("anúncio com variações é bloqueado (linha local e leitura ao vivo), sem upload");
  }

  // 8. Arquivo que não é imagem: recusa local, sem ML, sem detalhesMl.
  {
    const { res } = await enviar(anuncioFixture(), arquivo(Buffer.from("isto não é uma imagem, é texto puro"), "image/png"), handlerFeliz());
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.corpo.etapa, "validacao");
    assert.strictEqual(res.corpo.codigo, "CONTEUDO_INVALIDO");
    assert.strictEqual(res.corpo.detalhesMl, undefined);
    assert.strictEqual(mlChamadas.length, 0);
    ok("arquivo que não é PNG/JPG/WebP é recusado localmente, sem chamar o ML");
  }

  // 9. Vínculo aceito mas a releitura falha: sucesso honesto, sem lista
  //    inventada no snapshot.
  {
    let gets = 0;
    const feliz = handlerFeliz();
    const { res, db } = await enviar(anuncioFixture(), arquivo(PNG_ALFA, "image/png"), (c) => {
      if (c.metodo === "GET") { gets += 1; if (gets === 2) return { ok: false, status: 500, data: { message: "internal" } }; }
      return feliz(c);
    });
    assert.strictEqual(res.corpo.ok, true);
    assert.strictEqual(res.corpo.confirmacaoPendente, true);
    assert.strictEqual(db.updates, 0, "sem releitura, o snapshot não recebe lista adivinhada");
    assert.deepStrictEqual(res.corpo.anuncio.pictures_json, FOTOS_ANTES);
    ok("vínculo aceito com releitura falha: ok + confirmacaoPendente, snapshot não adivinha a lista");
  }

  // 10. Sem clienteSlug na QUERY → 400 (o do corpo multipart não vale: o guard
  //     de carteira não o enxerga).
  {
    const { res } = await enviar(anuncioFixture(), arquivo(PNG_ALFA, "image/png"), handlerFeliz(), {});
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(mlChamadas.length, 0);
    ok("clienteSlug só é aceito pela query (a que passou pelo guard de carteira)");
  }

  // 11. mlClient: corpo FormData não recebe Content-Type JSON (o fetch põe o
  //     boundary); corpo JSON continua recebendo.
  {
    const cacheKey = require.resolve("../utils/mlClient");
    delete require.cache[cacheKey];
    Module._load = function (request, parent, isMain) {
      if (request === "../services/mlTokenService") {
        return {
          getValidMlGrantToken: async () => ({ accessToken: "tok", grant: { id: 1 } }),
          getMlGrantTokenNoRefresh: async () => ({ accessToken: "tok", grant: { id: 1 } }),
          getValidMlTokenByCliente: async () => "tok",
          refreshMlGrant: async () => ({}),
          sanitizeErrorMessage: (e) => String(e && e.message),
        };
      }
      return originalLoad.call(this, request, parent, isMain);
    };
    const { mlFetch } = require("../utils/mlClient");
    Module._load = originalLoad;
    delete require.cache[cacheKey];

    const originalFetch = global.fetch;
    const vistos = [];
    global.fetch = async (url, opts) => {
      vistos.push(opts.headers);
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({}) };
    };
    try {
      const form = new FormData();
      form.append("file", new Blob([Buffer.from([1, 2, 3])], { type: "image/jpeg" }), "a.jpg");
      await mlFetch(1, "/pictures/items/upload", { method: "POST", body: form, mlUserId: "111" });
      await mlFetch(1, "/items/MLB123", { method: "PUT", body: "{}", mlUserId: "111" });
    } finally {
      global.fetch = originalFetch;
    }
    assert.strictEqual(vistos[0]["Content-Type"], undefined, "multipart não pode sair com Content-Type JSON");
    assert.strictEqual(vistos[0].Authorization, "Bearer tok");
    assert.strictEqual(vistos[1]["Content-Type"], "application/json", "o JSON de sempre não pode mudar");
    ok("mlClient deixa o fetch montar o multipart e mantém JSON para o resto");
  }

  console.log(`\n✓ ${checks} verificações de imagem de anúncio ML`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
