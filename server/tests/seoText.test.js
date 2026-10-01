// server/tests/seoText.test.js
//
// Primitivas textuais de SEO (server/services/meliAnuncios/seo/seoText.js).
// Módulo puro: sem banco, sem rede, sem IA, sem Mercado Livre.
//
// O que este teste protege:
//   1. normalização para COMPARAÇÃO (acento, caixa, pontuação, espaços);
//   2. plural e gênero conservadores — cada regra tem um caso positivo E um
//      caso de falso positivo que ela NÃO pode produzir;
//   3. cobertura e complementaridade de termos (palavras e expressões) em
//      relação a um título;
//   4. deduplicação de termos preservando o original para exibição;
//   5. entrada vazia/nula nunca quebra.
//
// Regra da fase: falso negativo é aceitável; falso positivo não.

const assert = require("assert");
const seo = require("../services/meliAnuncios/seo/seoText");

let falhas = 0;
let total = 0;
function check(nome, fn) {
  total += 1;
  try { fn(); console.log("  ✓ " + nome); }
  catch (e) { falhas += 1; console.error("  ✗ " + nome + "\n    " + e.message); }
}

const eq = (a, b) => seo.areEquivalent(a, b);
function equivalentes(pares) {
  for (const [a, b] of pares) assert.ok(eq(a, b), `"${a}" e "${b}" deveriam ser equivalentes (${seo.comparisonKey(a)} × ${seo.comparisonKey(b)})`);
}
function diferentes(pares) {
  for (const [a, b] of pares) assert.ok(!eq(a, b), `"${a}" e "${b}" NÃO podem ser equivalentes (ambos → ${seo.comparisonKey(a)})`);
}
const quase = (a, b) => Math.abs(a - b) < 1e-9;

console.log("seoText");

// ── NORMALIZAÇÃO ────────────────────────────────────────────────────────────
check("1 — Tênis / tenis / TÊNIS são equivalentes", () => {
  equivalentes([["Tênis", "tenis"], ["TÊNIS", "tenis"], ["Tênis", "TÊNIS"]]);
  assert.strictEqual(seo.normalizeToken("TÊNIS"), "tenis");
});

check("2 — pontuação colada não muda o token ('Cadarço,' = 'Cadarço')", () => {
  equivalentes([["Cadarço,", "Cadarço"], ["(cadarço)", "cadarco"], ["Cadarço!", "cadarço."]]);
  assert.deepStrictEqual(seo.tokenize("tênis, cadarço."), ["tenis", "cadarco"]);
});

check("3 — espaços duplicados, tabs e quebras de linha são normalizados", () => {
  assert.strictEqual(seo.normalizeText("  Tênis   Infantil\t\nMasculino  "), "tenis infantil masculino");
});

check("normalizeText: caixa, acento, ç, pontuação e hífen", () => {
  assert.strictEqual(seo.normalizeText("TÊNIS Infantil, Masculino — Com Cadarço!"), "tenis infantil masculino com cadarco");
  assert.strictEqual(seo.normalizeText("Dia-a-Dia"), "dia a dia");
  assert.strictEqual(seo.normalizeText("Bolsa/Mochila_Escolar"), "bolsa mochila escolar");
});

check("tokenização previsível do exemplo da missão", () => {
  assert.deepStrictEqual(
    seo.tokenize("Tênis Infantil Masculino com Cadarço"),
    ["tenis", "infantil", "masculino", "com", "cadarco"]
  );
});

check("números: decimal com vírgula ou ponto vira um token só; ponto final não", () => {
  assert.deepStrictEqual(seo.tokenize("Garrafa 1,5L Inox 2.5 kg."), ["garrafa", "1.5l", "inox", "2.5", "kg"]);
  assert.deepStrictEqual(seo.tokenize("Kit 10 Un. 110v/220v"), ["kit", "10", "un", "110v", "220v"]);
  assert.ok(eq("1,5L", "1.5l"));
});

check("o texto ORIGINAL é preservado por token (exibição ≠ comparação)", () => {
  const t = seo.extractTokens("Tênis Infantil com Cadarço");
  assert.deepStrictEqual(t.map((x) => x.original), ["Tênis", "Infantil", "com", "Cadarço"]);
  assert.deepStrictEqual(t.map((x) => x.normalized), ["tenis", "infantil", "com", "cadarco"]);
  assert.deepStrictEqual(t.map((x) => x.stopword), [false, false, false, false], "'com' não é stopword (par com 'sem')");
  const t2 = seo.extractTokens("Tênis para Menino");
  assert.deepStrictEqual(t2.map((x) => x.stopword), [false, true, false]);
});

// ── STOPWORDS ───────────────────────────────────────────────────────────────
check("stopwords: lista pequena; 'sem', 'com' e 'não' NÃO são removidas", () => {
  for (const s of ["de", "da", "do", "das", "dos", "para", "por", "e", "em", "a", "o", "as", "os"]) {
    assert.ok(seo.isStopword(s), s + " deveria ser stopword");
  }
  for (const s of ["sem", "com", "nao", "não", "mais", "menos", "kit", "fio"]) {
    assert.ok(!seo.isStopword(s), s + " não pode ser stopword");
  }
  assert.deepStrictEqual(seo.contentKeys("Fone sem Fio"), ["fone", "sem", "fio"], "'sem fio' perdeu o 'sem'");
  assert.deepStrictEqual(seo.contentKeys("Fone com Fio"), ["fone", "com", "fio"], "'com fio' perdeu o 'com'");
  assert.deepStrictEqual(seo.contentKeys("Tênis para Menino"), ["tenis", "menino"]);
});

// ── PLURAL ──────────────────────────────────────────────────────────────────
check("4 — menino / meninos", () => equivalentes([["menino", "meninos"], ["Meninos", "MENINO"]]));
check("5 — infantil / infantis (-is → -il)", () => equivalentes([["infantil", "infantis"], ["fuzil", "fuzis"], ["barril", "barris"]]));
check("6 — botão / botões (-ões → -ão), com e sem acento", () => equivalentes([["botão", "botões"], ["botao", "botoes"], ["botão", "botoes"], ["cartão", "cartões"]]));

check("-ães → -ão e -ãos → -ão (palavras ≥ 5 letras)", () => {
  equivalentes([["alemão", "alemães"], ["capitão", "capitães"], ["irmão", "irmãos"], ["cristão", "cristãos"]]);
  // curtas ficam de fora de propósito: mães (de mãe) ≠ mão; caos ≠ cão
  diferentes([["mães", "mão"], ["caos", "cão"], ["mãos", "mão"]]);
});

check("-ais → -al, -óis → -ol, -uis → -ul", () => {
  equivalentes([["anual", "anuais"], ["metal", "metais"], ["natural", "naturais"]]);
  equivalentes([["farol", "faróis"], ["lençol", "lençóis"], ["anzol", "anzóis"]]);
  equivalentes([["azul", "azuis"]]);
  // "mais" (≠ mal), "pais" (≠ pal), "dois", "depois" não são plurais dessas regras
  diferentes([["mais", "mal"], ["dois", "dol"], ["depois", "depol"]]);
});

check("-éis → -el; -veis → -vel; outras -eis acentuadas → -il", () => {
  equivalentes([["papel", "papéis"], ["anel", "anéis"], ["hotel", "hotéis"], ["pastel", "pastéis"]]);
  equivalentes([["ajustável", "ajustáveis"], ["móvel", "móveis"], ["dobrável", "dobraveis"], ["removível", "removíveis"]]);
  equivalentes([["portátil", "portáteis"], ["fácil", "fáceis"], ["útil", "úteis"]]);
  diferentes([["seis", "sel"], ["reis", "rel"]]);
});

check("-ns → -m", () => {
  equivalentes([["homem", "homens"], ["jardim", "jardins"], ["nuvem", "nuvens"], ["marrom", "marrons"], ["atum", "atuns"]]);
  // "jeans" é invariável — não vira "jeam"
  assert.strictEqual(seo.comparisonKey("jeans"), "jeans");
});

check("-res/-zes: tira '-es' depois de vogal (cor-es), só '-s' depois de consoante (livre-s)", () => {
  equivalentes([["cor", "cores"], ["flor", "flores"], ["motor", "motores"], ["luz", "luzes"], ["nariz", "narizes"]]);
  equivalentes([["livre", "livres"], ["padre", "padres"], ["bronze", "bronzes"]]);
  diferentes([["livres", "livr"], ["cores", "core"]]);
});

check("-s simples depois de vogal; -ses tira só o '-s' (bases → base, não 'bas')", () => {
  equivalentes([["casa", "casas"], ["chave", "chaves"], ["pneu", "pneus"], ["base", "bases"], ["classe", "classes"]]);
  diferentes([["bases", "bas"]]);
});

check("-s depois de consoante em palavra ≥ 4 letras (kit/kits, led/leds, short/shorts)", () => {
  equivalentes([["kit", "kits"], ["led", "leds"], ["short", "shorts"], ["chip", "chips"]]);
  // siglas curtas não: 'pcs' (peças) ≠ 'pc' (computador), 'gps' ≠ 'gp'
  diferentes([["pcs", "pc"], ["gps", "gp"]]);
});

check("invariáveis terminadas em -s não são reduzidas", () => {
  for (const w of ["tênis", "tenis", "lápis", "lapis", "ônibus", "vírus", "bônus", "óculos", "oculos", "pires", "simples", "atlas", "gás", "grátis", "chassis", "status"]) {
    assert.strictEqual(seo.comparisonKey(w), seo.normalizeToken(w), w + " foi reduzida");
  }
  diferentes([["tênis", "tenil"], ["ônibus", "onibu"], ["óculos", "oculo"], ["simples", "simple"]]);
});

// ── GÊNERO ──────────────────────────────────────────────────────────────────
check("7 — masculino / masculina (e plurais)", () => equivalentes([["masculino", "masculina"], ["Masculinas", "masculino"], ["masculinos", "MASCULINA"]]));
check("8 — feminino / feminina (e plurais)", () => equivalentes([["feminino", "feminina"], ["femininas", "feminino"]]));

check("gênero só por lista explícita: -o/-a genérico NÃO é equivalência", () => {
  equivalentes([["branco", "branca"], ["preto", "pretas"], ["vermelho", "vermelha"], ["novo", "nova"], ["usado", "usada"]]);
  diferentes([["menino", "menina"], ["garoto", "garota"], ["bolso", "bolsa"], ["porto", "porta"], ["cesto", "cesta"]]);
});

// ── FALSOS POSITIVOS OBRIGATÓRIOS ───────────────────────────────────────────
check("9 — cadeira ≠ cadeado", () => diferentes([["cadeira", "cadeado"], ["cadeiras", "cadeados"]]));
check("10 — casa ≠ caso", () => diferentes([["casa", "caso"], ["casas", "casos"]]));
check("11 — modelo ≠ modelar", () => diferentes([["modelo", "modelar"], ["modelos", "modelar"]]));

check("sem semântica nesta fase: infantil ≠ criança, menino ≠ garoto", () => {
  diferentes([["infantil", "criança"], ["menino", "garoto"], ["tênis", "calçado"]]);
});

// ── COBERTURA ───────────────────────────────────────────────────────────────
const TITULO = "Tênis Infantil Masculino";

check("12 — 'Tênis Infantil' em 'Tênis Infantil Masculino' → coverage 1", () => {
  const c = seo.termCoverage("Tênis Infantil", TITULO);
  assert.strictEqual(c.totalTokens, 2);
  assert.strictEqual(c.coveredTokens, 2);
  assert.deepStrictEqual(c.uncoveredTokens, []);
  assert.strictEqual(c.coverage, 1);
});

check("13 — 'Tênis Cadarço' → coverage 0.5, descoberto 'cadarco' (original preservado)", () => {
  const c = seo.termCoverage("Tênis Cadarço", TITULO);
  assert.strictEqual(c.totalTokens, 2);
  assert.strictEqual(c.coveredTokens, 1);
  assert.strictEqual(c.coverage, 0.5);
  assert.deepStrictEqual(c.uncoveredTokens, ["cadarco"]);
  assert.deepStrictEqual(c.tokens.map((t) => [t.original, t.covered]), [["Tênis", true], ["Cadarço", false]]);
});

check("14 — 'Passeio' → coverage 0", () => {
  const c = seo.termCoverage("Passeio", TITULO);
  assert.strictEqual(c.coverage, 0);
  assert.deepStrictEqual(c.uncoveredTokens, ["passeio"]);
});

check("cobertura parcial de expressão: stopword não conta, 'com' conta", () => {
  const c = seo.termCoverage("tênis para menino", "Tênis Infantil Masculino Molekinho Escolar");
  assert.strictEqual(c.totalTokens, 2, "'para' é funcional em 'tênis para menino'");
  assert.strictEqual(c.coverage, 0.5);
  const cc = seo.termCoverage("tênis com cadarço", "Tênis Infantil Masculino Molekinho Escolar");
  assert.strictEqual(cc.totalTokens, 3);
  assert.ok(quase(cc.coverage, 1 / 3));
  const c3 = seo.termCoverage("tênis infantil masculino", "Tênis Infantil Masculino Molekinho Escolar");
  assert.strictEqual(c3.coverage, 1);
  const c4 = seo.termCoverage("tênis escolar passeio", "Tênis Infantil Masculino Molekinho Escolar");
  assert.ok(quase(c4.coverage, 2 / 3));
});

check("termo com token repetido conta uma vez", () => {
  const c = seo.termCoverage("tênis tênis infantil", "Tênis Escolar");
  assert.strictEqual(c.totalTokens, 2);
  assert.strictEqual(c.coverage, 0.5);
});

check("'sem fio' não é coberto por um título que só tem 'fio'", () => {
  const c = seo.termCoverage("sem fio", "Fone Bluetooth Fio Longo");
  assert.strictEqual(c.coverage, 0.5);
  assert.deepStrictEqual(c.uncoveredTokens, ["sem"]);
});

// ── MORFOLOGIA + COBERTURA ──────────────────────────────────────────────────
check("15 — 'menino' coberto por 'Tênis Infantil Meninos'", () => {
  assert.ok(seo.tokenCoveredByTitle("menino", "Tênis Infantil Meninos"));
  assert.strictEqual(seo.termCoverage("menino", "Tênis Infantil Meninos").coverage, 1);
});

check("16 — 'masculina' coberto por 'Tênis Masculino'", () => {
  assert.ok(seo.tokenCoveredByTitle("masculina", "Tênis Masculino"));
  assert.ok(!seo.tokenCoveredByTitle("feminina", "Tênis Masculino"));
});

check("tokenCoveredByTitle aceita o conjunto de chaves pré-calculado (mesmo resultado)", () => {
  const chaves = seo.titleKeySet("Tênis Infantil Meninos");
  assert.ok(chaves instanceof Set);
  assert.ok(seo.tokenCoveredByTitle("menino", chaves));
  assert.ok(!seo.tokenCoveredByTitle("cadarço", chaves));
  assert.deepStrictEqual(seo.termCoverage("tênis cadarço", chaves), seo.termCoverage("tênis cadarço", "Tênis Infantil Meninos"));
});

// ── COMPLEMENTARIDADE ───────────────────────────────────────────────────────
check("17 — 100% coberto → complementarity 0", () => {
  assert.strictEqual(seo.termComplementarity("Tênis Infantil", TITULO), 0);
});
check("18 — 50% coberto → complementarity 0.5", () => {
  assert.strictEqual(seo.termComplementarity("tênis cadarço", TITULO), 0.5);
});
check("19 — 0% coberto → complementarity 1", () => {
  assert.strictEqual(seo.termComplementarity("passeio", TITULO), 1);
});
check("complementaridade = 1 − cobertura, também em frações", () => {
  const c = seo.termCoverage("tênis escolar passeio", "Tênis Infantil Masculino Molekinho Escolar");
  assert.ok(quase(seo.termComplementarity("tênis escolar passeio", "Tênis Infantil Masculino Molekinho Escolar"), 1 - c.coverage));
});

// ── DEDUPLICAÇÃO ────────────────────────────────────────────────────────────
check("20 — Cadarço / cadarco / cadarços → um grupo, original preservado", () => {
  const g = seo.dedupeTerms(["Cadarço", "cadarco", "cadarços"]);
  assert.strictEqual(g.length, 1);
  assert.strictEqual(g[0].canonical, "cadarco");
  assert.strictEqual(g[0].display, "Cadarço");
  assert.deepStrictEqual(g[0].variants, ["Cadarço", "cadarco", "cadarços"]);
});

check("dedupe de expressões e ordem estável dos grupos", () => {
  const g = seo.dedupeTerms(["Tênis Infantil", "tenis infantis", "Tênis Escolar", "cadeira", "cadeado", "  "]);
  assert.deepStrictEqual(g.map((x) => x.canonical), ["tenis infantil", "tenis escolar", "cadeira", "cadeado"]);
  assert.deepStrictEqual(g[0].variants, ["Tênis Infantil", "tenis infantis"]);
});

check("dedupe é sensível à ordem das palavras (conservador)", () => {
  const g = seo.dedupeTerms(["tênis infantil", "infantil tênis"]);
  assert.strictEqual(g.length, 2);
});

// ── TEXTO VAZIO ─────────────────────────────────────────────────────────────
check("21 — null / undefined / '' não quebram nenhuma função", () => {
  for (const v of [null, undefined, "", "   ", ",,, ..."]) {
    assert.strictEqual(seo.normalizeText(v), "");
    assert.deepStrictEqual(seo.tokenize(v), []);
    assert.deepStrictEqual(seo.extractTokens(v), []);
    assert.deepStrictEqual(seo.contentKeys(v), []);
    assert.strictEqual(seo.normalizeToken(v), "");
    assert.strictEqual(seo.comparisonKey(v), "");
    assert.strictEqual(seo.reduceMorphology(v), "");
    assert.strictEqual(seo.isStopword(v), false);
    assert.strictEqual(seo.areEquivalent(v, "tenis"), false);
    assert.strictEqual(seo.areEquivalent(v, v), false, "vazio não é equivalente a nada, nem a ele mesmo");
    assert.strictEqual(seo.tokenCoveredByTitle(v, "Tênis"), false);
    assert.strictEqual(seo.tokenCoveredByTitle("tenis", v), false);
    assert.strictEqual(seo.titleKeySet(v).size, 0);
    const c = seo.termCoverage(v, "Tênis");
    assert.deepStrictEqual([c.totalTokens, c.coveredTokens, c.coverage], [0, 0, 1]);
    assert.strictEqual(seo.termComplementarity(v, "Tênis"), 0, "termo vazio não acrescenta nada");
    assert.strictEqual(seo.termCoverage("passeio", v).coverage, 0, "título vazio não cobre nada");
    assert.strictEqual(seo.termComplementarity("passeio", v), 1);
    assert.deepStrictEqual(seo.dedupeTerms([v]), []);
  }
  assert.deepStrictEqual(seo.dedupeTerms(null), []);
  assert.deepStrictEqual(seo.dedupeTerms(undefined), []);
});

check("termo só de stopwords: nada novo (coverage 1, complementarity 0)", () => {
  assert.strictEqual(seo.termComplementarity("de para a", TITULO), 0);
});

// ── COMPOSTOS COM STOPWORD ──────────────────────────────────────────────────
check("para-choque NÃO é equivalente a choque", () => {
  diferentes([["para-choque", "choque"], ["para choque", "choque"], ["parachoque", "choque"]]);
  const t = seo.extractTokens("Para-Choque Dianteiro");
  assert.deepStrictEqual(t.map((x) => [x.original, x.normalized, x.key, x.stopword]),
    [["Para-Choque", "para choque", "parachoque", false], ["Dianteiro", "dianteiro", "dianteiro", false]]);
  assert.deepStrictEqual(seo.contentKeys("Para-Choque Dianteiro"), ["parachoque", "dianteiro"]);
});

check("'para-choque' NÃO é coberto por 'Protetor Contra Choque'; é coberto pelo composto", () => {
  const c = seo.termCoverage("para-choque", "Protetor Contra Choque");
  assert.strictEqual(c.totalTokens, 1);
  assert.strictEqual(c.coverage, 0);
  assert.strictEqual(seo.termComplementarity("para-choque", "Protetor Contra Choque"), 1);
  assert.deepStrictEqual(seo.dedupeTerms(["para-choque", "choque"]).map((g) => g.canonical), ["parachoque", "choque"]);
  // e é coberto por um título que tem o composto, em qualquer grafia
  assert.strictEqual(seo.termCoverage("para-choque", "Parachoque Traseiro Gol").coverage, 1);
  assert.strictEqual(seo.termCoverage("parachoque", "Para-Choque Traseiro Gol").coverage, 1);
});

check("A — para-choque ≡ parachoque (inclusive plural)", () => {
  assert.strictEqual(seo.areEquivalent("para-choque", "parachoque"), true);
  equivalentes([["Para-Choques", "parachoque"], ["PARA-CHOQUE", "para-choques"]]);
  const g = seo.dedupeTerms(["Para-Choque", "parachoque", "para-choques"]);
  assert.strictEqual(g.length, 1);
  assert.strictEqual(g[0].display, "Para-Choque");
});

check("B — 'para choque' (com ESPAÇO) NÃO é parachoque", () => {
  assert.strictEqual(seo.areEquivalent("para choque", "parachoque"), false);
  assert.strictEqual(seo.areEquivalent("para choque", "para-choque"), false);
  assert.deepStrictEqual(seo.contentKeys("para choque"), ["choque"], "com espaço, 'para' é funcional");
  assert.strictEqual(seo.dedupeTerms(["para-choque", "para choque"]).length, 2);
});

check("C — termCoverage('para-choque', 'Protetor Contra Choque') = 0", () => {
  assert.strictEqual(seo.termCoverage("para-choque", "Protetor Contra Choque").coverage, 0);
});

check("D — 'Peça Para Choque Dianteiro' (com espaço) não contém o composto parachoque", () => {
  const titulo = "Peça Para Choque Dianteiro";
  assert.ok(!seo.titleKeySet(titulo).has("parachoque"));
  assert.strictEqual(seo.termCoverage("para-choque", titulo).coverage, 0);
  assert.strictEqual(seo.tokenCoveredByTitle("parachoque", titulo), false);
});

check("E — 'luva para choque elétrico' não produz a chave parachoque", () => {
  const t = seo.extractTokens("luva para choque elétrico");
  assert.ok(!t.some((x) => x.key === "parachoque"), JSON.stringify(t.map((x) => x.key)));
  assert.deepStrictEqual(seo.contentKeys("luva para choque elétrico"), ["luva", "choque", "eletrico"]);
  assert.strictEqual(seo.termCoverage("para-choque", "Luva para Choque Elétrico").coverage, 0);
});

check("F — para-brisa ≡ parabrisa", () => {
  assert.strictEqual(seo.areEquivalent("para-brisa", "parabrisa"), true);
  assert.strictEqual(seo.termCoverage("parabrisa", "Para-Brisa Dianteiro Gol").coverage, 1);
});

check("G — 'para brisa' (com ESPAÇO) NÃO é parabrisa", () => {
  assert.strictEqual(seo.areEquivalent("para brisa", "parabrisa"), false);
  assert.strictEqual(seo.termCoverage("para-brisa", "Limpador para Brisa").coverage, 0);
});

check("'Tênis para Menino' não ganha token de conteúdo por causa da proteção", () => {
  assert.deepStrictEqual(seo.contentKeys("Tênis para Menino"), ["tenis", "menino"]);
  assert.strictEqual(seo.termCoverage("Tênis para Menino", "Tênis Menino").coverage, 1);
});

check("para + X: hífen junta; espaço nunca junta", () => {
  // com hífen: composto
  equivalentes([["para-lama", "paralama"], ["para-sol", "parasol"], ["para-sóis", "para-sol"], ["para-raios", "pararaio"]]);
  // com espaço: frase normal, "para" é funcional
  assert.deepStrictEqual(seo.contentKeys("bota para lama"), ["bota", "lama"]);
  assert.deepStrictEqual(seo.contentKeys("protetor para sol"), ["protetor", "sol"]);
  assert.deepStrictEqual(seo.contentKeys("proteção para raios"), ["protecao", "raio"]);
  // "para-brisa" não é coberto por "Brisa"
  assert.strictEqual(seo.termCoverage("para-brisa", "Limpador Brisa Suave").coverage, 0);
});

check("polaridade com/sem: 'com fio' não é coberto por 'sem fio' (nem o contrário)", () => {
  assert.notStrictEqual(seo.termCoverage("com fio", "Fone Bluetooth sem Fio").coverage, 1);
  assert.notStrictEqual(seo.termCoverage("sem fio", "Fone com Fio").coverage, 1);
  assert.notStrictEqual(seo.termCoverage("com tampa", "Garrafa Térmica sem Tampa").coverage, 1);
  assert.notStrictEqual(seo.termCoverage("com açúcar", "Café sem Açúcar").coverage, 1);
  assert.strictEqual(seo.termCoverage("sem fio", "Fone Bluetooth sem Fio").coverage, 1);
  assert.strictEqual(seo.dedupeTerms(["com fio", "fio", "sem fio"]).length, 3);
  diferentes([["com fio", "sem fio"], ["com fio", "fio"]]);
});

check("'dia a dia' é um composto: não é coberto por um título que só tem 'dia'", () => {
  assert.strictEqual(seo.termCoverage("dia a dia", "Tênis Dia das Crianças").coverage, 0);
  assert.strictEqual(seo.termCoverage("dia a dia", "Tênis Casual Dia a Dia").coverage, 1);
  assert.strictEqual(seo.termCoverage("dia-a-dia", "Tênis Casual Dia a Dia").coverage, 1);
  assert.deepStrictEqual(seo.tokenize("Tênis Dia-a-Dia"), ["tenis", "dia a dia"]);
  diferentes([["dia a dia", "dia"]]);
});

check("entradas não-string são convertidas, não quebram", () => {
  assert.deepStrictEqual(seo.tokenize(110), ["110"]);
  assert.strictEqual(seo.normalizeToken(220), "220");
});

check("funções são puras: mesma entrada, mesma saída; nada é mutado", () => {
  const termos = ["Cadarço", "cadarços"];
  const copia = termos.slice();
  seo.dedupeTerms(termos);
  assert.deepStrictEqual(termos, copia);
  assert.deepStrictEqual(seo.termCoverage("tênis cadarço", TITULO), seo.termCoverage("tênis cadarço", TITULO));
});

if (falhas) { console.error(`\n${falhas}/${total} falha(s)`); process.exit(1); }
console.log(`\n✓ seoText ok (${total} verificações)`);
