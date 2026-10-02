// server/tests/termosComplementaresEngine.test.js
//
// Termos Complementares (server/services/meliAnuncios/seo/termosComplementaresEngine.js)
// — 100% puro: candidatos, score, complementaridade, seleção. Nenhuma IA,
// nenhum Mercado Livre, nenhum banco.
//
// O que este teste protege:
//   - só sai termo que o TÍTULO DE REFERÊNCIA ainda não cobre — nem literal,
//     nem plural, nem gênero morfológico, nem o mesmo conceito estruturado
//     (GENDER);
//   - a seleção não completa a lista: limiar e máximo de termos;
//   - a análise não tem vínculo com o MODEL: nada de modelo/chars/limite na
//     resposta, e catálogo/família/vínculo de produto não mudam o resultado;
//   - logística/identificadores/MODEL legado não viram termo;
//   - mesma entrada, mesma saída.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const engine = require("../services/meliAnuncios/seo/termosComplementaresEngine");
const seo = require("../services/meliAnuncios/seo/seoText");

let falhas = 0;
let total = 0;
async function check(nome, fn) {
  total += 1;
  try { await fn(); console.log("  ✓ " + nome); }
  catch (e) { falhas += 1; console.error("  ✗ " + nome + "\n    " + (e.stack || e.message)); }
}

const ATRIBUTOS = [
  { id: "BRAND", name: "Marca", value: "Molekinho" },
  { id: "MODEL", name: "Modelo", value: "tenis casual conforto escolar" }, // lixo legado
  { id: "GENDER", name: "Gênero", value: "Meninos" },
  { id: "CLOSURE_TYPE", name: "Tipo de fechamento", value: "Cadarço" },
  { id: "COLOR", name: "Cor", value: "Azul Marinho" },
  { id: "MAIN_MATERIAL", name: "Material principal", value: "Sintético" },
  { id: "WITH_LIGHTS", name: "Com luzes", value: "Sim" },
  { id: "IS_WATERPROOF", name: "É impermeável", value: "Não" },
  { id: "UNITS_PER_PACK", name: "Unidades por embalagem", value: "1" },
  { id: "SELLER_SKU", name: "SKU", value: "MK-2231" },
  { id: "PACKAGE_WEIGHT", name: "Peso da embalagem", value: "500 g" },
  { id: "SHIPMENT_PACKING", name: "Embalagem de envio", value: "Caixa" },
  { id: "WARRANTY_TYPE", name: "Tipo de garantia", value: "Garantia do vendedor" },
  { id: "GTIN", name: "Código universal", value: "7891234567895" },
];

function anuncio(over = {}) {
  return {
    item_id: "MLB1",
    titulo: "Tênis Molekinho Antigo",
    category_id: "MLB23332",
    catalog_listing: false,
    catalog_product_id: null,
    family_name: null,
    user_product_id: "MLBU123",
    attributes_json: ATRIBUTOS,
    ...over,
  };
}

function gerar({ titulo = "Tênis Infantil Molekinho", attrs, categoriaNome = "Tênis", over } = {}) {
  const a = anuncio(attrs ? { attributes_json: attrs, ...(over || {}) } : over || {});
  return engine.gerarTermosComplementares({ anuncio: a, tituloReferencia: titulo, categoriaNome });
}
const termos = (r) => (r.termos || []).map((t) => t.termo);
const excluido = (r, termo) => (r.excluidos || []).find((e) => e.termo === termo);

(async () => {
  // ── 1–4. complementaridade com o título ──────────────────────────────────
  await check("1 — termo igual a uma palavra do título → excluído COBERTO_PELO_TITULO", () => {
    const r = gerar({ titulo: "Tênis Infantil Molekinho Cadarço" });
    assert.ok(!termos(r).includes("cadarço"), termos(r).join("|"));
    assert.strictEqual(excluido(r, "cadarço").motivo, "COBERTO_PELO_TITULO");
  });

  await check("2 — plural equivalente (título 'Cadarços') → excluído", () => {
    const r = gerar({ titulo: "Tênis Infantil Molekinho Cadarços" });
    assert.ok(!termos(r).includes("cadarço"));
    assert.strictEqual(excluido(r, "cadarço").motivo, "COBERTO_PELO_TITULO");
  });

  await check("3 — gênero morfológico equivalente (título 'Preta', atributo 'Preto') → excluído", () => {
    const attrs = [{ id: "BRAND", name: "Marca", value: "Molekinho" }, { id: "COLOR", name: "Cor", value: "Preto" },
      { id: "MAIN_MATERIAL", name: "Material", value: "Couro" }];
    const r = gerar({ titulo: "Bolsa Preta Molekinho", attrs, categoriaNome: "Bolsas" });
    assert.ok(!termos(r).includes("preto"));
    assert.strictEqual(excluido(r, "preto").motivo, "COBERTO_PELO_TITULO");
    assert.deepStrictEqual(termos(r), ["couro"]);
  });

  await check("4 — conceito estruturado (GENDER=Meninos): título 'Menino' cobre 'masculino'; título 'Masculino' cobre 'meninos'", () => {
    const r = gerar({ titulo: "Tênis Menino Molekinho" });
    assert.ok(!termos(r).includes("masculino") && !termos(r).includes("meninos"), termos(r).join("|"));
    assert.strictEqual(excluido(r, "masculino").motivo, "COBERTO_PELO_TITULO");
    const r2 = gerar({ titulo: "Tênis Infantil Masculino Molekinho" });
    assert.ok(!termos(r2).includes("meninos") && !termos(r2).includes("masculino"));
    assert.strictEqual(excluido(r2, "meninos").motivo, "COBERTO_PELO_TITULO");
  });

  await check("'Tênis Infantil Masculino': masculino/masculina/menino, nenhum entra", () => {
    const attrs = [{ id: "GENDER", name: "Gênero", value: "Meninos" }, { id: "STYLE", name: "Estilo", value: "Masculina" },
      { id: "MAIN_MATERIAL", name: "Material", value: "Lona" }];
    const r = gerar({ titulo: "Tênis Infantil Masculino", attrs });
    assert.deepStrictEqual(termos(r), ["lona"]);
  });

  await check("GENDER sem cobertura no título entra UMA vez (o próprio valor vence o equivalente)", () => {
    const r = gerar({ titulo: "Tênis Infantil Molekinho" });
    const genero = r.termos.filter((t) => t.attributeId === "GENDER");
    assert.strictEqual(genero.length, 1);
    assert.strictEqual(genero[0].termo, "meninos");
    assert.strictEqual(excluido(r, "masculino").motivo, "DUPLICADO");
  });

  await check("sem semântica geral: 'Infantil' no título NÃO cobre 'meninos' (nem idade é inferida)", () => {
    const r = gerar({ titulo: "Tênis Infantil Criança Molekinho" });
    assert.ok(termos(r).includes("meninos"));
  });

  // ── 5–8. força, limiar, duplicados, composto ─────────────────────────────
  await check("5 — termo novo e forte é selecionado (MAIN_MATERIAL: 40+30+20+10 = 100)", () => {
    const r = gerar();
    const t = r.termos.find((x) => x.termo === "sintético");
    assert.ok(t, termos(r).join("|"));
    assert.deepStrictEqual([t.baseScore, t.score, t.complementaridade], [100, 100, 1]);
    assert.deepStrictEqual(t.breakdown, { evidencia: 40, relevancia: 30, especificidade: 20, compactacao: 10 });
    assert.deepStrictEqual([t.fonte, t.attributeId], ["atributo", "MAIN_MATERIAL"]);
    assert.ok(r.termos.slice(0, 2).some((x) => x.termo === "sintético"), "entre os de maior TERM_SCORE");
  });

  await check("6 — termo fraco abaixo do limiar não entra (83 × 2/3 = 55 < 60)", () => {
    const attrs = [{ id: "RECOMMENDED_USES", name: "Usos", value: "Uso no dia a dia em casa" },
      { id: "MAIN_MATERIAL", name: "Material", value: "Algodão" }];
    const r = gerar({ titulo: "Chinelo de Casa", attrs, categoriaNome: "Chinelos" });
    assert.strictEqual(excluido(r, "uso no dia a dia em casa").motivo, "ABAIXO_DO_LIMIAR");
    assert.ok(termos(r).includes("algodão"));
    assert.strictEqual(engine.LIMIAR_TERM_SCORE, 60);
  });

  await check("7 — duplicados (COLOR e MAIN_COLOR = Azul) viram um só termo", () => {
    const attrs = [{ id: "COLOR", name: "Cor", value: "Azul" }, { id: "MAIN_COLOR", name: "Cor principal", value: "azul" },
      { id: "MAIN_MATERIAL", name: "Material", value: "Couro" }];
    const r = gerar({ titulo: "Bolsa Feminina", attrs, categoriaNome: "Bolsas" });
    assert.strictEqual(termos(r).filter((t) => t === "azul").length, 1);
    assert.strictEqual(excluido(r, "azul").motivo, "DUPLICADO");
  });

  await check("7b — redundância entre selecionados: 'azul marinho' escolhido torna 'azul' redundante", () => {
    const attrs = [{ id: "COLOR", name: "Cor", value: "Azul Marinho" }, { id: "MAIN_COLOR", name: "Cor principal", value: "Azul" }];
    const r = gerar({ titulo: "Bolsa Feminina", attrs, categoriaNome: "Bolsas" });
    assert.deepStrictEqual(termos(r), ["azul", "azul marinho"].filter((t) => termos(r).includes(t)));
    assert.strictEqual(termos(r).length, 1, termos(r).join("|"));
  });

  await check("8 — termo composto parcialmente coberto: score proporcional ('Tênis Cadarço' × 'Tênis Infantil' = 0,5)", () => {
    const attrs = [{ id: "CLOSURE_TYPE", name: "Fechamento", value: "Tênis Cadarço" }];
    const { candidatos } = engine.montarCandidatos(anuncio({ attributes_json: attrs }), {});
    const c = candidatos.find((x) => x.termo === "tênis cadarço");
    const comp = engine.complementaridade(c, seo.titleKeySet("Tênis Infantil"), new Set());
    assert.strictEqual(comp, 0.5);
    assert.strictEqual(Math.round(c.baseScore * comp), 45);
    const r = gerar({ titulo: "Tênis Infantil", attrs, categoriaNome: null });
    assert.strictEqual(excluido(r, "tênis cadarço").motivo, "ABAIXO_DO_LIMIAR");
  });

  // ── 9–10. nada a complementar, máximo de termos ──────────────────────────
  await check("9 — título que já cobre tudo → ok:true com lista vazia (análise, não erro); nunca repete o título", () => {
    const attrs = [{ id: "BRAND", name: "Marca", value: "Molekinho" }, { id: "COLOR", name: "Cor", value: "Azul" }];
    const r = gerar({ titulo: "Tênis Azul Molekinho", attrs });
    assert.deepStrictEqual([r.ok, r.termos], [true, []]);
    assert.ok(r.excluidos.length > 0, "os excluídos explicam o porquê");
    const normal = gerar();
    const chavesTitulo = seo.titleKeySet("Tênis Infantil Molekinho");
    for (const t of normal.termos) {
      assert.strictEqual(seo.termCoverage(t.termo, chavesTitulo).coveredTokens, 0, t.termo);
    }
  });

  await check("10 — máximo de termos (8) e ordem por TERM_SCORE", () => {
    const attrs = Array.from({ length: 12 }, (_, i) => ({ id: "ATTR_" + i, name: "Atributo " + i, value: "Palavra" + String.fromCharCode(97 + i) }));
    const r = gerar({ titulo: "Produto", attrs, categoriaNome: null });
    assert.strictEqual(r.termos.length, engine.MAX_TERMOS);
    assert.strictEqual(r.excluidos.filter((e) => e.motivo === "LIMITE_DE_TERMOS").length, 4);
    const scores = r.termos.map((t) => t.score);
    assert.deepStrictEqual(scores, scores.slice().sort((a, b) => b - a));
  });

  // ── 11–12. sem vínculo com o MODEL ───────────────────────────────────────
  await check("11 — contrato da análise: lista de termos; nada de modelo/chars/limite/podeEditarModel", () => {
    const r = gerar();
    assert.deepStrictEqual(Object.keys(r).sort(), ["excluidos", "ok", "termos"]);
    const chavesTermo = Object.keys(r.termos[0]).sort();
    assert.deepStrictEqual(chavesTermo,
      ["attributeId", "baseScore", "breakdown", "complementaridade", "conceptId", "fonte", "score", "termo"]);
    assert.ok(!("gerarModelo" in engine) && !("podeUsarModeloIndexador" in engine), "nenhuma API de MODEL no engine");
  });

  await check("12 — catálogo, família e vínculo de produto NÃO mudam a análise (ela não escreve nada)", () => {
    const base = gerar();
    for (const over of [{ catalog_listing: true }, { catalog_product_id: "MLB19876543" },
      { family_name: "Tênis Molekinho" }, { user_product_id: null }]) {
      assert.deepStrictEqual(gerar({ over }), base, JSON.stringify(over));
    }
  });

  // ── 13. fontes ───────────────────────────────────────────────────────────
  await check("13 — logística, identificadores, garantia, quantidade e MODEL legado nunca viram termo", () => {
    const r = gerar();
    const todos = termos(r).concat(r.excluidos.map((e) => e.termo)).join(" | ");
    for (const proibido of ["mk-2231", "500 g", "caixa", "garantia", "7891234567895", "conforto", "escolar"]) {
      assert.ok(!todos.includes(proibido), proibido + " em " + todos);
    }
    assert.ok(!termos(r).includes("1"));
  });

  await check("fontes: marca/categoria/atributo/booleano 'Sim'; booleano 'Não' nunca aparece", () => {
    const r = gerar({ titulo: "Calçado Infantil" });
    const fontes = new Set(r.termos.map((t) => t.fonte));
    assert.ok(fontes.has("marca") && fontes.has("categoria") && fontes.has("atributo"), [...fontes].join());
    assert.ok(termos(r).includes("Molekinho"), "marca preserva a grafia");
    assert.ok(termos(r).includes("luzes"), "'Com luzes: Sim' → 'luzes'");
    assert.ok(!termos(r).join(" ").toLowerCase().includes("imperme"), "'É impermeável: Não' nunca vira termo");
  });

  await check("valores: código e número puro ficam fora; medida com unidade entra; valor genérico sai", () => {
    const attrs = [
      { id: "LINE", name: "Linha", value: "XJ221B9" },
      { id: "VOLTAGE", name: "Voltagem", value: "110V/220V" },
      { id: "POWER", name: "Potência", value: "1200" },
      { id: "STYLE", name: "Estilo", value: "Outro" },
      { id: "COLOR", name: "Cor", value: "Preto, Vermelho" },
    ];
    const r = gerar({ titulo: "Secador de Cabelo", attrs, categoriaNome: "Secadores" });
    assert.strictEqual(excluido(r, "xj221b9").motivo, "VALOR_NAO_DESCRITIVO");
    assert.strictEqual(excluido(r, "1200").motivo, "VALOR_NAO_DESCRITIVO");
    assert.strictEqual(excluido(r, "outro").motivo, "TERMO_GENERICO");
    assert.ok(termos(r).includes("110v/220v"));
    assert.ok(termos(r).includes("preto") && termos(r).includes("vermelho"), "multivalor vira um termo por valor");
  });

  await check("conflito: termo que contradiz GENDER ou booleano 'Não' não entra (mais estrito que o F3: o engine origina o termo)", () => {
    const attrs = [{ id: "GENDER", name: "Gênero", value: "Meninos" }, { id: "STYLE", name: "Estilo", value: "Feminino" },
      { id: "MAIN_MATERIAL", name: "Material", value: "Lona" }];
    const r = gerar({ titulo: "Tênis Infantil", attrs });
    assert.strictEqual(excluido(r, "feminino").motivo, "CONFLITO_ATRIBUTO");
    assert.ok(termos(r).includes("meninos") && termos(r).includes("lona"));
    const attrs2 = [{ id: "IS_WATERPROOF", name: "É impermeável", value: "Não" },
      { id: "WITH_WATERPROOF_LINING", name: "Com forro impermeável", value: "Sim" }];
    const r2 = gerar({ titulo: "Bota", attrs: attrs2, categoriaNome: null });
    assert.strictEqual(excluido(r2, "forro impermeável").motivo, "CONFLITO_ATRIBUTO");
  });

  // ── 14. determinismo / sem IA ────────────────────────────────────────────
  await check("14 — determinístico: mesma entrada, mesma saída", () => {
    const a = gerar();
    const b = gerar();
    assert.deepStrictEqual(a, b);
    assert.deepStrictEqual(termos(a), ["meninos", "sintético", "cadarço", "azul marinho", "luzes"]);
  });

  await check("o engine não depende de IA (nem aiProvider, nem claudeClient)", () => {
    const fonte = fs.readFileSync(path.join(__dirname, "../services/meliAnuncios/seo/termosComplementaresEngine.js"), "utf8");
    assert.ok(!/require\([^)]*(aiProvider|claudeClient)/.test(fonte));
  });

  if (falhas) { console.error(`\n${falhas}/${total} falha(s)`); process.exit(1); }
  console.log(`\n✓ termosComplementaresEngine ok (${total} verificações)`);
})();
