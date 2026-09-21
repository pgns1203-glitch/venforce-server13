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
//     que a VIP oficial do ML usa) — nenhuma chamada extra, nenhum POST/PUT
//     (este módulo é só leitura: editar uma variação isolada não tem contrato
//     seguro documentado, ver o comentário do módulo);
//  4. uma recusa do ML vira { ok:false, codigo, motivo } legível, nunca lança.

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
    ok("mapearVariacaoLegado extrai atributos, preço, estoque e vendidos do payload real");
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

  // 5. buscarVariacoesLegado — caminho feliz: GET /items/{id}/variations.
  {
    mlChamadas = [];
    mlHandler = async () => ({
      ok: true, status: 200,
      data: [
        { id: 1, attribute_combinations: [{ name: "Color", value_name: "Preto" }], price: 100, available_quantity: 4, sold_quantity: 0 },
        { id: 2, attribute_combinations: [{ name: "Color", value_name: "Nude" }], price: 100, available_quantity: 6, sold_quantity: 2 },
      ],
    });
    const r = await service.buscarVariacoesLegado({ clienteId: 48, itemId: "MLB2652739620", mlUserId: "649359720" });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.variacoes.length, 2);
    assert.strictEqual(r.variacoes[0].atributos[0].valor, "Preto");
    assert.strictEqual(mlChamadas.length, 1, "tem de ser exatamente 1 chamada ao ML");
    assert.strictEqual(mlChamadas[0].metodo, "GET", "esta leitura nunca escreve");
    assert.strictEqual(mlChamadas[0].path, "/items/MLB2652739620/variations");
    assert.strictEqual(mlChamadas[0].mlUserId, "649359720");
    ok("buscarVariacoesLegado faz GET /items/{id}/variations e mapeia a lista, sem escrita");
  }

  // 6. Recusa do ML vira falha legível, nunca lança.
  {
    mlHandler = async () => ({ ok: false, status: 404, data: { message: "Item not found" } });
    const r = await service.buscarVariacoesLegado({ clienteId: 48, itemId: "MLB-INEXISTENTE", mlUserId: "649359720" });
    assert.strictEqual(r.ok, false);
    assert.ok(r.motivo && r.codigo, "falha precisa vir com motivo e código legíveis");
    ok("buscarVariacoesLegado devolve falha legível quando o ML recusa/erra");
  }

  console.log(`\n${checks} verificações passaram.`);
}

run().catch((e) => { console.error("FALHOU:", e); process.exit(1); });
