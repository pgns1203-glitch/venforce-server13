// server/tests/meliAnunciosFotosHttp.test.js
//
// Camada HTTP do editor de fotos:
//   GET /anuncios-meli/:itemId/fotos/variacoes
//   PUT /anuncios-meli/:itemId/fotos   (multipart: plano + novas[])
//
// Monta o router REAL num Express local e fala HTTP de verdade (fetch +
// FormData). Real: authMiddleware (JWT), requireAutomacoesAccess, guard de
// carteira, multer, controller. Simulado: a decisão de carteira
// (authorizationService), o meliFotosService (a regra de negócio já tem teste
// próprio em meliAnunciosFotos.test.js) e o banco. Nenhum ML.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "venforce_secret_local";

const assert = require("assert");
const Module = require("module");
const express = require("express");
const jwt = require("jsonwebtoken");

// ── stubs ───────────────────────────────────────────────────────────────────
const chamadasServico = [];
let respostaServico = null;          // (metodo, args) => resultado

const servicoFotos = {
  async lerFotos(args) {
    chamadasServico.push({ metodo: "lerFotos", args });
    return respostaServico("lerFotos", args);
  },
  async salvarFotos(args) {
    chamadasServico.push({ metodo: "salvarFotos", args });
    return respostaServico("salvarFotos", args);
  },
};

const CLIENTE = { id: 1, nome: "Cliente A", slug: "cliente-a", ativo: true };

const originalLoad = Module._load;
Module._load = function loadComStubs(request, parent, isMain) {
  if (request === "../services/meliAnuncios/meliFotosService") return servicoFotos;
  if (request === "../services/squads/authorizationService") {
    const real = originalLoad.call(this, request, parent, isMain);
    return {
      ...real,
      async assertClienteNaCarteira(user, ref) {
        if (ref !== CLIENTE.slug || user.id === 99) {
          const err = new Error("Cliente fora da sua carteira.");
          err.statusCode = 403;
          err.code = "CLIENTE_FORA_DA_CARTEIRA";
          throw err;
        }
        return CLIENTE;
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const pool = require("../config/database");
const router = require("../routes/meliAnunciosRoutes");
Module._load = originalLoad;

// ── banco simulado ──────────────────────────────────────────────────────────
const USERS = {
  1: { id: 1, nome: "Operador", role: "user", ativo: true },
  2: { id: 2, nome: "Cliente externo", role: "cliente", ativo: true },
  99: { id: 99, nome: "Fora da carteira", role: "user", ativo: true },
};
let linhaAnuncio = null;
let snapshotsGravados = [];

pool.query = async (sql, params = []) => {
  const q = String(sql).replace(/\s+/g, " ").trim();
  if (q.startsWith("SELECT * FROM users WHERE id = $1")) return { rows: USERS[params[0]] ? [USERS[params[0]]] : [] };
  if (q.includes("FROM clientes WHERE LOWER(slug) = $1")) return { rows: params[0] === CLIENTE.slug ? [CLIENTE] : [] };
  if (q.includes("FROM clientes WHERE id = $1")) return { rows: [CLIENTE] };
  if (q.startsWith("SELECT * FROM meli_anuncios WHERE cliente_id = $1 AND item_id = $2")) {
    return { rows: linhaAnuncio && linhaAnuncio.item_id === String(params[1]) ? [linhaAnuncio] : [] };
  }
  if (q.startsWith("UPDATE meli_anuncios SET pictures_json")) {
    snapshotsGravados.push({ itemId: params[1], pictures_json: JSON.parse(params[2]), pictures_count: params[3] });
    Object.assign(linhaAnuncio, { pictures_json: JSON.parse(params[2]), pictures_count: params[3] });
    return { rows: [linhaAnuncio] };
  }
  return { rows: [] };
};
pool.connect = async () => ({ query: pool.query, release() {} });

function anuncioFixture() {
  return {
    id: 9, cliente_id: 1, cliente_slug: "cliente-a", item_id: "MLB9", catalog_listing: false,
    variations_count: 3, pictures_json: ["https://x/R1.jpg"], pictures_count: 1, ml_user_id: "111",
  };
}

// Leitura como o serviço devolve — inclusive campos que a tela NÃO precisa.
function leituraServico() {
  return {
    ok: true,
    modo: "variacoes",
    atributo: { id: "COLOR", nome: "Cor" },
    limite: { porGrupo: 10, origem: "categoria" },
    grupos: [
      {
        grupoVariacao: { attribute_id: "COLOR", value_id: null, value_name: "Robalo" },
        rotulo: "Robalo",
        variacoes: [{ id: "206028890295", rotulo: "P" }, { id: "206028890297", rotulo: "M" }],
        fotos: [{ id: "R1", url: "https://x/R1.jpg" }, { id: "R2", url: "https://x/R2.jpg" }],
      },
      {
        grupoVariacao: { attribute_id: "COLOR", value_id: "52028", value_name: "Preto" },
        rotulo: "Preto",
        variacoes: [{ id: "206028890303", rotulo: "P" }],
        fotos: [],
      },
    ],
  };
}

// ── servidor ────────────────────────────────────────────────────────────────
let base = "";
const token = (id) => `Bearer ${jwt.sign({ id }, process.env.JWT_SECRET)}`;

async function http(metodo, caminho, { auth = token(1), form, headers = {} } = {}) {
  const h = { ...headers };
  if (auth) h.Authorization = auth;
  const resp = await fetch(base + caminho, { method: metodo, headers: h, body: form });
  let corpo = null;
  try { corpo = await resp.json(); } catch (_) { corpo = null; }
  return { status: resp.status, corpo };
}

const GET_FOTOS = "/anuncios-meli/MLB9/fotos/variacoes?clienteSlug=cliente-a";
const PUT_FOTOS = "/anuncios-meli/MLB9/fotos?clienteSlug=cliente-a";
const PLANO = {
  grupoVariacao: { attribute_id: "COLOR", value_id: null, value_name: "Robalo" },
  base: ["R1", "R2"],
  ordem: [{ existente: "R2" }, { nova: 0 }, { nova: 1 }],
};

function formFotos({ plano = JSON.stringify(PLANO), arquivos = 2, campo = "novas", tamanho = 64 } = {}) {
  const f = new FormData();
  if (plano !== null) f.append("plano", plano);
  for (let i = 0; i < arquivos; i++) {
    const bytes = Buffer.alloc(tamanho, i + 1);
    f.append(campo, new Blob([bytes], { type: i === 0 ? "image/png" : "image/jpeg" }), `foto-${i}.${i === 0 ? "png" : "jpg"}`);
  }
  return f;
}

let checks = 0;
function ok(msg) { checks += 1; console.log(`  ✓ ${msg}`); }

function reset() {
  chamadasServico.length = 0;
  snapshotsGravados = [];
  linhaAnuncio = anuncioFixture();
  respostaServico = (metodo) => (metodo === "lerFotos"
    ? leituraServico()
    : { ok: true, fotos: { pictures_json: ["a"], pictures_count: 1, thumbnail: null }, leitura: leituraServico(), confirmacaoPendente: false, novas: ["N0", "N1"], snapshot: null });
}

async function run() {
  const app = express();
  app.use(express.json());
  app.use("/anuncios-meli", router);
  const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;

  try {
    // 1. Autenticação: sem token, token inválido e papel sem acesso — nada chega ao serviço.
    {
      reset();
      for (const [metodo, caminho, form] of [["GET", GET_FOTOS], ["PUT", PUT_FOTOS, formFotos()]]) {
        const sem = await http(metodo, caminho, { auth: null, form });
        assert.strictEqual(sem.status, 401, `${metodo} sem token`);
        const invalido = await http(metodo, caminho, { auth: "Bearer x.y.z", form: metodo === "PUT" ? formFotos() : undefined });
        assert.strictEqual(invalido.status, 401, `${metodo} token inválido`);
        const papel = await http(metodo, caminho, { auth: token(2), form: metodo === "PUT" ? formFotos() : undefined });
        assert.strictEqual(papel.status, 403, `${metodo} papel sem acesso a automações`);
      }
      assert.strictEqual(chamadasServico.length, 0);
      ok("autenticação: sem token/token inválido = 401, papel sem automações = 403, serviço não é chamado");
    }

    // 2. Acesso negado: cliente fora da carteira (GET e PUT), antes do multer e do serviço.
    {
      reset();
      const g = await http("GET", GET_FOTOS, { auth: token(99) });
      assert.strictEqual(g.status, 403);
      assert.strictEqual(g.corpo.code, "CLIENTE_FORA_DA_CARTEIRA");
      const p = await http("PUT", PUT_FOTOS, { auth: token(99), form: formFotos() });
      assert.strictEqual(p.status, 403);
      assert.strictEqual(p.corpo.code, "CLIENTE_FORA_DA_CARTEIRA");
      const outro = await http("PUT", "/anuncios-meli/MLB9/fotos?clienteSlug=cliente-b", { form: formFotos() });
      assert.strictEqual(outro.status, 403);
      assert.strictEqual(chamadasServico.length, 0);
      ok("acesso negado: cliente fora da carteira = 403 no GET e no PUT, serviço não é chamado");
    }

    // 3. Sem clienteSlug na query: 400 (no PUT, o do corpo multipart não vale).
    {
      reset();
      const g = await http("GET", "/anuncios-meli/MLB9/fotos/variacoes");
      assert.strictEqual(g.status, 400);
      const f = formFotos();
      f.append("clienteSlug", "cliente-a");
      const p = await http("PUT", "/anuncios-meli/MLB9/fotos", { form: f });
      assert.strictEqual(p.status, 400);
      assert.strictEqual(chamadasServico.length, 0);
      ok("clienteSlug só pela query: sem ele = 400, serviço não é chamado");
    }

    // 4. Anúncio inexistente no banco do cliente: 404.
    {
      reset();
      const g = await http("GET", "/anuncios-meli/MLB404/fotos/variacoes?clienteSlug=cliente-a");
      assert.strictEqual(g.status, 404);
      assert.ok(/Anúncio não encontrado/.test(g.corpo.motivo), g.corpo.motivo);
      const p = await http("PUT", "/anuncios-meli/MLB404/fotos?clienteSlug=cliente-a", { form: formFotos() });
      assert.strictEqual(p.status, 404);
      assert.strictEqual(chamadasServico.length, 0);
      ok("anúncio inexistente: 404 no GET e no PUT, serviço não é chamado");
    }

    // 5. GET: só o que a tela precisa (grupos, atributo, fotos, principal, quantidade, limite).
    {
      reset();
      const g = await http("GET", GET_FOTOS);
      assert.strictEqual(g.status, 200, JSON.stringify(g.corpo));
      assert.deepStrictEqual(chamadasServico[0].args, { clienteId: 1, itemId: "MLB9", mlUserId: "111" });
      assert.deepStrictEqual(g.corpo, {
        ok: true,
        modo: "variacoes",
        atributo: { id: "COLOR", nome: "Cor" },
        limite: { porGrupo: 10, origem: "categoria" },
        grupos: [
          {
            grupoVariacao: { attribute_id: "COLOR", value_id: null, value_name: "Robalo" },
            rotulo: "Robalo",
            combinacoes: ["P", "M"],
            quantidade: 2,
            principal: { id: "R1", url: "https://x/R1.jpg" },
            fotos: [{ id: "R1", url: "https://x/R1.jpg" }, { id: "R2", url: "https://x/R2.jpg" }],
          },
          {
            grupoVariacao: { attribute_id: "COLOR", value_id: "52028", value_name: "Preto" },
            rotulo: "Preto",
            combinacoes: ["P"],
            quantidade: 0,
            principal: null,
            fotos: [],
          },
        ],
      });
      assert.ok(!JSON.stringify(g.corpo).includes("206028890295"), "ids internos de variação não saem");
      ok("GET devolve só grupos, atributo, fotos, principal, quantidade e limite");
    }

    // 6. GET: erros do serviço propagados (bloqueio 409; erro do ML 422 com detalhes).
    {
      reset();
      respostaServico = () => ({ ok: false, codigo: "ATRIBUTO_FOTO_INDEFINIDO", etapa: "bloqueio", motivo: "Sem defines_picture." });
      let g = await http("GET", GET_FOTOS);
      assert.strictEqual(g.status, 409);
      assert.deepStrictEqual(g.corpo, { ok: false, codigo: "ATRIBUTO_FOTO_INDEFINIDO", motivo: "Sem defines_picture.", etapa: "bloqueio", incerto: false });

      const detalhesMl = { status: 403, message: "forbidden", error: "forbidden", causa: null, causas: [{ code: "x", message: "y" }] };
      respostaServico = () => ({ ok: false, codigo: "forbidden", etapa: "leitura", motivo: "forbidden", detalhesMl });
      g = await http("GET", GET_FOTOS);
      assert.strictEqual(g.status, 422);
      assert.deepStrictEqual(g.corpo.detalhesMl, detalhesMl);
      ok("GET: bloqueio = 409 sem detalhesMl; erro do ML = 422 com mensagem, código e causa originais");
    }

    // 7. PUT multipart correto: plano parseado e arquivos entregues em ordem, com bytes e tipo.
    {
      reset();
      const p = await http("PUT", PUT_FOTOS + "&clienteContaId=42", { form: formFotos() });
      assert.strictEqual(p.status, 200, JSON.stringify(p.corpo));
      assert.strictEqual(chamadasServico.length, 1);
      const a = chamadasServico[0].args;
      assert.deepStrictEqual(a.plano, PLANO, "o plano chega exatamente como enviado");
      assert.strictEqual(a.clienteId, 1);
      assert.strictEqual(a.itemId, "MLB9");
      assert.strictEqual(a.mlUserId, "111", "conta do próprio anúncio");
      assert.strictEqual(a.anuncio.item_id, "MLB9");
      assert.strictEqual(a.arquivos.length, 2);
      assert.deepStrictEqual(a.arquivos.map((f) => [f.originalname, f.mimetype, f.size]),
        [["foto-0.png", "image/png", 64], ["foto-1.jpg", "image/jpeg", 64]]);
      assert.ok(a.arquivos[0].buffer.equals(Buffer.alloc(64, 1)) && a.arquivos[1].buffer.equals(Buffer.alloc(64, 2)), "bytes intactos");
      assert.strictEqual(typeof a.gravarSnapshot, "function", "o snapshot é entregue ao serviço, não gravado pelo controller");
      ok("PUT: multipart lido, plano e arquivos entregues ao serviço como vieram");
    }

    // 8. PUT sucesso: snapshot só pelo callback do serviço; resposta no formato da tela.
    {
      reset();
      respostaServico = async (metodo, args) => {
        const fotos = { pictures_json: ["https://x/R2.jpg", "https://x/N0.jpg"], pictures_count: 2, thumbnail: null };
        const snapshot = await args.gravarSnapshot(fotos);
        return { ok: true, fotos, leitura: leituraServico(), confirmacaoPendente: false, novas: ["N0"], snapshot };
      };
      const p = await http("PUT", PUT_FOTOS, { form: formFotos({ plano: JSON.stringify({ ...PLANO, ordem: [{ existente: "R2" }, { nova: 0 }] }), arquivos: 1 }) });
      assert.strictEqual(p.status, 200, JSON.stringify(p.corpo));
      assert.deepStrictEqual(snapshotsGravados, [{ itemId: "MLB9", pictures_json: ["https://x/R2.jpg", "https://x/N0.jpg"], pictures_count: 2 }]);
      assert.strictEqual(p.corpo.ok, true);
      assert.strictEqual(p.corpo.anuncio.pictures_count, 2, "linha já atualizada");
      assert.strictEqual(p.corpo.confirmacaoPendente, false);
      assert.deepStrictEqual(p.corpo.novas, ["N0"]);
      assert.deepStrictEqual(p.corpo.fotos.grupos[0].combinacoes, ["P", "M"], "a leitura volta no formato da tela");

      // Sem snapshot (confirmação pendente): o controller não grava nada por conta própria.
      reset();
      respostaServico = () => ({ ok: true, fotos: null, leitura: null, confirmacaoPendente: true, novas: [], snapshot: null });
      const p2 = await http("PUT", PUT_FOTOS, { form: formFotos({ plano: JSON.stringify({ ...PLANO, ordem: [{ existente: "R2" }] }), arquivos: 0 }) });
      assert.strictEqual(p2.status, 200);
      assert.strictEqual(p2.corpo.confirmacaoPendente, true);
      assert.strictEqual(p2.corpo.fotos, null);
      assert.strictEqual(snapshotsGravados.length, 0);
      ok("PUT sucesso: snapshot só via serviço, resposta com a linha e a leitura no formato da tela");
    }

    // 9. PUT: plano ausente ou ilegível = 400 PLANO_INVALIDO sem chamar o serviço.
    {
      reset();
      for (const plano of [null, "{isto não é json", ""]) {
        const p = await http("PUT", PUT_FOTOS, { form: formFotos({ plano, arquivos: 0 }) });
        assert.strictEqual(p.status, 400, String(plano));
        assert.strictEqual(p.corpo.codigo, "PLANO_INVALIDO");
        assert.strictEqual(p.corpo.etapa, "validacao");
        assert.strictEqual(p.corpo.incerto, false);
      }
      assert.strictEqual(chamadasServico.length, 0);
      ok("PUT: plano ausente ou ilegível = 400 PLANO_INVALIDO, serviço não é chamado");
    }

    // 10. PUT: multipart fora do contrato (campo errado, >10 arquivos, >10 MB).
    {
      reset();
      let p = await http("PUT", PUT_FOTOS, { form: formFotos({ campo: "imagem", arquivos: 1 }) });
      assert.strictEqual(p.status, 400);
      assert.strictEqual(p.corpo.codigo, "CAMPO_INVALIDO");
      p = await http("PUT", PUT_FOTOS, { form: formFotos({ arquivos: 11 }) });
      assert.strictEqual(p.status, 400);
      assert.strictEqual(p.corpo.codigo, "CAMPO_INVALIDO");
      p = await http("PUT", PUT_FOTOS, { form: formFotos({ arquivos: 1, tamanho: 10 * 1024 * 1024 + 1 }) });
      assert.strictEqual(p.status, 413);
      assert.strictEqual(p.corpo.codigo, "ARQUIVO_GRANDE");
      assert.strictEqual(chamadasServico.length, 0);
      ok("PUT: campo errado/11 arquivos = 400 CAMPO_INVALIDO; arquivo > 10 MB = 413; serviço não é chamado");
    }

    // 11. PUT: propagação dos erros do serviço, com status e flags consistentes.
    {
      const detalhesMl = { status: 400, message: "Validation error", error: "validation_error", causa: null,
        causas: [{ code: "item.pictures.max", message: "Too many pictures", type: "error", references: [] }] };
      const casos = [
        [{ codigo: "VARIACAO_SEM_IMAGEM", etapa: "validacao", statusHttp: 400, motivo: "Não é possível salvar. A variação Robalo precisa ter pelo menos uma imagem." }, 400, false],
        [{ codigo: "CONTEUDO_INVALIDO", etapa: "validacao", statusHttp: 400, motivo: "Não foi possível decodificar a imagem enviada." }, 400, false],
        [{ codigo: "IMAGEM_EXCESSIVA", etapa: "validacao", statusHttp: 413, motivo: "A imagem tem resolução alta demais para ser processada." }, 413, false],
        [{ codigo: "FOTOS_DESATUALIZADAS", etapa: "bloqueio", motivo: "O anúncio mudou no Mercado Livre desde que você abriu. Recarregue as fotos." }, 409, false],
        [{ codigo: "509", etapa: "upload", motivo: "Picture is below the minimum allowed size.", detalhesMl, pictureIds: ["N0"] }, 422, false],
        [{ codigo: "item.pictures.max", etapa: "vinculo", motivo: "Too many pictures", detalhesMl, pictureIds: ["N0"] }, 422, false],
        [{ codigo: "VINCULO_INCERTO", etapa: "vinculo", motivo: "Confira o anúncio no Mercado Livre antes de salvar de novo.", pictureIds: ["N0"] }, 422, true],
        [{ codigo: "CONFIRMACAO_DIVERGENTE", etapa: "confirmacao", motivo: "Confira." }, 422, true],
        [{ codigo: "PERDA_DE_VARIACAO", etapa: "confirmacao", motivo: "ATENÇÃO", critico: true }, 422, true],
      ];
      for (const [erro, status, incerto] of casos) {
        reset();
        respostaServico = () => ({ ok: false, ...erro });
        const p = await http("PUT", PUT_FOTOS, { form: formFotos() });
        assert.strictEqual(p.status, status, `${erro.codigo}: ${JSON.stringify(p.corpo)}`);
        assert.strictEqual(p.corpo.ok, false);
        assert.strictEqual(p.corpo.codigo, erro.codigo);
        assert.strictEqual(p.corpo.motivo, erro.motivo);
        assert.strictEqual(p.corpo.etapa, erro.etapa);
        assert.strictEqual(p.corpo.incerto, incerto, `${erro.codigo}: incerto`);
        assert.deepStrictEqual(p.corpo.detalhesMl, erro.detalhesMl, `${erro.codigo}: detalhesMl só quando é do ML`);
        assert.deepStrictEqual(p.corpo.pictureIds, erro.pictureIds);
        assert.strictEqual(p.corpo.critico, erro.critico);
        assert.strictEqual(p.corpo.statusHttp, undefined, "detalhe interno não vaza");
        assert.strictEqual(snapshotsGravados.length, 0);
      }
      ok("PUT: erros do serviço propagados (VenForce, ML com detalhes, incerto sem retry), sem snapshot");
    }

    // 12. Exceção inesperada do serviço: 500 genérico, sem vazar a mensagem interna.
    {
      reset();
      respostaServico = () => { throw new Error("boom interno"); };
      const p = await http("PUT", PUT_FOTOS, { form: formFotos() });
      assert.strictEqual(p.status, 500);
      assert.ok(!JSON.stringify(p.corpo).includes("boom"));
      ok("exceção inesperada: 500 sem vazar a mensagem interna");
    }

    // 13. Rotas: as novas estão registradas; a de grupos do PR #205 saiu.
    {
      const rotas = router.stack.filter((c) => c.route).map((c) => `${Object.keys(c.route.methods)[0].toUpperCase()} ${c.route.path}`);
      assert.ok(rotas.includes("GET /:itemId/fotos/variacoes"));
      assert.ok(rotas.includes("PUT /:itemId/fotos"));
      assert.ok(!rotas.includes("GET /:itemId/imagens/variacoes"), "a rota de grupos do PR #205 foi substituída");
      ok("rotas GET /:itemId/fotos/variacoes e PUT /:itemId/fotos registradas; a antiga saiu");
    }
  } finally {
    server.close();
  }

  console.log(`\n✓ ${checks} verificações da camada HTTP do editor de fotos`);
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1; // sem process.exit: deixa o servidor fechar (libuv no Windows)
});
