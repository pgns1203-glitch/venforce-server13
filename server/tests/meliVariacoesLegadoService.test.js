// server/tests/meliVariacoesLegadoService.test.js
//
// Leitura das VARIAÇÕES do modelo LEGADO do Mercado Livre (item_id ->
// variations[]) — usada para expandir, na própria linha do anúncio, um item
// sem family_id que mesmo assim tem cor/tamanho reais no ML (auditoria
// MLB2652739620, ver server/services/meliAnuncios/meliSyncService.js
// variations_count).
//
// O que este teste protege:
//
//  1. mapearVariacaoLegado() é PURA e fiel ao payload: nome do atributo vem de
//     `name` (cai para `id` só quando `name` falta), valor de `value_name`; um
//     par sem `value_name` não vira "undefined" na tela, só some;
//  2. estoque/preço/vendidos refletem exatamente o que veio — 0 é valor
//     válido, ausência vira null, nunca 0 fabricado;
//  3. buscarVariacoesLegado() chama GET /items/{id}/variations (a MESMA lista
//     que a VIP oficial do ML usa), e um segundo GET /items/{id}?attributes=
//     pictures só para relacionar picture_ids -> pictures[].secure_url —
//     nenhum POST/PUT (este módulo é só leitura: editar uma variação isolada
//     não tem contrato seguro documentado, ver o comentário do módulo);
//  4. uma recusa do ML vira { ok:false, codigo, motivo } legível, nunca lança;
//  5. image_url é resolvida por relação DOCUMENTADA (picture_ids -> pictures
//     por id), nunca inventada: sem match vira o fallback da imagem principal
//     do item, e sem nenhum dos dois vira null — jamais uma URL fabricada;
//  6. falha ao buscar pictures não derruba a leitura das variações (é uma
//     melhoria visual, não um dado crítico).

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const Module = require("module");

let mlChamadas = [];
let mlHandler = null;

const originalLoad = Module._load;
Module._load = function loadWithMlFetchStub(request, parent, isMain) {
  if (request === "../../utils/mlClient" || request === "../utils/mlClient") {
    return {
      async mlFetch(clienteId, path, options = {}) {
        const chamada = { clienteId, path, metodo: options.method || "GET", mlUserId: options.mlUserId };
        mlChamadas.push(chamada);
        return mlHandler ? mlHandler(chamada) : { ok: true, status: 200, data: [] };
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const service = require("../services/meliAnuncios/meliVariacoesLegadoService");

Module._load = originalLoad;

let checks = 0;
function ok(msg) { checks += 1; console.log(`  ✓ ${msg}`); }

async function run() {
  // 1. mapearVariacaoLegado — caso real (MLB2652739620): Cor + Tamanho.
  {
    const bruta = {
      id: 15092589430,
      attribute_combinations: [
        { id: "COLOR", name: "Color", value_id: "52005", value_name: "Preto" },
        { id: "SIZE", name: "Talla (Argentina)", value_id: "9", value_name: "34 BR" },
      ],
      price: 189.9,
      available_quantity: 4,
      sold_quantity: 12,
    };
    const r = service.mapearVariacaoLegado(bruta);
    assert.strictEqual(r.id, 15092589430);
    assert.deepStrictEqual(r.atributos, [
      { nome: "Color", valor: "Preto" },
      { nome: "Talla (Argentina)", valor: "34 BR" },
    ]);
    assert.strictEqual(r.preco, 189.9);
    assert.strictEqual(r.estoque, 4);
    assert.strictEqual(r.vendidos, 12);
    assert.strictEqual(r.image_url, null, "sem imagens passadas, image_url é null — nunca inventado");
    ok("mapearVariacaoLegado extrai atributos, preço, estoque e vendidos do payload real");
  }

  // 1b. image_url — picture_ids da variação tem match em item.pictures: usa a
  // URL correspondente ao PRIMEIRO id de picture_ids (mesma convenção de capa
  // já usada para a família — ordem, não uma flag do ML, que não existe).
  {
    const bruta = {
      id: 1, attribute_combinations: [], price: 100, available_quantity: 4, sold_quantity: 0,
      picture_ids: ["PIC-A", "PIC-B"],
    };
    const imagens = {
      pictureUrlById: { "PIC-A": "https://img/a.jpg", "PIC-B": "https://img/b.jpg" },
      imagemPrincipalItem: "https://img/principal.jpg",
    };
    const r = service.mapearVariacaoLegado(bruta, imagens);
    assert.strictEqual(r.image_url, "https://img/a.jpg", "usa o match do PRIMEIRO picture_id, não o principal do item");
    ok("mapearVariacaoLegado resolve image_url pelo primeiro picture_id com match em item.pictures");
  }

  // 1c. picture_ids presente mas SEM match em item.pictures (anomalia) -> cai
  // pro fallback da imagem principal do item, nunca fica preso a um id que
  // não existe mais.
  {
    const bruta = {
      id: 1, attribute_combinations: [], price: 100, available_quantity: 4, sold_quantity: 0,
      picture_ids: ["PIC-INEXISTENTE"],
    };
    const imagens = { pictureUrlById: { "PIC-A": "https://img/a.jpg" }, imagemPrincipalItem: "https://img/principal.jpg" };
    const r = service.mapearVariacaoLegado(bruta, imagens);
    assert.strictEqual(r.image_url, "https://img/principal.jpg");
    ok("mapearVariacaoLegado cai para a imagem principal do item quando o picture_id da variação não tem match");
  }

  // 1d. picture_ids ausente/vazio -> fallback direto pra imagem principal.
  {
    const semPictureIds = service.mapearVariacaoLegado(
      { id: 1, attribute_combinations: [], price: 100, available_quantity: 4, sold_quantity: 0 },
      { pictureUrlById: {}, imagemPrincipalItem: "https://img/principal.jpg" }
    );
    assert.strictEqual(semPictureIds.image_url, "https://img/principal.jpg");
    const vazio = service.mapearVariacaoLegado(
      { id: 1, attribute_combinations: [], price: 100, available_quantity: 4, sold_quantity: 0, picture_ids: [] },
      { pictureUrlById: {}, imagemPrincipalItem: "https://img/principal.jpg" }
    );
    assert.strictEqual(vazio.image_url, "https://img/principal.jpg");
    ok("mapearVariacaoLegado usa a imagem principal do item quando a variação não tem picture_ids");
  }

  // 1e. Nem picture_ids resolve, nem há imagem principal -> null, nunca
  // fabricado.
  {
    const r = service.mapearVariacaoLegado(
      { id: 1, attribute_combinations: [], price: 100, available_quantity: 4, sold_quantity: 0, picture_ids: ["X"] },
      { pictureUrlById: {}, imagemPrincipalItem: null }
    );
    assert.strictEqual(r.image_url, null);
    ok("mapearVariacaoLegado devolve image_url null quando não há match nem imagem principal");
  }

  // 2. Característica personalizada: sem `id` fixo do catálogo, só name/value_name.
  {
    const r = service.mapearVariacaoLegado({
      id: 1,
      attribute_combinations: [{ name: "Design", value_name: "Coruja" }],
      price: 100, available_quantity: 10, sold_quantity: 0,
    });
    assert.deepStrictEqual(r.atributos, [{ nome: "Design", valor: "Coruja" }]);
    ok("mapearVariacaoLegado cobre característica personalizada (sem id de catálogo)");
  }

  // 3. Estoque ZERO é valor válido, não "ausente".
  {
    const r = service.mapearVariacaoLegado({
      id: 2, attribute_combinations: [], price: 50, available_quantity: 0, sold_quantity: 0,
    });
    assert.strictEqual(r.estoque, 0, "estoque 0 não pode virar null");
    assert.strictEqual(r.vendidos, 0, "vendidos 0 não pode virar null");
    ok("mapearVariacaoLegado trata 0 como valor válido, nunca funde com ausência");
  }

  // 4. Combinação sem value_name (não deveria acontecer, mas o ML é quem
  //    garante isso — o código só não pode inventar um valor) some da lista.
  {
    const r = service.mapearVariacaoLegado({
      id: 3,
      attribute_combinations: [{ id: "COLOR", name: "Color", value_id: "1", value_name: null }],
      price: 10, available_quantity: null, sold_quantity: null,
    });
    assert.deepStrictEqual(r.atributos, []);
    assert.strictEqual(r.estoque, null);
    assert.strictEqual(r.vendidos, null);
    ok("mapearVariacaoLegado nunca inventa valor de atributo ou número ausente");
  }

  // 5. buscarVariacoesLegado — caminho feliz: GET /items/{id}/variations +
  // GET /items/{id}?attributes=pictures (para relacionar picture_ids), e o
  // image_url de cada variação sai desse relacionamento — nada inventado.
  {
    mlChamadas = [];
    mlHandler = async (chamada) => {
      if (chamada.path.endsWith("/variations")) {
        return {
          ok: true, status: 200,
          data: [
            {
              id: 1, attribute_combinations: [{ name: "Color", value_name: "Preto" }],
              price: 100, available_quantity: 4, sold_quantity: 0, picture_ids: ["PIC-PRETO"],
            },
            {
              id: 2, attribute_combinations: [{ name: "Color", value_name: "Nude" }],
              price: 100, available_quantity: 6, sold_quantity: 2, picture_ids: [],
            },
          ],
        };
      }
      return {
        ok: true, status: 200,
        data: {
          pictures: [
            { id: "PIC-CAPA", secure_url: "https://img/capa.jpg" },
            { id: "PIC-PRETO", secure_url: "https://img/preto.jpg" },
          ],
        },
      };
    };
    const r = await service.buscarVariacoesLegado({ clienteId: 48, itemId: "MLB2652739620", mlUserId: "649359720" });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.variacoes.length, 2);
    assert.strictEqual(r.variacoes[0].atributos[0].valor, "Preto");
    assert.strictEqual(r.variacoes[0].image_url, "https://img/preto.jpg", "variação com picture_ids próprio usa o match");
    assert.strictEqual(r.variacoes[1].image_url, "https://img/capa.jpg", "variação sem picture_ids usa a imagem principal (primeira do item)");

    assert.strictEqual(mlChamadas.length, 2, "2 chamadas: variations + item (pictures)");
    assert.strictEqual(mlChamadas[0].metodo, "GET", "esta leitura nunca escreve");
    assert.strictEqual(mlChamadas[0].path, "/items/MLB2652739620/variations");
    assert.strictEqual(mlChamadas[1].path, "/items/MLB2652739620?attributes=pictures");
    assert.ok(mlChamadas.every((c) => c.mlUserId === "649359720"), "as duas chamadas usam o mesmo mlUserId, sem fallback de conta");
    ok("buscarVariacoesLegado faz GET /variations + GET /items?attributes=pictures e resolve image_url por relação real, sem escrita");
  }

  // 5b. Falha ao buscar as imagens do item (GET pictures recusado) NÃO derruba
  // a leitura das variações — é degradação (image_url null em todas), nunca
  // bloqueio, porque imagem é melhoria visual, não dado crítico.
  {
    mlChamadas = [];
    mlHandler = async (chamada) => {
      if (chamada.path.endsWith("/variations")) {
        return {
          ok: true, status: 200,
          data: [{ id: 1, attribute_combinations: [], price: 100, available_quantity: 4, sold_quantity: 0, picture_ids: ["PIC-1"] }],
        };
      }
      return { ok: false, status: 500, data: { message: "erro interno" } };
    };
    const r = await service.buscarVariacoesLegado({ clienteId: 48, itemId: "MLB1", mlUserId: "1" });
    assert.strictEqual(r.ok, true, "GET de pictures falhando não pode derrubar a leitura das variações");
    assert.strictEqual(r.variacoes[0].image_url, null, "sem pictures resolvidas, image_url degrada pra null, nunca quebra");
    ok("buscarVariacoesLegado: falha ao buscar pictures do item degrada para image_url null, sem bloquear a leitura");
  }

  // 6. Recusa do ML na leitura das variações vira falha legível, nunca lança,
  // e nem chega a buscar as imagens (a leitura principal já falhou).
  {
    mlChamadas = [];
    mlHandler = async () => ({ ok: false, status: 404, data: { message: "Item not found" } });
    const r = await service.buscarVariacoesLegado({ clienteId: 48, itemId: "MLB-INEXISTENTE", mlUserId: "649359720" });
    assert.strictEqual(r.ok, false);
    assert.ok(r.motivo && r.codigo, "falha precisa vir com motivo e código legíveis");
    assert.strictEqual(mlChamadas.length, 1, "variations falhando não deve tentar buscar pictures");
    ok("buscarVariacoesLegado devolve falha legível quando o ML recusa/erra a leitura de variations, sem chamada extra");
  }

  console.log(`\n${checks} verificações passaram.`);
}

run().catch((e) => { console.error("FALHOU:", e); process.exit(1); });
