// server/tests/meliAnunciosFotos.test.js
//
// Editor de fotos por grupo de variação (GET/PUT /anuncios-meli/:itemId/fotos).
// Parte 1: funções puras de meliFotosService. Parte 2 (etapa 2 do plano):
// orquestração contra um ML simulado com estado.
//
// Spec: docs/superpowers/specs/2026-09-30-fotos-por-variacao-design.md

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const fotos = require("../services/meliAnuncios/meliFotosService");

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

function run() {
  puras();
  console.log(`\n✓ ${checks} verificações do editor de fotos`);
}

try {
  run();
} catch (err) {
  console.error(err);
  process.exit(1);
}
