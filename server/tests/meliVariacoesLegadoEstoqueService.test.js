// server/tests/meliVariacoesLegadoEstoqueService.test.js
//
// Edição de ESTOQUE de uma VARIAÇÃO do modelo LEGADO (item_id -> variations[]).
//
// Não existe PUT dedicado a uma variação isolada — só PUT /items/{id} com a
// propriedade `variations` inteira, e o ML apaga qualquer variação omitida
// desse array (documentacao_api_meli/variacoes.md, "Remover variações" e
// "Modificar estoque"). O que este teste protege é exatamente o desenho de
// segurança que evita essa perda:
//
//  1. a fonte autoritativa é SEMPRE um GET fresco, nunca a tela/cache;
//  2. o PUT reenvia TODOS os ids retornados pelo GET fresco imediatamente
//     anterior, mudando `available_quantity` só do alvo;
//  3. depois do PUT, um NOVO GET confirma o estado — sucesso só é reportado
//     se a variação alvo ainda existe, o valor bate e a contagem não caiu;
//  4. contagem menor depois do que antes é falha CRÍTICA (perda de variação):
//     nunca sucesso, nunca retry automático;
//  5. contexto incompatível com edição manual (User Product migrado, Full,
//     variação sem id, variação gerenciada externamente) bloqueia ANTES de
//     qualquer PUT — fail closed;
//  6. erro HTTP no PUT não atualiza nada local (o service nem toca DB).

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
        const chamada = {
          clienteId,
          path,
          metodo: options.method || "GET",
          mlUserId: options.mlUserId,
          body: options.body ? JSON.parse(options.body) : null,
        };
        mlChamadas.push(chamada);
        return mlHandler ? mlHandler(chamada) : { ok: true, status: 200, data: {} };
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const service = require("../services/meliAnuncios/meliVariacoesLegadoEstoqueService");

Module._load = originalLoad;

let checks = 0;
function ok(msg) { checks += 1; console.log(`  ✓ ${msg}`); }

// Fixture-padrão: item legado (sem user_product_id, sem Full), 3 variações.
const ITEM_LEGADO = { id: "MLB1", user_product_id: null, shipping: { logistic_type: "me2" } };
function variacoesFixture() {
  return [
    { id: 1, available_quantity: 4, attribute_combinations: [] },
    { id: 2, available_quantity: 6, attribute_combinations: [] },
    { id: 3, available_quantity: 9, attribute_combinations: [] },
  ];
}

// Handler padrão: sequência feliz completa (GET item, GET variations "antes",
// PUT, GET variations "depois" já refletindo a alteração no alvo).
function handlerFeliz({ alvoId, novaQtd, item = ITEM_LEGADO, variacoesAntes = variacoesFixture() } = {}) {
  let getVariationsChamadas = 0;
  return (chamada) => {
    if (chamada.metodo === "GET" && !chamada.path.endsWith("/variations")) {
      return { ok: true, status: 200, data: item };
    }
    if (chamada.metodo === "GET" && chamada.path.endsWith("/variations")) {
      getVariationsChamadas += 1;
      if (getVariationsChamadas === 1) {
        return { ok: true, status: 200, data: variacoesAntes };
      }
      const depois = variacoesAntes.map((v) =>
        v.id === alvoId ? { ...v, available_quantity: novaQtd } : v
      );
      return { ok: true, status: 200, data: depois };
    }
    if (chamada.metodo === "PUT") {
      return { ok: true, status: 200, data: {} };
    }
    return { ok: true, status: 200, data: {} };
  };
}

async function run() {
  // 1. GET fresco sempre acontece ANTES do PUT (item + variations), e uma
  //    segunda leitura de confirmação acontece DEPOIS do PUT.
  {
    mlChamadas = [];
    mlHandler = handlerFeliz({ alvoId: 2, novaQtd: 15 });
    const r = await service.atualizarEstoqueVariacaoLegado({
      clienteId: 1, itemId: "MLB1", variationId: 2, estoque: 15, mlUserId: "111",
    });
    assert.strictEqual(r.ok, true, JSON.stringify(r));

    const metodos = mlChamadas.map((c) => `${c.metodo} ${c.path}`);
    assert.deepStrictEqual(metodos, [
      "GET /items/MLB1",
      "GET /items/MLB1/variations",
      "PUT /items/MLB1",
      "GET /items/MLB1/variations",
    ], "ordem exata: GET item, GET variations (antes), PUT, GET variations (confirmação)");
    ok("GET fresco (item + variations) acontece antes do PUT, e um novo GET confirma depois");
  }

  // 2 e 3. O payload do PUT contém TODOS os ids atuais, e só o alvo muda.
  {
    mlChamadas = [];
    mlHandler = handlerFeliz({ alvoId: 2, novaQtd: 15 });
    await service.atualizarEstoqueVariacaoLegado({
      clienteId: 1, itemId: "MLB1", variationId: 2, estoque: 15, mlUserId: "111",
    });
    const put = mlChamadas.find((c) => c.metodo === "PUT");
    assert.deepStrictEqual(
      put.body,
      { variations: [
        { id: 1, available_quantity: 4 },
        { id: 2, available_quantity: 15 },
        { id: 3, available_quantity: 9 },
      ] },
      "o PUT precisa reenviar todos os ids, mudando só available_quantity do alvo"
    );
    ok("payload do PUT: todos os ids presentes, available_quantity do alvo alterado");
  }

  // 4. As demais quantities são preservadas exatamente como vieram do GET.
  {
    mlChamadas = [];
    mlHandler = handlerFeliz({ alvoId: 1, novaQtd: 0 });
    await service.atualizarEstoqueVariacaoLegado({
      clienteId: 1, itemId: "MLB1", variationId: 1, estoque: 0, mlUserId: "111",
    });
    const put = mlChamadas.find((c) => c.metodo === "PUT");
    const outros = put.body.variations.filter((v) => v.id !== 1);
    assert.deepStrictEqual(outros, [
      { id: 2, available_quantity: 6 },
      { id: 3, available_quantity: 9 },
    ]);
    ok("as demais variações preservam exatamente o available_quantity lido no GET fresco");
  }

  // 5. Variação alvo inexistente no GET fresco → nenhum PUT.
  {
    mlChamadas = [];
    mlHandler = handlerFeliz({ alvoId: 999, novaQtd: 1 });
    const r = await service.atualizarEstoqueVariacaoLegado({
      clienteId: 1, itemId: "MLB1", variationId: 999, estoque: 1, mlUserId: "111",
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.codigo, "VARIACAO_INEXISTENTE");
    assert.ok(!mlChamadas.some((c) => c.metodo === "PUT"), "variação alvo inexistente não pode gerar PUT");
    ok("variação alvo não encontrada no GET fresco: bloqueia, nenhum PUT");
  }

  // 6. Variação sem id no GET fresco → nenhum PUT (proteção contra recriação
  //    silenciosa: reenviar sem id apaga e recria a variação, perdendo histórico).
  {
    mlChamadas = [];
    mlHandler = (chamada) => {
      if (chamada.metodo === "GET" && !chamada.path.endsWith("/variations")) {
        return { ok: true, status: 200, data: ITEM_LEGADO };
      }
      if (chamada.metodo === "GET") {
        return { ok: true, status: 200, data: [{ id: 1, available_quantity: 4 }, { available_quantity: 6 }] };
      }
      return { ok: true, status: 200, data: {} };
    };
    const r = await service.atualizarEstoqueVariacaoLegado({
      clienteId: 1, itemId: "MLB1", variationId: 1, estoque: 5, mlUserId: "111",
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.codigo, "VARIACAO_SEM_ID");
    assert.ok(!mlChamadas.some((c) => c.metodo === "PUT"), "variação sem id no array não pode gerar PUT");
    ok("variação sem id no GET fresco: bloqueia antes de montar o PUT, nenhum PUT");
  }

  // 7. Item já migrado ao User Product → bloqueia, nenhuma chamada de variations/PUT.
  {
    mlChamadas = [];
    mlHandler = (chamada) => {
      if (chamada.metodo === "GET" && !chamada.path.endsWith("/variations")) {
        return { ok: true, status: 200, data: { id: "MLB1", user_product_id: "MLBU-9", shipping: { logistic_type: "me2" } } };
      }
      return { ok: true, status: 200, data: [] };
    };
    const r = await service.atualizarEstoqueVariacaoLegado({
      clienteId: 1, itemId: "MLB1", variationId: 1, estoque: 5, mlUserId: "111",
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.codigo, "USER_PRODUCT_MIGRADO");
    assert.strictEqual(mlChamadas.length, 1, "bloqueia logo após o GET do item — nem variations, nem PUT");
    ok("item com user_product_id (já migrado): bloqueia antes de ler variations");
  }

  // 8a. Full (logistic_type fulfillment) → bloqueia.
  {
    mlChamadas = [];
    mlHandler = (chamada) => {
      if (chamada.metodo === "GET" && !chamada.path.endsWith("/variations")) {
        return { ok: true, status: 200, data: { id: "MLB1", user_product_id: null, shipping: { logistic_type: "fulfillment" } } };
      }
      return { ok: true, status: 200, data: [] };
    };
    const r = await service.atualizarEstoqueVariacaoLegado({
      clienteId: 1, itemId: "MLB1", variationId: 1, estoque: 5, mlUserId: "111",
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.codigo, "FULL_INCOMPATIVEL");
    assert.ok(!mlChamadas.some((c) => c.metodo === "PUT"));
    ok("item com logistic_type fulfillment (Full): bloqueia, nenhum PUT");
  }

  // 8b. Variação com inventory_id (gerenciada externamente) → bloqueia.
  {
    mlChamadas = [];
    mlHandler = (chamada) => {
      if (chamada.metodo === "GET" && !chamada.path.endsWith("/variations")) {
        return { ok: true, status: 200, data: ITEM_LEGADO };
      }
      if (chamada.metodo === "GET") {
        return { ok: true, status: 200, data: [{ id: 1, available_quantity: 4, inventory_id: "INV-1" }] };
      }
      return { ok: true, status: 200, data: {} };
    };
    const r = await service.atualizarEstoqueVariacaoLegado({
      clienteId: 1, itemId: "MLB1", variationId: 1, estoque: 5, mlUserId: "111",
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.codigo, "VARIACAO_GERENCIADA_EXTERNAMENTE");
    assert.ok(!mlChamadas.some((c) => c.metodo === "PUT"));
    ok("variação alvo com inventory_id: bloqueia, nenhum PUT");
  }

  // 9. Erro HTTP no PUT → nenhum estado local é atualizado (o service não
  //    mexe em banco; a garantia aqui é que a falha vem legível e sem
  //    inventar sucesso).
  {
    mlChamadas = [];
    mlHandler = (chamada) => {
      if (chamada.metodo === "GET" && !chamada.path.endsWith("/variations")) {
        return { ok: true, status: 200, data: ITEM_LEGADO };
      }
      if (chamada.metodo === "GET") {
        return { ok: true, status: 200, data: variacoesFixture() };
      }
      if (chamada.metodo === "PUT") {
        return { ok: false, status: 400, data: { message: "Validation error", cause: [{ code: "item.invalid", message: "Recusado." }] } };
      }
      return { ok: true, status: 200, data: {} };
    };
    const r = await service.atualizarEstoqueVariacaoLegado({
      clienteId: 1, itemId: "MLB1", variationId: 1, estoque: 5, mlUserId: "111",
    });
    assert.strictEqual(r.ok, false);
    assert.ok(r.codigo && r.motivo);
    assert.strictEqual(
      mlChamadas.filter((c) => c.metodo === "GET" && c.path.endsWith("/variations")).length,
      1,
      "PUT recusado não pode disparar a leitura de confirmação"
    );
    ok("erro HTTP no PUT: falha legível, nenhuma leitura de confirmação disparada");
  }

  // 10. GET de confirmação (pós-PUT) confirma o novo estoque no caminho feliz.
  {
    mlChamadas = [];
    mlHandler = handlerFeliz({ alvoId: 3, novaQtd: 40 });
    const r = await service.atualizarEstoqueVariacaoLegado({
      clienteId: 1, itemId: "MLB1", variationId: 3, estoque: 40, mlUserId: "111",
    });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    const alvo = r.variacoes.find((v) => v.id === 3);
    assert.strictEqual(alvo.estoque, 40, "o valor devolvido vem da leitura de confirmação, não do valor enviado");
    ok("sucesso devolve as variações frescas da leitura de confirmação, com o novo estoque");
  }

  // 11. N_depois < N_antes → falha crítica (perda de variação): nunca sucesso.
  {
    mlChamadas = [];
    let gets = 0;
    mlHandler = (chamada) => {
      if (chamada.metodo === "GET" && !chamada.path.endsWith("/variations")) {
        return { ok: true, status: 200, data: ITEM_LEGADO };
      }
      if (chamada.metodo === "GET") {
        gets += 1;
        return gets === 1
          ? { ok: true, status: 200, data: variacoesFixture() } // 3 variações
          : { ok: true, status: 200, data: [{ id: 1, available_quantity: 4 }] }; // sobrou 1
      }
      return { ok: true, status: 200, data: {} };
    };
    const r = await service.atualizarEstoqueVariacaoLegado({
      clienteId: 1, itemId: "MLB1", variationId: 1, estoque: 4, mlUserId: "111",
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.codigo, "PERDA_DE_VARIACAO");
    assert.strictEqual(r.critico, true);
    ok("contagem menor depois do PUT do que antes: falha CRÍTICA, nunca sucesso");
  }

  // 12. Cache/tela desatualizada NÃO bloqueia: o `estoque` atual de partida é
  //     sempre lido do GET fresco (a "tela" nem participa deste service —
  //     ela só manda variationId + nova quantidade; qualquer contagem antiga
  //     que a tela tivesse é irrelevante aqui).
  {
    mlChamadas = [];
    // GET fresco traz 4 variações (uma a mais do que qualquer suposição da
    // tela) — isso não é bloqueio, é o comportamento correto.
    const quatro = [...variacoesFixture(), { id: 4, available_quantity: 1, attribute_combinations: [] }];
    mlHandler = handlerFeliz({ alvoId: 4, novaQtd: 50, variacoesAntes: quatro });
    const r = await service.atualizarEstoqueVariacaoLegado({
      clienteId: 1, itemId: "MLB1", variationId: 4, estoque: 50, mlUserId: "111",
    });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    const put = mlChamadas.find((c) => c.metodo === "PUT");
    assert.strictEqual(put.body.variations.length, 4, "usa as 4 variações atuais do GET fresco, não uma contagem antiga");
    ok("GET fresco com mais variações do que se esperava: usa o estado atual, não bloqueia");
  }

  // 13. mlUserId é repassado tal como resolvido pelo chamador (a escolha da
  //     conta correta entre duas contas é responsabilidade do controller,
  //     como no resto do módulo — ver meliAnunciosVariacoesLegadoEstoqueRota).
  {
    mlChamadas = [];
    mlHandler = handlerFeliz({ alvoId: 1, novaQtd: 8 });
    await service.atualizarEstoqueVariacaoLegado({
      clienteId: 1, itemId: "MLB1", variationId: 1, estoque: 8, mlUserId: "222",
    });
    assert.ok(mlChamadas.every((c) => c.mlUserId === "222"), "toda chamada ao ML usa o mlUserId recebido, sem trocar/adivinhar conta");
    ok("mlUserId recebido é usado em TODAS as chamadas ao Mercado Livre, sem fallback de conta");
  }

  // 14. Validação local (variação ausente / estoque inválido) não gasta
  //     nenhuma chamada ao Mercado Livre.
  {
    mlChamadas = [];
    const r1 = await service.atualizarEstoqueVariacaoLegado({
      clienteId: 1, itemId: "MLB1", variationId: null, estoque: 5, mlUserId: "111",
    });
    assert.strictEqual(r1.ok, false);
    assert.strictEqual(r1.codigo, "VARIACAO_ID_AUSENTE");

    const r2 = await service.atualizarEstoqueVariacaoLegado({
      clienteId: 1, itemId: "MLB1", variationId: 1, estoque: "-3", mlUserId: "111",
    });
    assert.strictEqual(r2.ok, false);
    assert.strictEqual(r2.codigo, "ESTOQUE_INVALIDO");

    assert.strictEqual(mlChamadas.length, 0, "validação local não pode chamar o Mercado Livre");
    ok("variação ausente e estoque inválido: 0 chamadas ao Mercado Livre");
  }

  // 15. GET fresco (item ou variations) falhando → fail closed, nenhum PUT.
  {
    mlChamadas = [];
    mlHandler = (chamada) => {
      if (chamada.metodo === "GET" && !chamada.path.endsWith("/variations")) {
        return { ok: false, status: 404, data: { message: "not found" } };
      }
      return { ok: true, status: 200, data: {} };
    };
    const r = await service.atualizarEstoqueVariacaoLegado({
      clienteId: 1, itemId: "MLB-SOME", variationId: 1, estoque: 5, mlUserId: "111",
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.codigo, "ITEM_NAO_ENCONTRADO");
    assert.ok(!mlChamadas.some((c) => c.metodo === "PUT"));
    ok("GET fresco do item falhando (404): fail closed, nenhum PUT");
  }

  console.log(`\n${checks} verificações passaram.`);
}

run().catch((e) => { console.error("FALHOU:", e); process.exit(1); });
