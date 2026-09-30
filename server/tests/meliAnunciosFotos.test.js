// server/tests/meliAnunciosFotos.test.js
//
// Editor de fotos por grupo de variação (GET/PUT /anuncios-meli/:itemId/fotos).
// Parte 1: funções puras de meliFotosService. Parte 2 (etapa 2 do plano):
// orquestração contra um ML simulado com estado.
//
// Spec: docs/superpowers/specs/2026-09-30-fotos-por-variacao-design.md

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const Module = require("module");
const sharp = require("sharp");

// ── stub do cliente ML (antes de carregar o serviço) ────────────────────────
let mlChamadas = [];
let mlHandler = null;
const eventos = [];                 // linha do tempo: chamadas ao ML + snapshot
const originalLoad = Module._load;
Module._load = function loadWithMlFetchStub(request, parent, isMain) {
  if (request === "../../utils/mlClient" || request === "../utils/mlClient") {
    return {
      async mlFetch(clienteId, path, options = {}) {
        const multipart = options.body instanceof FormData;
        const chamada = {
          clienteId, path, metodo: options.method || "GET", mlUserId: options.mlUserId,
          form: multipart ? options.body : null,
          body: options.body && !multipart ? JSON.parse(options.body) : null,
        };
        mlChamadas.push(chamada);
        eventos.push(`${chamada.metodo} ${path.split("?")[0]}`);
        return mlHandler ? mlHandler(chamada) : { ok: true, status: 200, data: {} };
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const fotos = require("../services/meliAnuncios/meliFotosService");
const { mapearItem } = require("../services/meliAnuncios/meliSyncService");
Module._load = originalLoad;

const url = (id) => `https://http2.mlstatic.com/D_NQ_NP_${id}-F.jpg`;

// Robalo (P, M) e Preto (P). Robalo é valor personalizado: value_id null
// (caso real da Red Fish). Preto tem value_id.
function variacao(id, attrId, valueId, valor, tam, pictureIds) {
  return {
    id,
    attribute_combinations: [
      { id: attrId, name: "Estampa", value_id: valueId, value_name: valor },
      { id: "SIZE", name: "Tamanho", value_id: null, value_name: tam },
    ],
    price: 50, available_quantity: 3, sold_quantity: 0,
    picture_ids: pictureIds,
  };
}

function itemVar(attrId = "COLOR") {
  return {
    id: "MLB9", catalog_listing: false, category_id: "MLB1", user_product_id: null,
    pictures: ["R1", "R2", "R3", "P1"].map((id) => ({ id, secure_url: url(id) })),
    variations: [
      variacao(1, attrId, null, "Robalo", "P", ["R1", "R2", "R3"]),
      variacao(2, attrId, null, "Robalo", "M", ["R1", "R2", "R3"]),
      variacao(3, attrId, "52028", "Preto", "P", ["P1"]),
    ],
    secure_thumbnail: url("R1"),
  };
}

function itemSimples() {
  return {
    id: "MLB8", catalog_listing: false, category_id: "MLB1", user_product_id: null, variations: [],
    pictures: ["A", "B", "C"].map((id) => ({ id, secure_url: url(id) })),
    secure_thumbnail: url("A"),
  };
}

const ROBALO = { attribute_id: "COLOR", value_id: null, value_name: "Robalo" };
const ATRIBUTO = { id: "COLOR", nome: "Cor" };

// Aplica um payload de PUT sobre um item como o ML faz (o que não vier, some).
function aplicar(item, payload) {
  const depois = JSON.parse(JSON.stringify(item));
  depois.pictures = payload.pictures.map((p) => ({ id: p.id, secure_url: url(p.id) }));
  if (payload.variations) {
    const porId = Object.fromEntries(depois.variations.map((v) => [String(v.id), v]));
    depois.variations = payload.variations.map((v) => ({ ...porId[String(v.id)], picture_ids: v.picture_ids }));
  }
  return depois;
}

let checks = 0;
function ok(msg) { checks += 1; console.log(`  ✓ ${msg}`); }

function puras() {
  // 1. Grupos: um por valor do atributo, fotos da primeira variação, rótulo = value_name.
  {
    const g = fotos.montarGrupos(itemVar(), ATRIBUTO);
    assert.strictEqual(g.ok, true, JSON.stringify(g));
    assert.deepStrictEqual(g.grupos.map((x) => x.rotulo), ["Robalo", "Preto"]);
    assert.deepStrictEqual(g.grupos[0].grupoVariacao, ROBALO);
    assert.deepStrictEqual(g.grupos[1].grupoVariacao, { attribute_id: "COLOR", value_id: "52028", value_name: "Preto" });
    assert.deepStrictEqual(g.grupos[0].variacoes, [{ id: "1", rotulo: "P" }, { id: "2", rotulo: "M" }]);
    assert.deepStrictEqual(g.grupos[0].fotos, [{ id: "R1", url: url("R1") }, { id: "R2", url: url("R2") }, { id: "R3", url: url("R3") }]);
    ok("montarGrupos agrupa pelo valor do atributo com as fotos de cada grupo");
  }

  // 2. Atributo que não é COLOR funciona igual, do agrupamento à reconstrução.
  {
    const item = itemVar("PATTERN_NAME");
    const g = fotos.montarGrupos(item, { id: "PATTERN_NAME", nome: "Estampa" });
    assert.strictEqual(g.ok, true);
    assert.strictEqual(g.grupos[0].grupoVariacao.attribute_id, "PATTERN_NAME");
    const gv = { attribute_id: "PATTERN_NAME", value_id: null, value_name: "Robalo" };
    const v = fotos.validarPlano({ grupoVariacao: gv, base: ["R1", "R2", "R3"], ordem: [{ existente: "R2" }] }, g.grupos, 0);
    assert.strictEqual(v.ok, true, JSON.stringify(v));
    assert.strictEqual(v.grupo.rotulo, "Robalo");
    // O mesmo valor sob OUTRO atributo não é o mesmo grupo.
    const outro = fotos.validarPlano({ grupoVariacao: ROBALO, base: ["R1", "R2", "R3"], ordem: [{ existente: "R2" }] }, g.grupos, 0);
    assert.strictEqual(outro.codigo, "VARIACAO_GRUPO_INEXISTENTE");
    ok("grupoVariacao não assume COLOR: outro atributo agrupa, valida e distingue");
  }

  // 3. mesmoValor: value_id quando existe; senão value_name normalizado.
  {
    assert.strictEqual(fotos.mesmoValor({ id: "COLOR", value_id: null, value_name: " robalo " }, ROBALO), true);
    assert.strictEqual(fotos.mesmoValor({ id: "COLOR", value_id: "52028", value_name: "Preto" },
      { attribute_id: "COLOR", value_id: "52028", value_name: "outro nome" }), true);
    assert.strictEqual(fotos.mesmoValor({ id: "SIZE", value_id: null, value_name: "Robalo" }, ROBALO), false);
    assert.strictEqual(fotos.mesmoValor({ id: "COLOR", value_id: null, value_name: "" }, { attribute_id: "COLOR", value_id: null, value_name: "" }), false);
    ok("mesmoValor casa por value_id ou, sem ele, pelo nome normalizado");
  }

  // 4. Anúncio simples: um grupo com a galeria inteira.
  {
    const g = fotos.grupoSimples(itemSimples());
    assert.strictEqual(g.grupoVariacao, null);
    assert.deepStrictEqual(g.fotos.map((f) => f.id), ["A", "B", "C"]);
    assert.strictEqual(fotos.localizarGrupo([g], null), g);
    ok("anúncio sem variação vira um grupo só com a galeria");
  }

  // 5. validarPlano — variação ficando sem imagem (mensagem exata da spec).
  {
    const grupos = fotos.montarGrupos(itemVar(), ATRIBUTO).grupos;
    const vazio = fotos.validarPlano({ grupoVariacao: ROBALO, base: ["R1", "R2", "R3"], ordem: [] }, grupos, 0);
    assert.strictEqual(vazio.codigo, "VARIACAO_SEM_IMAGEM");
    assert.strictEqual(vazio.motivo, "Não é possível salvar. A variação Robalo precisa ter pelo menos uma imagem.");
    assert.strictEqual(vazio.etapa, "validacao");
    const vazioSimples = fotos.validarPlano({ grupoVariacao: null, base: ["A", "B", "C"], ordem: [] }, [fotos.grupoSimples(itemSimples())], 0);
    assert.strictEqual(vazioSimples.motivo, "Não é possível salvar. O anúncio precisa ter pelo menos uma imagem.");
    ok("validarPlano: variação sem imagem recusada com a mensagem exata");
  }

  // 6. validarPlano — grupo inexistente.
  {
    const grupos = fotos.montarGrupos(itemVar(), ATRIBUTO).grupos;
    const r = fotos.validarPlano(
      { grupoVariacao: { attribute_id: "COLOR", value_id: null, value_name: "Tucunaré" }, base: [], ordem: [{ nova: 0 }] },
      grupos, 1
    );
    assert.strictEqual(r.codigo, "VARIACAO_GRUPO_INEXISTENTE");
    assert.strictEqual(r.etapa, "bloqueio");
    // Plano de anúncio simples sobre um anúncio com variações (e vice-versa) também não acha grupo.
    assert.strictEqual(fotos.validarPlano({ grupoVariacao: null, base: [], ordem: [{ existente: "R1" }] }, grupos, 0).codigo, "VARIACAO_GRUPO_INEXISTENTE");
    assert.strictEqual(fotos.validarPlano({ grupoVariacao: ROBALO, base: ["A"], ordem: [{ existente: "A" }] }, [fotos.grupoSimples(itemSimples())], 0).codigo, "VARIACAO_GRUPO_INEXISTENTE");
    ok("validarPlano: grupo inexistente é recusado");
  }

  // 7. validarPlano — foto duplicada.
  {
    const grupos = fotos.montarGrupos(itemVar(), ATRIBUTO).grupos;
    const r = fotos.validarPlano({ grupoVariacao: ROBALO, base: ["R1", "R2", "R3"], ordem: [{ existente: "R1" }, { existente: "R1" }] }, grupos, 0);
    assert.strictEqual(r.codigo, "PLANO_INVALIDO");
    assert.ok(/repetida/.test(r.motivo), r.motivo);
    ok("validarPlano: foto duplicada é recusada");
  }

  // 8. validarPlano — ordem inválida (forma, nova órfã, arquivo sem lugar, foto de outro grupo).
  {
    const grupos = fotos.montarGrupos(itemVar(), ATRIBUTO).grupos;
    const base = ["R1", "R2", "R3"];
    const casos = [
      [null, 0],
      [{ grupoVariacao: ROBALO, base, ordem: "R1" }, 0],
      [{ grupoVariacao: ROBALO, base, ordem: [{}] }, 0],
      [{ grupoVariacao: ROBALO, base, ordem: [{ existente: "R1", nova: 0 }] }, 1],
      [{ grupoVariacao: ROBALO, base, ordem: [{ nova: 1 }] }, 1],
      [{ grupoVariacao: ROBALO, base, ordem: [{ nova: 0 }, { nova: 0 }] }, 1],
      [{ grupoVariacao: ROBALO, base, ordem: [{ existente: "R1" }] }, 1],
      [{ grupoVariacao: ROBALO, base, ordem: [{ existente: "P1" }] }, 0],
      [{ grupoVariacao: { attribute_id: "COLOR" }, base, ordem: [{ existente: "R1" }] }, 0],
      [{ grupoVariacao: ROBALO, base: "R1", ordem: [{ existente: "R1" }] }, 0],
    ];
    for (const [plano, n] of casos) {
      const r = fotos.validarPlano(plano, grupos, n);
      assert.strictEqual(r.codigo, "PLANO_INVALIDO", `esperava PLANO_INVALIDO para ${JSON.stringify(plano)}/${n}, veio ${JSON.stringify(r)}`);
      assert.strictEqual(r.etapa, "validacao");
    }
    const bom = fotos.validarPlano({ grupoVariacao: ROBALO, base, ordem: [{ nova: 0 }, { existente: "R1" }] }, grupos, 1);
    assert.strictEqual(bom.ok, true, JSON.stringify(bom));
    assert.strictEqual(bom.grupo.rotulo, "Robalo");
    ok("validarPlano: ordem inválida em todas as formas é recusada; plano bom devolve o grupo");
  }

  // 9. validarPlano — base diferente do estado atual = FOTOS_DESATUALIZADAS.
  {
    const grupos = fotos.montarGrupos(itemVar(), ATRIBUTO).grupos;
    const r = fotos.validarPlano({ grupoVariacao: ROBALO, base: ["R1", "R2"], ordem: [{ existente: "R1" }] }, grupos, 0);
    assert.strictEqual(r.codigo, "FOTOS_DESATUALIZADAS");
    assert.strictEqual(r.motivo, "O anúncio mudou no Mercado Livre desde que você abriu. Recarregue as fotos.");
    assert.strictEqual(r.etapa, "bloqueio");
    const ordemDiferente = fotos.validarPlano({ grupoVariacao: ROBALO, base: ["R2", "R1", "R3"], ordem: [{ existente: "R1" }] }, grupos, 0);
    assert.strictEqual(ordemDiferente.codigo, "FOTOS_DESATUALIZADAS", "a ordem da base também conta");
    ok("validarPlano: base desatualizada é recusada");
  }

  // 10. validarLimite: mensagem exata com o limite recebido.
  {
    const plano = { grupoVariacao: ROBALO, base: [], ordem: [{ existente: "R1" }, { existente: "R2" }, { existente: "R3" }] };
    const r = fotos.validarLimite(plano, 2);
    assert.strictEqual(r.codigo, "LIMITE_IMAGENS");
    assert.strictEqual(r.motivo, "Não é possível salvar. A variação Robalo pode ter no máximo 2 imagens.");
    assert.strictEqual(fotos.validarLimite(plano, 3).ok, true);
    ok("validarLimite recusa acima do limite com a mensagem exata");
  }

  // 11. Reconstrução: estado atual + ordem pedida = payload completo.
  {
    const item = itemVar();
    const g = fotos.montarGrupos(item, ATRIBUTO).grupos[0];
    const ordemIds = fotos.resolverOrdem([{ existente: "R3" }, { nova: 0 }, { existente: "R1" }], ["N0"]);
    assert.deepStrictEqual(ordemIds, ["R3", "N0", "R1"]);
    const { payload, removidas } = fotos.reconstruirPayload(item, g, ordemIds);
    assert.deepStrictEqual(removidas, ["R2"]);
    assert.deepStrictEqual(payload.pictures, [{ id: "R1" }, { id: "R3" }, { id: "P1" }, { id: "N0" }]);
    assert.deepStrictEqual(payload.variations, [
      { id: 1, picture_ids: ["R3", "N0", "R1"] },
      { id: 2, picture_ids: ["R3", "N0", "R1"] },
      { id: 3, picture_ids: ["P1"] },
    ]);
    ok("reconstruirPayload: estado atual + ordem pedida = payload completo");
  }

  // 12. A reconstrução parte do estado ATUAL, não do que a tela viu: o que
  //     mudou fora do grupo (foto nova em Preto) entra no payload.
  {
    const vistoPelaTela = itemVar();
    const grupoVisto = fotos.montarGrupos(vistoPelaTela, ATRIBUTO).grupos[0];
    const atual = itemVar();
    atual.pictures.push({ id: "P2", secure_url: url("P2") });
    atual.variations[2].picture_ids = ["P1", "P2"];
    const grupoAtual = fotos.montarGrupos(atual, ATRIBUTO).grupos[0];
    assert.deepStrictEqual(grupoAtual.fotos, grupoVisto.fotos, "o grupo alvo não mudou");
    const { payload } = fotos.reconstruirPayload(atual, grupoAtual, ["R2", "R1", "R3"]);
    assert.ok(payload.pictures.some((p) => p.id === "P2"), "foto que entrou em outro grupo não pode ser apagada");
    assert.deepStrictEqual(payload.variations[2].picture_ids, ["P1", "P2"]);
    assert.strictEqual(payload.variations.length, 3, "todas as variações do estado atual vão no PUT");
    ok("reconstrução usa o estado atual do ML: mudança fora do grupo é preservada");
  }

  // 13. Foto excluída de um grupo mas usada por outro fica na galeria.
  {
    const item = itemVar();
    item.variations[2].picture_ids = ["P1", "R2"];
    const g = fotos.montarGrupos(item, ATRIBUTO).grupos[0];
    const { payload, removidas } = fotos.reconstruirPayload(item, g, ["R1", "R3"]);
    assert.deepStrictEqual(removidas, []);
    assert.ok(payload.pictures.some((p) => p.id === "R2"));
    ok("foto compartilhada com outro grupo não sai da galeria");
  }

  // 14. Reconstrução em anúncio simples: galeria = ordem (a primeira é a capa).
  {
    const item = itemSimples();
    const g = fotos.grupoSimples(item);
    const { payload, removidas } = fotos.reconstruirPayload(item, g, ["C", "A", "N0"]);
    assert.deepStrictEqual(payload, { pictures: [{ id: "C" }, { id: "A" }, { id: "N0" }] });
    assert.deepStrictEqual(removidas, ["B"]);
    ok("anúncio simples: galeria vira a ordem, excluída sai");
  }

  // 15. Conferência: sucesso exato (foto removida saiu, nova entrou, outra variação preservada).
  const base = itemVar();
  const grupo = fotos.montarGrupos(base, ATRIBUTO).grupos[0];
  const ordemIds = ["R3", "N0", "R1"];
  const { payload, removidas } = fotos.reconstruirPayload(base, grupo, ordemIds);
  const aplicado = aplicar(base, payload);
  {
    assert.strictEqual(fotos.conferirFotos(base, aplicado, grupo, ordemIds, removidas).ok, true);
    ok("conferirFotos: resultado exato é aceito");
  }

  // 16. Conferência detecta: removida que continuou, nova ausente, outra variação alterada, ordem divergente.
  {
    const naoRemoveu = aplicar(base, { ...payload, pictures: payload.pictures.concat([{ id: "R2" }]) });
    assert.strictEqual(fotos.conferirFotos(base, naoRemoveu, grupo, ordemIds, removidas).codigo, "CONFIRMACAO_DIVERGENTE", "foto excluída continuou");

    const semNova = aplicar(base, { ...payload, pictures: payload.pictures.filter((p) => p.id !== "N0") });
    assert.strictEqual(fotos.conferirFotos(base, semNova, grupo, ordemIds, removidas).codigo, "CONFIRMACAO_DIVERGENTE", "foto nova ausente da galeria");

    const outraMudou = JSON.parse(JSON.stringify(aplicado));
    outraMudou.variations[2].picture_ids = ["P1", "N0"];
    assert.strictEqual(fotos.conferirFotos(base, outraMudou, grupo, ordemIds, removidas).codigo, "CONFIRMACAO_DIVERGENTE", "outra variação alterada");

    const ordemTrocada = JSON.parse(JSON.stringify(aplicado));
    ordemTrocada.variations[1].picture_ids = ["R1", "N0", "R3"];
    assert.strictEqual(fotos.conferirFotos(base, ordemTrocada, grupo, ordemIds, removidas).codigo, "CONFIRMACAO_DIVERGENTE", "ordem diferente da enviada");
    ok("conferirFotos detecta removida que ficou, nova ausente, outra variação alterada e ordem errada");
  }

  // 17. Conferência: perdas são CRÍTICAS (variação sumida, foto não excluída sumida).
  {
    const perdeuVar = JSON.parse(JSON.stringify(aplicado));
    perdeuVar.variations.pop();
    const r1 = fotos.conferirFotos(base, perdeuVar, grupo, ordemIds, removidas);
    assert.strictEqual(r1.codigo, "PERDA_DE_VARIACAO");
    assert.strictEqual(r1.critico, true);
    assert.strictEqual(r1.etapa, "confirmacao");

    const perdeuFoto = JSON.parse(JSON.stringify(aplicado));
    perdeuFoto.pictures = perdeuFoto.pictures.filter((p) => p.id !== "P1");
    const r2 = fotos.conferirFotos(base, perdeuFoto, grupo, ordemIds, removidas);
    assert.strictEqual(r2.codigo, "PERDA_DE_FOTO");
    assert.strictEqual(r2.critico, true);
    ok("conferirFotos: variação ou foto perdida é falha crítica");
  }

  // 18. Conferência em anúncio simples: galeria exatamente na ordem.
  {
    const item = itemSimples();
    const g = fotos.grupoSimples(item);
    const r = fotos.reconstruirPayload(item, g, ["C", "A"]);
    const depois = aplicar(item, r.payload);
    assert.strictEqual(fotos.conferirFotos(item, depois, g, ["C", "A"], r.removidas).ok, true);
    const fora = aplicar(item, { pictures: [{ id: "A" }, { id: "C" }] });
    assert.strictEqual(fotos.conferirFotos(item, fora, g, ["C", "A"], r.removidas).codigo, "CONFIRMACAO_DIVERGENTE");
    ok("conferirFotos em anúncio simples confere a ordem da galeria");
  }
}

// ── Parte 2: orquestração contra um ML simulado com estado ──────────────────

const ATRIBUTOS_CATEGORIA = [
  { id: "COLOR", name: "Cor", tags: { allow_variations: true, defines_picture: true } },
  { id: "SIZE", name: "Tamanho", tags: { allow_variations: true } },
];

// ML com estado: GET devolve o estado atual; PUT aplica pictures/variations
// como o ML real (variação ou foto omitida some).
function mlSimulado({ item, settings = { max_pictures_per_item: 12, max_pictures_per_item_var: 10 }, categoriaFalha = false } = {}) {
  const estado = { item: item || itemVar(), puts: 0, uploads: 0, proximo: 0, payloads: [] };
  const handler = (c) => {
    const id = estado.item.id;
    if (c.metodo === "GET" && c.path.startsWith(`/items/${id}`)) {
      return { ok: true, status: 200, data: JSON.parse(JSON.stringify(estado.item)) };
    }
    if (c.metodo === "GET" && c.path === `/categories/${estado.item.category_id}/attributes`) {
      return { ok: true, status: 200, data: ATRIBUTOS_CATEGORIA };
    }
    if (c.metodo === "GET" && c.path === `/categories/${estado.item.category_id}`) {
      return categoriaFalha ? { ok: false, status: 500, data: { message: "x" } } : { ok: true, status: 200, data: { settings } };
    }
    if (c.path === "/pictures/items/upload") {
      estado.uploads += 1;
      return { ok: true, status: 201, data: { id: `N${estado.proximo++}` } };
    }
    if (c.metodo === "PUT" && c.path === `/items/${id}`) {
      estado.puts += 1;
      estado.payloads.push(c.body);
      estado.item = aplicar(estado.item, c.body);
      return { ok: true, status: 200, data: estado.item };
    }
    return { ok: false, status: 404, data: { message: `rota inesperada: ${c.metodo} ${c.path}` } };
  };
  return { estado, handler };
}

let PNG;
const arquivo = () => ({ buffer: PNG, mimetype: "image/png", originalname: "n.png", size: PNG.length });
const arquivoRuim = () => ({ buffer: Buffer.from("não é imagem"), mimetype: "image/png", originalname: "x.png", size: 12 });
const idsVar = (item, vid) => item.variations.find((v) => String(v.id) === String(vid)).picture_ids;
const BASE_ROBALO = ["R1", "R2", "R3"];

// Salva com um handler (padrão: o do simulador) e registra o snapshot.
async function salvar(ml, plano, { arquivos = [], anuncio = { catalog_listing: false }, handler, snapshotFalha = false } = {}) {
  mlChamadas = [];
  eventos.length = 0;
  mlHandler = handler || ml.handler;
  const snapshots = [];
  const r = await fotos.salvarFotos({
    clienteId: 1, itemId: ml.estado.item.id, mlUserId: "111", anuncio, plano, arquivos,
    gravarSnapshot: async (f) => {
      eventos.push("SNAPSHOT");
      if (snapshotFalha) throw new Error("connection terminated unexpectedly");
      snapshots.push(f);
      return { pictures_count: f.pictures_count };
    },
  });
  return { r, snapshots };
}

const semEscrita = (ml) => ml.estado.uploads === 0 && ml.estado.puts === 0;

async function orquestracao() {
  PNG = await sharp({ create: { width: 800, height: 800, channels: 3, background: { r: 20, g: 40, b: 200 } } }).png().toBuffer();

  // 19. Leitura com variações: grupos + limite por variação da categoria.
  {
    const ml = mlSimulado();
    mlHandler = ml.handler;
    const r = await fotos.lerFotos({ clienteId: 1, itemId: "MLB9", mlUserId: "111" });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.strictEqual(r.modo, "variacoes");
    assert.deepStrictEqual(r.atributo, { id: "COLOR", nome: "Cor" });
    assert.deepStrictEqual(r.limite, { porGrupo: 10, origem: "categoria" });
    assert.deepStrictEqual(r.grupos.map((g) => g.rotulo), ["Robalo", "Preto"]);
    ok("lerFotos: grupos por atributo e limite por variação lido da categoria");
  }

  // 20. Leitura simples com categoria sem limite: limite operacional (12).
  {
    const ml = mlSimulado({ item: itemSimples(), settings: {} });
    mlHandler = ml.handler;
    const r = await fotos.lerFotos({ clienteId: 1, itemId: "MLB8", mlUserId: "111" });
    assert.strictEqual(r.modo, "simples");
    assert.strictEqual(r.atributo, null);
    assert.deepStrictEqual(r.limite, { porGrupo: 12, origem: "operacional" });
    assert.deepStrictEqual(r.grupos[0].fotos.map((f) => f.id), ["A", "B", "C"]);
    ok("lerFotos simples: um grupo e limite operacional quando a categoria não informa");
  }

  // 21. FLUXO COMPLETO, na ordem: ler ML → validar plano → validar arquivos →
  //     upload → reler → PUT completo → reler → conferir → snapshot.
  {
    const ml = mlSimulado();
    const { r, snapshots } = await salvar(ml,
      { grupoVariacao: ROBALO, base: BASE_ROBALO, ordem: [{ existente: "R3" }, { nova: 0 }, { existente: "R1" }] },
      { arquivos: [arquivo()] });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.deepStrictEqual(eventos, [
      "GET /items/MLB9",                 // estado atual
      "GET /categories/MLB1/attributes", // atributo defines_picture → grupos
      "GET /categories/MLB1",            // limite
      "POST /pictures/items/upload",     // só depois de plano e arquivos válidos
      "GET /items/MLB9",                 // estado atual DE NOVO (base do PUT)
      "PUT /items/MLB9",
      "GET /items/MLB9",                 // confirmação
      "SNAPSHOT",                        // só depois de confirmado
    ]);
    assert.ok(mlChamadas.every((c) => c.mlUserId === "111"));
    assert.deepStrictEqual(ml.estado.payloads[0], {
      pictures: [{ id: "R1" }, { id: "R3" }, { id: "P1" }, { id: "N0" }],
      variations: [
        { id: 1, picture_ids: ["R3", "N0", "R1"] },
        { id: 2, picture_ids: ["R3", "N0", "R1"] },
        { id: 3, picture_ids: ["P1"] },
      ],
    });
    assert.deepStrictEqual(idsVar(ml.estado.item, 3), ["P1"], "outra variação preservada");
    assert.deepStrictEqual(r.novas, ["N0"]);
    assert.strictEqual(r.confirmacaoPendente, false);
    assert.deepStrictEqual(r.leitura.grupos[0].fotos.map((f) => f.id), ["R3", "N0", "R1"]);
    const sync = mapearItem(ml.estado.item, 1, "c", 10, "111");
    assert.strictEqual(snapshots.length, 1);
    assert.deepStrictEqual(snapshots[0].pictures_json, sync.pictures_json, "snapshot = o que o sync gravaria");
    assert.strictEqual(snapshots[0].pictures_count, sync.pictures_count);
    ok("fluxo completo na ordem certa, PUT completo e snapshot só depois da confirmação");
  }

  // 22. Só reordenar (troca a imagem principal da variação): nenhum upload.
  {
    const ml = mlSimulado();
    const { r } = await salvar(ml, { grupoVariacao: ROBALO, base: BASE_ROBALO, ordem: [{ existente: "R2" }, { existente: "R1" }, { existente: "R3" }] });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(ml.estado.uploads, 0);
    assert.deepStrictEqual(idsVar(ml.estado.item, 1), ["R2", "R1", "R3"]);
    assert.deepStrictEqual(idsVar(ml.estado.item, 2), ["R2", "R1", "R3"]);
    ok("só reordenar: sem upload, a imagem principal das variações do grupo troca");
  }

  // 23. Anúncio simples: galeria na ordem pedida; sem leitura de atributos.
  {
    const ml = mlSimulado({ item: itemSimples() });
    const { r } = await salvar(ml, { grupoVariacao: null, base: ["A", "B", "C"], ordem: [{ existente: "C" }, { existente: "A" }] });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.deepStrictEqual(ml.estado.item.pictures.map((p) => p.id), ["C", "A"]);
    assert.ok(!eventos.some((e) => e.endsWith("/attributes")));
    ok("anúncio simples: galeria vira a ordem (capa muda), excluída sai");
  }

  // 24. Plano inválido NUNCA faz upload (nem PUT). Forma inválida nem fala com o ML.
  {
    const casos = [
      ["grupo vazio", { grupoVariacao: ROBALO, base: BASE_ROBALO, ordem: [] }, 0, "VARIACAO_SEM_IMAGEM", false],
      ["foto duplicada", { grupoVariacao: ROBALO, base: BASE_ROBALO, ordem: [{ existente: "R1" }, { existente: "R1" }] }, 0, "PLANO_INVALIDO", false],
      ["ordem inválida", { grupoVariacao: ROBALO, base: BASE_ROBALO, ordem: [{ nova: 3 }] }, 1, "PLANO_INVALIDO", false],
      ["grupo inexistente", { grupoVariacao: { attribute_id: "COLOR", value_id: null, value_name: "Tucunaré" }, base: [], ordem: [{ nova: 0 }] }, 1, "VARIACAO_GRUPO_INEXISTENTE", true],
      ["foto de outro grupo", { grupoVariacao: ROBALO, base: BASE_ROBALO, ordem: [{ existente: "P1" }, { nova: 0 }] }, 1, "PLANO_INVALIDO", true],
    ];
    for (const [nome, plano, n, codigo, leML] of casos) {
      const ml = mlSimulado();
      const { r, snapshots } = await salvar(ml, plano, { arquivos: Array.from({ length: n }, arquivo) });
      assert.strictEqual(r.codigo, codigo, `${nome}: ${JSON.stringify(r)}`);
      assert.ok(semEscrita(ml), `${nome}: não pode haver upload nem PUT`);
      assert.strictEqual(snapshots.length, 0);
      if (!leML) assert.strictEqual(mlChamadas.length, 0, `${nome}: forma inválida não chama o ML`);
    }
    ok("plano inválido nunca faz upload nem PUT (forma inválida nem chama o ML)");
  }

  // 25. Arquivo inválido: recusado antes de qualquer upload.
  {
    const ml = mlSimulado();
    const { r } = await salvar(ml, { grupoVariacao: ROBALO, base: BASE_ROBALO, ordem: [{ existente: "R1" }, { nova: 0 }, { nova: 1 }] },
      { arquivos: [arquivo(), arquivoRuim()] });
    assert.strictEqual(r.etapa, "validacao");
    assert.strictEqual(r.codigo, "CONTEUDO_INVALIDO");
    assert.strictEqual(r.detalhesMl, undefined, "recusa local não se passa por ML");
    assert.ok(semEscrita(ml), "nenhum arquivo sobe se um deles é inválido");
    ok("arquivo inválido: nenhum upload, nem dos arquivos válidos");
  }

  // 26. Limite: da categoria quando existe, operacional (10) quando não. Sem upload.
  {
    let ml = mlSimulado({ settings: { max_pictures_per_item_var: 3 } });
    let { r } = await salvar(ml, { grupoVariacao: ROBALO, base: BASE_ROBALO, ordem: [{ existente: "R1" }, { existente: "R2" }, { existente: "R3" }, { nova: 0 }] },
      { arquivos: [arquivo()] });
    assert.strictEqual(r.codigo, "LIMITE_IMAGENS");
    assert.strictEqual(r.motivo, "Não é possível salvar. A variação Robalo pode ter no máximo 3 imagens.");
    assert.ok(semEscrita(ml));
    ml = mlSimulado({ categoriaFalha: true });
    const onze = BASE_ROBALO.map((id) => ({ existente: id })).concat(Array.from({ length: 8 }, (_, i) => ({ nova: i })));
    ({ r } = await salvar(ml, { grupoVariacao: ROBALO, base: BASE_ROBALO, ordem: onze }, { arquivos: Array.from({ length: 8 }, arquivo) }));
    assert.strictEqual(r.codigo, "LIMITE_IMAGENS");
    assert.ok(/no máximo 10 imagens/.test(r.motivo), r.motivo);
    assert.ok(semEscrita(ml));
    ok("limite da categoria e limite operacional bloqueiam antes do upload");
  }

  // 27. Falha no upload NUNCA faz PUT, e upload parcial não altera o anúncio.
  {
    const ml = mlSimulado();
    const antes = JSON.stringify(ml.estado.item);
    let n = 0;
    const handler = (c) => {
      if (c.path === "/pictures/items/upload" && ++n === 2) {
        return { ok: false, status: 400, data: { message: "Picture is below the minimum allowed size.", error: "validation_error", status: 400,
          cause: [{ code: "509", message: "Picture is below the minimum allowed size.", type: "error", references: [] }] } };
      }
      return ml.handler(c);
    };
    const { r, snapshots } = await salvar(ml,
      { grupoVariacao: ROBALO, base: BASE_ROBALO, ordem: [{ existente: "R1" }, { nova: 0 }, { nova: 1 }] },
      { arquivos: [arquivo(), arquivo()], handler });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.etapa, "upload");
    assert.strictEqual(r.codigo, "509");
    assert.strictEqual(r.detalhesMl.status, 400, "erro do ML preservado");
    assert.deepStrictEqual(r.pictureIds, ["N0"], "o que já subiu é informado");
    assert.strictEqual(ml.estado.puts, 0, "falha no upload nunca faz PUT");
    assert.strictEqual(JSON.stringify(ml.estado.item), antes, "anúncio idêntico ao de antes");
    assert.strictEqual(snapshots.length, 0);
    ok("upload parcial: nenhum PUT, anúncio intacto, ids já enviados informados");
  }

  // 28. Alteração EXTERNA entre abrir a tela e salvar (no grupo): conflito, nada sobe.
  {
    const ml = mlSimulado();
    // A tela abriu com R1,R2,R3; no ML alguém tirou R2 do Robalo.
    ml.estado.item.variations[0].picture_ids = ["R1", "R3"];
    ml.estado.item.variations[1].picture_ids = ["R1", "R3"];
    const { r } = await salvar(ml, { grupoVariacao: ROBALO, base: BASE_ROBALO, ordem: [{ existente: "R3" }, { nova: 0 }] },
      { arquivos: [arquivo()] });
    assert.strictEqual(r.codigo, "FOTOS_DESATUALIZADAS");
    assert.strictEqual(r.motivo, "O anúncio mudou no Mercado Livre desde que você abriu. Recarregue as fotos.");
    assert.ok(semEscrita(ml));
    ok("alteração externa no grupo entre abrir e salvar: conflito, sem upload nem PUT");
  }

  // 29. Alteração externa no grupo DURANTE o upload: conflito, sem PUT, ids informados.
  {
    const ml = mlSimulado();
    const handler = (c) => {
      const r = ml.handler(c);
      if (c.path === "/pictures/items/upload") {
        ml.estado.item.variations[0].picture_ids = ["R1"];
        ml.estado.item.variations[1].picture_ids = ["R1"];
      }
      return r;
    };
    const { r } = await salvar(ml, { grupoVariacao: ROBALO, base: BASE_ROBALO, ordem: [{ existente: "R1" }, { nova: 0 }] },
      { arquivos: [arquivo()], handler });
    assert.strictEqual(r.codigo, "FOTOS_DESATUALIZADAS");
    assert.deepStrictEqual(r.pictureIds, ["N0"]);
    assert.strictEqual(ml.estado.puts, 0);
    ok("alteração externa no grupo durante o upload: conflito, sem PUT");
  }

  // 30. O PUT usa o estado ATUAL do ML, nunca o da tela: mudanças externas fora
  //     do grupo (antes do salvar e durante o upload) são preservadas, e uma
  //     variação removida por fora não é ressuscitada.
  {
    const ml = mlSimulado();
    // Depois que a tela abriu: Preto P foi apagada no ML e entrou a cor Verde.
    ml.estado.item.variations = ml.estado.item.variations.filter((v) => v.id !== 3);
    ml.estado.item.pictures = ml.estado.item.pictures.filter((p) => p.id !== "P1").concat([{ id: "V1", secure_url: url("V1") }]);
    ml.estado.item.variations.push(variacao(4, "COLOR", "52030", "Verde", "P", ["V1"]));
    const handler = (c) => {
      const r = ml.handler(c);
      if (c.path === "/pictures/items/upload") { // durante o upload: foto nova no Verde
        ml.estado.item.pictures.push({ id: "V2", secure_url: url("V2") });
        ml.estado.item.variations[2].picture_ids = ["V1", "V2"];
      }
      return r;
    };
    const { r } = await salvar(ml, { grupoVariacao: ROBALO, base: BASE_ROBALO, ordem: [{ existente: "R2" }, { nova: 0 }] },
      { arquivos: [arquivo()], handler });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    const payload = ml.estado.payloads[0];
    assert.deepStrictEqual(payload.variations.map((v) => v.id), [1, 2, 4], "Preto (apagada por fora) não volta; Verde (nova) vai");
    assert.deepStrictEqual(payload.variations[2].picture_ids, ["V1", "V2"], "mudança durante o upload preservada");
    assert.ok(!payload.pictures.some((p) => p.id === "P1"), "foto apagada por fora não volta");
    assert.ok(payload.pictures.some((p) => p.id === "V2"));
    ok("PUT = estado atual do ML + alteração pedida (nunca o estado da tela)");
  }

  // 31. Erro do ML no PUT: preservado, um único PUT, sem snapshot.
  {
    const ml = mlSimulado();
    const corpoMl = { message: "Validation error", error: "validation_error", status: 400,
      cause: [{ code: "item.pictures.max", message: "Too many pictures", type: "error", references: [] }] };
    const { r, snapshots } = await salvar(ml, { grupoVariacao: ROBALO, base: BASE_ROBALO, ordem: [{ existente: "R2" }] },
      { handler: (c) => (c.metodo === "PUT" ? { ok: false, status: 400, data: corpoMl } : ml.handler(c)) });
    assert.strictEqual(r.etapa, "vinculo");
    assert.strictEqual(r.codigo, "item.pictures.max");
    assert.strictEqual(r.motivo, "Too many pictures");
    assert.deepStrictEqual(r.detalhesMl.causas, corpoMl.cause);
    assert.strictEqual(mlChamadas.filter((c) => c.metodo === "PUT").length, 1);
    assert.strictEqual(snapshots.length, 0);
    ok("recusa do ML no PUT: mensagem, código e causa originais; sem snapshot");
  }

  // 32. PUT aplicado mas resposta perdida: confirma por releitura e conclui.
  {
    const ml = mlSimulado();
    const { r, snapshots } = await salvar(ml, { grupoVariacao: ROBALO, base: BASE_ROBALO, ordem: [{ existente: "R3" }, { existente: "R1" }] },
      { handler: (c) => { if (c.metodo === "PUT") { ml.handler(c); throw new Error("socket hang up"); } return ml.handler(c); } });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.strictEqual(ml.estado.puts, 1, "nunca repete o PUT");
    assert.strictEqual(eventos[eventos.indexOf("PUT /items/MLB9") + 1], "GET /items/MLB9", "releitura logo depois do PUT perdido");
    assert.strictEqual(snapshots.length, 1);
    ok("PUT aplicado com resposta perdida: releitura confirma, um PUT só, snapshot gravado");
  }

  // 33. PUT perdido e releitura também falha: INCERTO, sem retry, sem snapshot.
  {
    const ml = mlSimulado();
    let depois = false;
    const { r, snapshots } = await salvar(ml, { grupoVariacao: ROBALO, base: BASE_ROBALO, ordem: [{ existente: "R3" }, { existente: "R1" }] },
      { handler: (c) => {
        if (c.metodo === "PUT") { depois = true; throw new Error("socket hang up"); }
        if (depois) throw new Error("ECONNRESET");
        return ml.handler(c);
      } });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.codigo, "VINCULO_INCERTO");
    assert.ok(/Confira o anúncio no Mercado Livre antes de salvar de novo/.test(r.motivo), r.motivo);
    assert.strictEqual(r.detalhesMl, undefined);
    assert.strictEqual(mlChamadas.filter((c) => c.metodo === "PUT").length, 1);
    assert.strictEqual(snapshots.length, 0);
    ok("PUT perdido e releitura falha: incerto, um PUT só, sem snapshot");
  }

  // 34. PUT perdido e releitura mostra estado IMPOSSÍVEL (nem o antigo nem o
  //     esperado): INCERTO, nunca retry automático, sem snapshot.
  {
    const ml = mlSimulado();
    const { r, snapshots } = await salvar(ml, { grupoVariacao: ROBALO, base: BASE_ROBALO, ordem: [{ existente: "R3" }, { existente: "R1" }] },
      { handler: (c) => {
        if (c.metodo === "PUT") { // o ML aplicou só metade: a variação 1 mudou, a 2 não
          ml.estado.puts += 1;
          ml.estado.item.variations[0].picture_ids = ["R3", "R1"];
          ml.estado.item.pictures = ml.estado.item.pictures.filter((p) => p.id !== "R2");
          throw new Error("socket hang up");
        }
        return ml.handler(c);
      } });
    assert.strictEqual(r.codigo, "VINCULO_INCERTO", JSON.stringify(r));
    assert.strictEqual(ml.estado.puts, 1);
    assert.strictEqual(snapshots.length, 0);
    ok("estado impossível depois de PUT perdido: incerto, sem retry, sem snapshot");
  }

  // 35. 5xx no PUT e releitura mostra o anúncio INTACTO: erro real do ML, um PUT só.
  {
    const ml = mlSimulado();
    const { r } = await salvar(ml, { grupoVariacao: ROBALO, base: BASE_ROBALO, ordem: [{ existente: "R3" }, { existente: "R1" }] },
      { handler: (c) => (c.metodo === "PUT"
        ? { ok: false, status: 504, data: { message: "Gateway Timeout", error: "gateway_timeout", status: 504, cause: [] } }
        : ml.handler(c)) });
    assert.strictEqual(r.codigo, "gateway_timeout");
    assert.strictEqual(r.detalhesMl.status, 504);
    assert.strictEqual(mlChamadas.filter((c) => c.metodo === "PUT").length, 1);
    ok("5xx com anúncio intacto na releitura: erro real do ML, sem retry");
  }

  // 36. Confirmação com variação perdida: falha crítica, sem snapshot.
  {
    const ml = mlSimulado();
    const { r, snapshots } = await salvar(ml, { grupoVariacao: ROBALO, base: BASE_ROBALO, ordem: [{ existente: "R1" }] },
      { handler: (c) => { const x = ml.handler(c); if (c.metodo === "PUT") ml.estado.item.variations.pop(); return x; } });
    assert.strictEqual(r.codigo, "PERDA_DE_VARIACAO");
    assert.strictEqual(r.critico, true);
    assert.strictEqual(snapshots.length, 0);
    ok("variação perdida na confirmação: crítico, snapshot intocado");
  }

  // 37. PUT ok mas a releitura de confirmação falha: ok + confirmacaoPendente, sem snapshot.
  {
    const ml = mlSimulado();
    let putFeito = false;
    const { r, snapshots } = await salvar(ml, { grupoVariacao: ROBALO, base: BASE_ROBALO, ordem: [{ existente: "R2" }, { existente: "R1" }, { existente: "R3" }] },
      { handler: (c) => {
        if (putFeito && c.metodo === "GET") return { ok: false, status: 500, data: { message: "internal" } };
        const x = ml.handler(c);
        if (c.metodo === "PUT") putFeito = true;
        return x;
      } });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.confirmacaoPendente, true);
    assert.strictEqual(r.fotos, null);
    assert.strictEqual(snapshots.length, 0, "sem confirmação, o snapshot não recebe lista adivinhada");
    ok("confirmação indisponível: sucesso honesto com confirmacaoPendente, sem snapshot");
  }

  // 38. Snapshot falha depois do ML confirmar: ok + confirmacaoPendente (nunca erro).
  {
    const ml = mlSimulado();
    const { r } = await salvar(ml, { grupoVariacao: ROBALO, base: BASE_ROBALO, ordem: [{ existente: "R2" }, { existente: "R1" }, { existente: "R3" }] },
      { snapshotFalha: true });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.confirmacaoPendente, true);
    assert.ok(r.fotos, "as fotos confirmadas continuam na resposta");
    ok("falha do snapshot depois da confirmação: sucesso com confirmacaoPendente");
  }

  // 39. Catálogo e User Product com variações: bloqueados antes de qualquer escrita.
  {
    let ml = mlSimulado();
    let { r } = await salvar(ml, { grupoVariacao: ROBALO, base: BASE_ROBALO, ordem: [{ existente: "R1" }] }, { anuncio: { catalog_listing: true } });
    assert.strictEqual(r.codigo, "IMAGENS_BLOQUEADAS_CATALOGO");
    assert.strictEqual(mlChamadas.length, 0);
    const up = itemVar();
    up.user_product_id = "MLBU1";
    ml = mlSimulado({ item: up });
    ({ r } = await salvar(ml, { grupoVariacao: ROBALO, base: BASE_ROBALO, ordem: [{ existente: "R1" }] }));
    assert.strictEqual(r.codigo, "IMAGENS_VARIACOES_USER_PRODUCT");
    assert.ok(semEscrita(ml));
    const cat = itemVar();
    cat.catalog_listing = true;
    ml = mlSimulado({ item: cat });
    ({ r } = await salvar(ml, { grupoVariacao: ROBALO, base: BASE_ROBALO, ordem: [{ existente: "R1" }] }));
    assert.strictEqual(r.codigo, "IMAGENS_BLOQUEADAS_CATALOGO", "catálogo confirmado só ao vivo também bloqueia");
    assert.ok(semEscrita(ml));
    ok("catálogo (local e ao vivo) e User Product com variações: bloqueados");
  }
}

async function run() {
  puras();
  await orquestracao();
  console.log(`\n✓ ${checks} verificações do editor de fotos`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
