// server/tests/tituloEngine.test.js
//
// Title Engine (server/services/meliAnuncios/seo/tituloEngine.js) — parte
// pura (fatos, validação, score) e a geração com o aiProvider SIMULADO.
// Nenhuma chamada real à Anthropic, ao Mercado Livre ou ao banco.
//
// O que este teste protege:
//   - o score é calculado pelo CÓDIGO e responde aos fatos (cobertura,
//     relevância, eficiência, especificidade, clareza, redundância);
//   - claim não comprovado, marca errada, atributo conflitante, título longo
//     e repetição artificial são DESCARTADOS, não só penalizados;
//   - o LLM nunca decide nota nem vencedor: o que ele devolve além dos
//     títulos é ignorado;
//   - erros do provider chegam distinguíveis e nunca viram sugestão.

const assert = require("assert");
const engine = require("../services/meliAnuncios/seo/tituloEngine");

let falhas = 0;
let total = 0;
async function check(nome, fn) {
  total += 1;
  try { await fn(); console.log("  ✓ " + nome); }
  catch (e) { falhas += 1; console.error("  ✗ " + nome + "\n    " + (e.stack || e.message)); }
}

function anuncio(over = {}) {
  return {
    item_id: "MLB1",
    titulo: "Tênis Infantil Masculino Molekinho Escolar Cadarço",
    marca: "Molekinho",
    modelo: "2103",
    category_id: "MLB23332",
    catalog_listing: false,
    family_name: null,
    attributes_json: [
      { id: "BRAND", name: "Marca", value: "Molekinho" },
      { id: "MODEL", name: "Modelo", value: "2103" },
      { id: "GENDER", name: "Gênero", value: "Meninos" },
      { id: "LINE", name: "Linha", value: "Casual" },
      { id: "CLOSURE_TYPE", name: "Tipo de fechamento", value: "Cadarço" },
      { id: "OUTSOLE_MATERIAL", name: "Material da sola", value: "Borracha" },
      { id: "COLOR", name: "Cor", value: "Azul" },
      { id: "IS_WATERPROOF", name: "É impermeável", value: "Não" },
      { id: "SELLER_SKU", name: "SKU", value: "MK-2103-AZ" },
      { id: "WEIGHT", name: "Peso", value: null },
    ],
    ...over,
  };
}

const FATOS = engine.montarFatos(anuncio(), { categoriaNome: "Tênis", limite: 60 });
const avaliar = (t, fatos = FATOS) => engine.avaliarTitulo(t, fatos);

function providerCom(resposta) {
  const chamadas = [];
  return {
    chamadas,
    async gerarJSON(opts) {
      chamadas.push(opts);
      return typeof resposta === "function" ? resposta(opts) : resposta;
    },
  };
}
const okIa = (titulos, extra = {}) => ({ ok: true, provider: "anthropic", model: "m", usage: null, data: { titulos, ...extra } });

(async () => {
  console.log("tituloEngine");

  // ── FICHA DE FATOS ─────────────────────────────────────────────────────────
  await check("ficha de fatos: categoria, marca, modelo e atributos estruturados; SKU e vazios fora", () => {
    const tipos = FATOS.conceitos.map((c) => c.tipo + ":" + c.termo);
    assert.ok(tipos.includes("categoria:Tênis"));
    assert.ok(tipos.includes("marca:Molekinho"));
    assert.ok(tipos.includes("modelo:2103"));
    assert.ok(tipos.includes("atributo:Meninos"));
    assert.ok(tipos.includes("atributo:Cadarço"));
    assert.ok(!tipos.some((t) => /MK-2103|Peso/.test(t)), "SKU/atributo vazio não pode virar fato");
    assert.strictEqual(FATOS.limite, 60);
    assert.ok(FATOS.proibidos.has("impermeavel"), "'É impermeável: Não' precisa proibir 'impermeável'");
    assert.ok(FATOS.proibidos.has("feminino") && FATOS.proibidos.has("menina"), "gênero oposto ao atributo GENDER é conflito");
  });

  await check("marca genérica não é fato; MODEL que é lista de palavras-chave não é modelo real", () => {
    const f = engine.montarFatos(anuncio({
      marca: "Genérica",
      attributes_json: [
        { id: "BRAND", name: "Marca", value: "Genérica" },
        { id: "MODEL", name: "Modelo", value: "calcado escola crianca conforto passeio leve" },
      ],
    }), { categoriaNome: "Tênis", limite: 60 });
    assert.ok(!f.conceitos.some((c) => c.tipo === "marca"));
    assert.ok(!f.conceitos.some((c) => c.tipo === "modelo"));
    assert.ok(!f.vocabulario.has("passeio"), "palavras-chave do MODEL poluído não podem autorizar claims");
  });

  // ── GENDER: sustenta só o público que ele diz (sexo E faixa) ───────────────
  function fatosGenero(valor, titulo = "Tênis Molekinho Casual") {
    return engine.montarFatos(anuncio({
      titulo,
      attributes_json: [
        { id: "BRAND", name: "Marca", value: "Molekinho" },
        { id: "GENDER", name: "Gênero", value: valor },
      ],
    }), { categoriaNome: "Tênis", limite: 60 });
  }
  const genero = (valor, t, titulo) => engine.avaliarTitulo(t, fatosGenero(valor, titulo));

  await check("A — GENDER=Meninos: 'Tênis Masculino' permitido", () => {
    assert.strictEqual(genero("Meninos", "Tênis Masculino Molekinho").valido, true);
  });
  await check("B — GENDER=Meninos: 'Tênis Menino' permitido", () => {
    assert.strictEqual(genero("Meninos", "Tênis Menino Molekinho").valido, true);
    assert.strictEqual(genero("Meninos", "Tênis Meninos Molekinho").valido, true);
  });
  await check("C — GENDER=Meninos: 'Tênis Homem' descartado (claim etário), nem o título atual autoriza", () => {
    const r = genero("Meninos", "Tênis Homem Molekinho");
    assert.strictEqual(r.valido, false);
    assert.ok(["NAO_COMPROVADO", "CONFLITO_ATRIBUTO"].includes(r.motivo), r.motivo);
    assert.strictEqual(genero("Meninos", "Tênis Homem Molekinho", "Tênis Homem Molekinho Casual").valido, false,
      "'Homem' no título do vendedor não pode contradizer GENDER=Meninos");
  });
  await check("D — GENDER=Meninas: 'Tênis Mulher' descartado", () => {
    assert.strictEqual(genero("Meninas", "Tênis Mulher Molekinho").valido, false);
    assert.strictEqual(genero("Meninas", "Tênis Menina Feminino Molekinho").valido, true);
  });
  await check("E — GENDER=Homens: 'Tênis Menino' descartado", () => {
    assert.strictEqual(genero("Homens", "Tênis Menino Molekinho").valido, false);
    assert.strictEqual(genero("Homens", "Tênis Homem Masculino Molekinho").valido, true);
  });
  await check("F — GENDER=Mulheres: 'Tênis Menina' descartado", () => {
    assert.strictEqual(genero("Mulheres", "Tênis Menina Molekinho").valido, false);
    assert.strictEqual(genero("Mulheres", "Tênis Mulher Feminino Molekinho").valido, true);
  });
  await check("G — sexo oposto continua CONFLITO_ATRIBUTO (Meninos + 'Feminino')", () => {
    const r = genero("Meninos", "Tênis Feminino Molekinho");
    assert.strictEqual(r.valido, false);
    assert.strictEqual(r.motivo, "CONFLITO_ATRIBUTO");
  });
  await check("garoto/garota não são mais sustentados por GENDER; idade não é inferida", () => {
    assert.strictEqual(genero("Meninos", "Tênis Garoto Molekinho").motivo, "NAO_COMPROVADO");
    assert.strictEqual(genero("Meninas", "Tênis Garota Molekinho").motivo, "NAO_COMPROVADO");
    for (const idade of ["Infantil", "Criança", "Adulto", "Juvenil"]) {
      assert.strictEqual(genero("Meninos", "Tênis " + idade + " Molekinho").motivo, "NAO_COMPROVADO", idade);
    }
  });
  await check("GENDER sem faixa ('Masculino') sustenta só 'masculino'; 'Unissex' proíbe gêneros específicos", () => {
    assert.strictEqual(genero("Masculino", "Tênis Masculino Molekinho").valido, true);
    assert.strictEqual(genero("Masculino", "Tênis Menino Molekinho").motivo, "NAO_COMPROVADO");
    assert.strictEqual(genero("Masculino", "Tênis Feminino Molekinho").motivo, "CONFLITO_ATRIBUTO");
    assert.strictEqual(genero("Unissex", "Tênis Unissex Molekinho").valido, true);
    assert.strictEqual(genero("Unissex", "Tênis Masculino Molekinho").motivo, "CONFLITO_ATRIBUTO");
  });
  await check("GENDER 'Meninos e Meninas' sustenta os dois; proíbe só a faixa adulta", () => {
    assert.strictEqual(genero("Meninos e Meninas", "Tênis Menino Menina Molekinho").valido, true);
    assert.strictEqual(genero("Meninos e Meninas", "Tênis Homem Molekinho").motivo, "CONFLITO_ATRIBUTO");
  });

  // ── DESCARTE ───────────────────────────────────────────────────────────────
  await check("C — acima do limite → inválido (EXCEDE_LIMITE)", () => {
    const r = avaliar("Tênis Infantil Masculino Molekinho 2103 Casual Escolar Cadarço Azul Borracha");
    assert.strictEqual(r.valido, false);
    assert.strictEqual(r.motivo, "EXCEDE_LIMITE");
    const f55 = engine.montarFatos(anuncio(), { categoriaNome: "Tênis", limite: 40 });
    assert.strictEqual(engine.avaliarTitulo("Tênis Infantil Masculino Molekinho 2103 Casual", f55).motivo, "EXCEDE_LIMITE");
  });

  await check("D — marca errada → inválido (palavra não comprovada)", () => {
    const r = avaliar("Tênis Nike Infantil Masculino Casual Cadarço");
    assert.strictEqual(r.valido, false);
    assert.strictEqual(r.motivo, "NAO_COMPROVADO");
    assert.deepStrictEqual(r.termos, ["nike"]);
  });

  await check("E — atributo conflitante → inválido (gênero oposto, 'É impermeável: Não')", () => {
    let r = avaliar("Tênis Molekinho Feminino Casual Cadarço Azul");
    assert.strictEqual(r.valido, false);
    assert.strictEqual(r.motivo, "CONFLITO_ATRIBUTO");
    r = avaliar("Tênis Molekinho Impermeável Casual Cadarço Azul");
    assert.strictEqual(r.motivo, "CONFLITO_ATRIBUTO");
  });

  await check("claim não comprovado ('Confortável', 'Leve') → descartado, não só penalizado", () => {
    const r = avaliar("Tênis Infantil Molekinho Confortável Leve Cadarço");
    assert.strictEqual(r.valido, false);
    assert.strictEqual(r.motivo, "NAO_COMPROVADO");
    assert.deepStrictEqual(r.termos.sort(), ["confortavel", "leve"]);
  });

  await check("F — 'Tênis Tênis Infantil Infantil' → repetição artificial descartada", () => {
    const r = avaliar("Tênis Tênis Infantil Infantil");
    assert.strictEqual(r.valido, false);
    assert.strictEqual(r.motivo, "REPETICAO");
  });

  await check("estrutura inválida: vazio, emoji/símbolo, uma palavra só", () => {
    assert.strictEqual(avaliar("").motivo, "VAZIO");
    assert.strictEqual(avaliar("   ").motivo, "VAZIO");
    assert.strictEqual(avaliar("Tênis Molekinho ★ Casual").motivo, "ESTRUTURA_INVALIDA");
    assert.strictEqual(avaliar("Tênis Molekinho | Casual").motivo, "ESTRUTURA_INVALIDA");
    assert.strictEqual(avaliar("Tênis").motivo, "ESTRUTURA_INVALIDA");
  });

  await check("flexões e acentos são aceitos como o mesmo fato (seoText)", () => {
    assert.strictEqual(avaliar("Tenis Infantis Meninos Molekinho Cadarcos Casual").valido, true);
    // gênero do atributo GENDER=Meninos sustenta 'masculino' (evidência estrutural)
    assert.strictEqual(avaliar("Tênis Masculino Molekinho 2103 Casual Cadarço").valido, true);
  });

  // ── SCORE ──────────────────────────────────────────────────────────────────
  const completo = "Tênis Molekinho 2103 Infantil Masculino Casual Cadarço Azul";
  const pobre = "Tênis Infantil Escolar Azul";

  await check("A — título com melhor cobertura factual > título que omite quase tudo", () => {
    const a = avaliar(completo);
    const b = avaliar(pobre);
    assert.ok(a.valido && b.valido, JSON.stringify([a.motivo, b.motivo]));
    assert.ok(a.breakdown.cobertura > b.breakdown.cobertura, JSON.stringify([a.breakdown, b.breakdown]));
    assert.ok(a.score > b.score);
  });

  await check("B — título na faixa eficiente > título extremamente curto (mesmos fatos)", () => {
    // alvo 57–60 · bom 55–56 · curto 50–54 · abaixo de 50 = penalidade forte
    assert.strictEqual(engine.pontuarEficiencia(60, 60), 15);
    assert.strictEqual(engine.pontuarEficiencia(57, 60), 15);
    assert.strictEqual(engine.pontuarEficiencia(56, 60), 12);
    assert.strictEqual(engine.pontuarEficiencia(55, 60), 12);
    assert.strictEqual(engine.pontuarEficiencia(54, 60), 5);
    assert.strictEqual(engine.pontuarEficiencia(50, 60), 5);
    assert.strictEqual(engine.pontuarEficiencia(49, 60), 0);
    assert.strictEqual(engine.pontuarEficiencia(15, 60), 0);
    assert.strictEqual(engine.pontuarEficiencia(61, 60), 0);
    // relativo ao limite real da categoria
    assert.strictEqual(engine.pontuarEficiencia(38, 40), 15);
    assert.strictEqual(engine.pontuarEficiencia(29, 40), 0);
    const curto = avaliar("Tênis Molekinho");
    const eficiente = avaliar(completo);
    assert.ok(curto.valido);
    assert.ok(eficiente.breakdown.eficiencia > curto.breakdown.eficiencia);
    assert.ok(eficiente.score > curto.score);
  });

  await check("relevância: palavras de fato estruturado > palavras só do título atual", () => {
    const estruturado = avaliar("Tênis Molekinho Masculino Casual Cadarço Azul");
    const soTitulo = avaliar("Tênis Infantil Escolar Molekinho Casual Azul");
    assert.ok(estruturado.breakdown.relevancia > soTitulo.breakdown.relevancia,
      JSON.stringify([estruturado.breakdown, soTitulo.breakdown]));
  });

  await check("especificidade cresce com fatos concretos (marca, modelo, atributos)", () => {
    const generico = avaliar("Tênis Infantil Masculino Escolar");
    const especifico = avaliar("Tênis Molekinho 2103 Masculino Cadarço");
    assert.ok(especifico.breakdown.especificidade > generico.breakdown.especificidade);
  });

  await check("G — redundância por plural/acento não escapa: 'Meninos Menino' é penalizado", () => {
    const repetido = avaliar("Tênis Infantil Meninos Molekinho Menino Casual");
    const limpo = avaliar("Tênis Infantil Meninos Molekinho Cadarço Casual");
    assert.ok(repetido.valido, repetido.motivo);
    assert.ok(repetido.breakdown.redundancia < limpo.breakdown.redundancia);
    const acento = avaliar("Tênis Tenis Molekinho Casual Cadarço");
    assert.ok(acento.breakdown.redundancia < 5, "'Tênis Tenis' é a mesma palavra");
  });

  await check("clareza: linguagem promocional (sustentada pelo título atual) e conectivo solto perdem pontos", () => {
    const f = engine.montarFatos(anuncio({ titulo: "Tênis Premium Infantil Molekinho Oferta" }), { categoriaNome: "Tênis", limite: 60 });
    const promo = engine.avaliarTitulo("Tênis Premium Molekinho Casual Cadarço", f);
    const normal = engine.avaliarTitulo("Tênis Infantil Molekinho Casual Cadarço", f);
    assert.ok(promo.valido, promo.motivo);
    assert.ok(promo.breakdown.clareza < normal.breakdown.clareza);
    const quebrado = avaliar("Tênis Molekinho Casual com");
    assert.ok(quebrado.breakdown.clareza < avaliar("Tênis Molekinho Casual Azul").breakdown.clareza);
  });

  await check("score: inteiro 0–100 = soma exata do breakdown; teto de cada componente", () => {
    for (const t of [completo, pobre, "Tênis Molekinho", "Tênis Infantil Meninos Molekinho Menino Casual"]) {
      const r = avaliar(t);
      const b = r.breakdown;
      assert.strictEqual(r.score, b.cobertura + b.relevancia + b.eficiencia + b.especificidade + b.clareza + b.redundancia);
      assert.ok(Number.isInteger(r.score) && r.score >= 0 && r.score <= 100);
      assert.ok(b.cobertura <= 35 && b.relevancia <= 25 && b.eficiencia <= 15 && b.especificidade <= 10 && b.clareza <= 10 && b.redundancia <= 5);
      assert.strictEqual(r.chars, t.length);
    }
  });

  await check("determinístico: mesma entrada, mesmo score", () => {
    assert.deepStrictEqual(avaliar(completo), avaliar(completo));
  });

  // ── GERAÇÃO (aiProvider simulado) ──────────────────────────────────────────
  const BONS = [
    "Tênis Molekinho 2103 Infantil Masculino Casual Cadarço Azul",
    "Tênis Infantil Masculino Molekinho Casual Cadarço Azul",
    "Tênis Molekinho Infantil Meninos Casual Cadarço Borracha",
    "Tênis Escolar Infantil Molekinho 2103 Cadarço Azul",
    "Tênis Casual Molekinho Masculino Infantil Sola Borracha",
    "Tênis Infantil Molekinho Escolar Casual Azul",
    "Tênis Molekinho Masculino Cadarço Azul Casual Infantil",
    "Tênis Infantil Escolar Masculino Cadarço Azul",
  ];

  await check("JSON válido com 8 candidatos → no máximo 6, ordenados por score, sem 'vencedor'", async () => {
    const p = providerCom(okIa(BONS));
    const r = await engine.gerarTitulos({ fatos: FATOS, aiProvider: p });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.ok(r.sugestoes.length >= 4 && r.sugestoes.length <= 6, String(r.sugestoes.length));
    for (let i = 1; i < r.sugestoes.length; i++) assert.ok(r.sugestoes[i - 1].score >= r.sugestoes[i].score);
    for (const s of r.sugestoes) {
      const chaves = Object.keys(s).filter((k) => k !== "complemento").sort();
      assert.deepStrictEqual(chaves, ["breakdown", "chars", "score", "titulo"]);
      assert.strictEqual(s.chars, s.titulo.length);
      if (s.complemento) assert.ok(Array.isArray(s.complemento) && s.complemento.length);
    }
    assert.strictEqual(r.limite, 60);
    assert.strictEqual(r.recebidos, 8);
    assert.ok(!JSON.stringify(r).match(/vencedor|melhor|recomendad|winner|best/i));
    assert.strictEqual(p.chamadas.length, 1, "uma chamada ao LLM por clique");
  });

  await check("F6 — a chamada ao aiProvider informa a task seo_title", async () => {
    const p = providerCom(okIa(BONS));
    await engine.gerarTitulos({ fatos: FATOS, aiProvider: p });
    assert.strictEqual(p.chamadas[0].task, "seo_title");
  });

  await check("o prompt traz só fatos (sem SKU), pede 8 títulos e NÃO pede nota", async () => {
    const p = providerCom(okIa(BONS));
    await engine.gerarTitulos({ fatos: FATOS, aiProvider: p });
    const { prompt, system } = p.chamadas[0];
    assert.ok(/8 títulos/.test(prompt));
    assert.ok(prompt.includes("Molekinho") && prompt.includes("Cadarço") && prompt.includes("Meninos"));
    assert.ok(!prompt.includes("MK-2103-AZ"), "SKU não é fato de título");
    assert.ok(/"titulos"/.test(prompt));
    assert.ok(!/"score"|nota de 0|0 a 100/i.test(prompt + system), "o LLM não pode ser chamado a dar nota");
    assert.ok(/impermeável/i.test(prompt), "o prompt avisa o que NÃO é verdade sobre o produto");
  });

  await check("o que o LLM devolver além dos títulos (score, melhor) é ignorado", async () => {
    const p = providerCom(okIa(BONS.slice(0, 5), { score: [100, 99], melhor: 0, ranking: [4, 3] }));
    const r = await engine.gerarTitulos({ fatos: FATOS, aiProvider: p });
    assert.strictEqual(r.ok, true);
    assert.ok(r.sugestoes.every((s) => s.score === avaliar(s.titulo).score), "score tem que ser o calculado pelo código");
    const comObjetos = providerCom(okIa(BONS.slice(0, 4).map((t) => ({ titulo: t, score: 100 }))));
    const r2 = await engine.gerarTitulos({ fatos: FATOS, aiProvider: comObjetos });
    assert.strictEqual(r2.ok, true, JSON.stringify(r2));
    assert.ok(r2.sugestoes.every((s) => s.score === avaliar(s.titulo).score));
  });

  await check("menos válidos que o esperado: devolve só os válidos (3), conta descartes, não inventa", async () => {
    const p = providerCom(okIa([
      BONS[0], BONS[1], BONS[2],
      "Tênis Nike Infantil Masculino",                                    // marca errada
      "Tênis Molekinho Confortável Casual",                               // claim
      "Tênis Molekinho Nike Adidas Puma Infantil Masculino Casual Cadarço Azul", // longo + marcas
    ]));
    const r = await engine.gerarTitulos({ fatos: FATOS, aiProvider: p });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.sugestoes.length, 3);
    assert.strictEqual(r.descartadas, 3);
    assert.deepStrictEqual(r.motivosDescarte, { NAO_COMPROVADO: 3 }, "recortado e ainda inválido: o motivo é o do recorte");
    assert.ok(/3/.test(r.aviso));
  });

  await check("recorte: acima do limite tira palavras do FIM até caber, sem conectivo solto", () => {
    assert.strictEqual(engine.recortarAoLimite("Tênis Molekinho Casual", 60), "Tênis Molekinho Casual");
    assert.strictEqual(
      engine.recortarAoLimite("Tênis Infantil Masculino Molekinho 2103 Casual Escolar Cadarço Azul Borracha", 60),
      "Tênis Infantil Masculino Molekinho 2103 Casual Escolar");
    assert.strictEqual(engine.recortarAoLimite("Tênis Molekinho Casual com Cadarço", 26), "Tênis Molekinho Casual");
    assert.strictEqual(engine.recortarAoLimite("Tênis Molekinho Casual - Azul", 25), "Tênis Molekinho Casual");
    assert.strictEqual(engine.recortarAoLimite("Supercalifragilístico", 5), null);
    // número órfão da unidade cortada não fica no fim
    assert.strictEqual(engine.recortarAoLimite("Saia Box Casal Poliéster 1,6 m", 27), "Saia Box Casal Poliéster");
    assert.strictEqual(engine.recortarAoLimite("Cortina Blackout Liso 2 x 3 m", 25), "Cortina Blackout Liso");
  });

  await check("recorte em gerarTitulos: longo vira sugestão válida (conta em 'recortados'), nunca acrescenta palavra", async () => {
    const longo = "Tênis Infantil Masculino Molekinho 2103 Casual Escolar Cadarço Azul Borracha";
    const p = providerCom(okIa([longo]));
    const r = await engine.gerarTitulos({ fatos: FATOS, aiProvider: p });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.strictEqual(r.recortados, 1);
    assert.ok(!r.motivosDescarte.EXCEDE_LIMITE);
    const s = r.sugestoes[0];
    assert.ok(s.chars <= 60);
    assert.ok(s.titulo.startsWith("Tênis Infantil Masculino Molekinho 2103 Casual Escolar"));
    const original = new Set(longo.split(" "));
    for (const w of s.titulo.split(" ")) {
      assert.ok(original.has(w) || (s.complemento || []).join(" ").split(" ").includes(w), "palavra nova fora do complemento: " + w);
    }
  });

  await check("candidatos duplicados (iguais, com acento/caixa ou só reordenados) viram um", async () => {
    const p = providerCom(okIa([
      BONS[1],
      BONS[1].toUpperCase(),
      "Tenis Infantil Masculino Molekinho Casual Cadarco Azul",
      "Tênis Molekinho Infantil Masculino Casual Cadarço Azul",
      BONS[0],
    ]));
    const r = await engine.gerarTitulos({ fatos: FATOS, aiProvider: p });
    assert.strictEqual(r.sugestoes.length, 2, JSON.stringify(r.sugestoes.map((s) => s.titulo)));
    assert.strictEqual(r.motivosDescarte.DUPLICADO, 3);
  });

  await check("nenhum válido → ok:false SEM_SUGESTOES_VALIDAS (nunca devolve inválido)", async () => {
    const p = providerCom(okIa(["Tênis Nike Air", "Tênis Adidas Infantil"]));
    const r = await engine.gerarTitulos({ fatos: FATOS, aiProvider: p });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.codigo, "SEM_SUGESTOES_VALIDAS");
    assert.strictEqual(r.descartadas, 2);
    assert.ok(!("sugestoes" in r) || r.sugestoes.length === 0);
  });

  await check("JSON sem 'titulos' (ou não-array) → RESPOSTA_INVALIDA", async () => {
    for (const data of [{}, { titulos: "um título" }, { titles: BONS }, null]) {
      const r = await engine.gerarTitulos({ fatos: FATOS, aiProvider: providerCom({ ok: true, data }) });
      assert.strictEqual(r.ok, false);
      assert.strictEqual(r.codigo, "RESPOSTA_INVALIDA");
    }
  });

  await check("erros do provider passam distinguíveis: JSON_INVALIDO, AI_RESPONSE_TRUNCATED, TIMEOUT, HTTP_529", async () => {
    for (const codigo of ["JSON_INVALIDO", "AI_RESPONSE_TRUNCATED", "TIMEOUT", "HTTP_529", "NO_API_KEY"]) {
      const r = await engine.gerarTitulos({ fatos: FATOS, aiProvider: providerCom({ ok: false, codigo, erro: "falhou: " + codigo }) });
      assert.strictEqual(r.ok, false);
      assert.strictEqual(r.codigo, codigo);
      assert.ok(r.motivo.includes(codigo));
    }
  });

  await check("provider que lança exceção vira erro estruturado (nunca derruba a rota)", async () => {
    const r = await engine.gerarTitulos({ fatos: FATOS, aiProvider: { async gerarJSON() { throw new Error("boom"); } } });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.codigo, "IA_ERRO");
  });

  // ── COMPLEMENTO PÓS-GERAÇÃO (Termos Complementares/F4R) ───────────────────
  await check("complemento: título curto ganha fatos ainda não cobertos, sem passar do limite", () => {
    const r = avaliar("Tênis Infantil Molekinho Escolar Casual Azul");
    const c = engine.completarTitulo(r, FATOS);
    assert.ok(c.termos.length > 0);
    assert.ok(c.avaliado.valido);
    assert.ok(c.avaliado.chars <= 60 && c.avaliado.chars > r.chars);
    assert.ok(c.avaliado.titulo.startsWith(r.titulo + " "), "o título do LLM é mantido; o complemento vai no fim");
    assert.ok(c.avaliado.score >= r.score);
  });

  await check("complemento: combinação mais próxima de 60 vence a gulosa (Molekinho > Casual)", () => {
    // Casual (52) bloqueava Molekinho/Borracha; Molekinho sozinho chega a 55.
    const r = avaliar("Tênis Infantil Escolar Masculino Cadarço Azul");
    const c = engine.completarTitulo(r, FATOS);
    assert.deepStrictEqual(c.termos, ["Molekinho"]);
    assert.strictEqual(c.avaliado.chars, 55);
  });

  await check("complemento: só fatos estruturados — nunca SKU, atributo 'Não', gênero oposto ou filler", () => {
    for (const t of ["Tênis Molekinho", "Tênis Infantil Escolar Azul", "Tênis Infantil Molekinho Escolar Casual Azul"]) {
      const c = engine.completarTitulo(avaliar(t), FATOS);
      const add = c.termos.join(" ").toLowerCase();
      assert.ok(!/mk-2103|impermeável|feminino|menina|peso/.test(add), add);
      assert.strictEqual(avaliar(c.avaliado.titulo).valido, true);
    }
  });

  await check("complemento: sem fato sobrando, o título fica como está (não completa por completar)", () => {
    const f = engine.montarFatos(anuncio({ attributes_json: [{ id: "BRAND", name: "Marca", value: "Molekinho" }] }),
      { categoriaNome: "Tênis", limite: 60 });
    const r = engine.avaliarTitulo("Tênis Molekinho", f);
    const c = engine.completarTitulo(r, f);
    assert.deepStrictEqual(c.termos, []);
    assert.strictEqual(c.avaliado, r);
  });

  await check("complemento: grafia original do fato volta (110v → 110V) e segue o estilo do título base", () => {
    assert.strictEqual(engine.formaDeTitulo("110v", ["Bivolt 110V/220V"]), "110V");
    assert.strictEqual(engine.formaDeTitulo("azul marinho", ["azul marinho"]), "Azul Marinho");
    assert.strictEqual(engine.formaDeTitulo("sola de borracha", []), "Sola de Borracha");
    // título em frase ("Adaptador de rede usb…"): o termo entra minúsculo, sigla mantém
    assert.strictEqual(engine.formaDeTitulo("plástico", ["Plástico"], { estiloTitulo: false }), "plástico");
    assert.strictEqual(engine.formaDeTitulo("gg", ["GG"], { estiloTitulo: false }), "GG");
    // marca mantém a grafia dela em qualquer estilo
    assert.strictEqual(engine.formaDeTitulo("grupo fernandes", ["Grupo Fernandes"], { estiloTitulo: false, marca: true }), "Grupo Fernandes");
  });

  await check("complemento: só atributo que define o produto — acessório (Sem Validade, Hazmat, tampa) e categoria ficam fora", () => {
    const f = engine.montarFatos(anuncio({
      titulo: "Cesto de Papéis com Pedal",
      attributes_json: [
        { id: "BRAND", name: "Marca", value: "JSN" },
        { id: "PRODUCT_FEATURES", name: "Características do produto", value: "Sem validade" },
        { id: "HAZMAT_TRANSPORTABILITY", name: "Transportabilidade Hazmat", value: "Livre" },
        { id: "LID_MATERIAL", name: "Material da tampa", value: "Plástico" },
        { id: "COLOR", name: "Cor", value: "Branco" },
      ],
    }), { categoriaNome: "Lixeiras Manuais", limite: 60 });
    const c = engine.completarTitulo(engine.avaliarTitulo("Cesto de Papéis com Pedal", f), f);
    assert.deepStrictEqual(c.termos.slice().sort(), ["Branco", "JSN"], JSON.stringify(c.termos));
  });

  await check("complemento: medida já escrita colada no título ('240gb') não é repetida ('240 GB')", () => {
    const f = engine.montarFatos(anuncio({
      titulo: "SSD NTC 240gb",
      attributes_json: [{ id: "BRAND", name: "Marca", value: "NTC" }, { id: "CAPACITY", name: "Capacidade", value: "240 GB" }],
    }), { categoriaNome: "Discos SSD", limite: 60 });
    const c = engine.completarTitulo(engine.avaliarTitulo("SSD NTC 240gb", f), f);
    assert.ok(!c.termos.includes("240 GB"), JSON.stringify(c.termos));
  });

  await check("complemento: medida solta sem rótulo (63 cm, 640 g) NÃO entra; tensão/capacidade entram", () => {
    const base = (attrs) => engine.montarFatos(anuncio({
      titulo: "Lixeira Plástica Quadrada com Pedal Branca",
      attributes_json: [{ id: "BRAND", name: "Marca", value: "JSN" }, ...attrs],
    }), { categoriaNome: "Lixeiras", limite: 60 });
    const f1 = base([{ id: "HEIGHT", name: "Altura", value: "63 cm" }, { id: "WEIGHT", name: "Peso", value: "640 g" }]);
    const c1 = engine.completarTitulo(engine.avaliarTitulo("Lixeira Plástica Quadrada com Pedal", f1), f1);
    assert.ok(!c1.termos.some((t) => /\d/.test(t)), JSON.stringify(c1.termos));
    const f2 = base([{ id: "CAPACITY", name: "Capacidade", value: "60 L" }]);
    const c2 = engine.completarTitulo(engine.avaliarTitulo("Lixeira Plástica Quadrada com Pedal", f2), f2);
    assert.ok(c2.termos.includes("60 L"), JSON.stringify(c2.termos));
  });

  await check("gerarTitulos: sugestões completadas trazem 'complemento' e score do título final", async () => {
    const p = providerCom(okIa(["Tênis Infantil Escolar Masculino Cadarço Azul", BONS[0]]));
    const r = await engine.gerarTitulos({ fatos: FATOS, aiProvider: p });
    const curto = r.sugestoes.find((s) => s.titulo.startsWith("Tênis Infantil Escolar Masculino Cadarço Azul"));
    assert.ok(curto && curto.complemento && curto.chars >= 55, JSON.stringify(r.sugestoes));
    for (const s of r.sugestoes) assert.strictEqual(s.score, avaliar(s.titulo).score);
  });

  await check("desempate NÃO prefere o mais curto: mesmo score → mais relevância/cobertura/espaço", async () => {
    // Mesma assinatura (plural) e breakdown idêntico, tamanhos 23 e 25: antes
    // sobrevivia o mais curto; agora sobrevive o que aproveita mais espaço.
    // Ficha só com BRAND → nada a complementar, o tamanho é o do LLM.
    const p = providerCom(okIa(["Tênis Molekinho Escolar", "Tênis Molekinho Escolares"]));
    const f = engine.montarFatos(anuncio({ attributes_json: [{ id: "BRAND", name: "Marca", value: "Molekinho" }] }),
      { categoriaNome: "Tênis", limite: 60 });
    const [a, b] = ["Tênis Molekinho Escolar", "Tênis Molekinho Escolares"].map((t) => engine.avaliarTitulo(t, f));
    assert.deepStrictEqual(a.breakdown, b.breakdown, "pré-condição: empate total no score");
    const r = await engine.gerarTitulos({ fatos: f, aiProvider: p });
    assert.deepStrictEqual(r.sugestoes.map((s) => s.titulo), ["Tênis Molekinho Escolares"]);
    assert.strictEqual(r.motivosDescarte.DUPLICADO, 1);
  });

  await check("prompt pede a faixa do limite (55–60, ideal 57–60) e proíbe preencher sem fato", async () => {
    const p = providerCom(okIa(BONS));
    await engine.gerarTitulos({ fatos: FATOS, aiProvider: p });
    assert.ok(/entre 55 e 60/.test(p.chamadas[0].prompt));
    assert.ok(/57 a 60/.test(p.chamadas[0].prompt));
    assert.ok(/nunca palavras sem fato/.test(p.chamadas[0].prompt));
  });

  if (falhas) { console.error(`\n${falhas}/${total} falha(s)`); process.exit(1); }
  console.log(`\n✓ tituloEngine ok (${total} verificações)`);
})();
