// server/tests/descricaoEngine.test.js
//
// Description Engine (SEO ML · F5) isolado: ficha factual, prompt, validação
// determinística e gerarDescricao com aiProvider SIMULADO (nunca a Anthropic
// real). Uma sugestão por chamada, sem score.

const assert = require("assert");
const engine = require("../services/meliAnuncios/seo/descricaoEngine");

function anuncio(over = {}) {
  return {
    item_id: "MLB-A",
    titulo: "Tênis Infantil Molekinho Cadarço Azul",
    marca: "Molekinho",
    attributes_json: [
      { id: "BRAND", name: "Marca", value: "Molekinho" },
      { id: "MODEL", name: "Modelo", value: "2024" },
      { id: "GENDER", name: "Gênero", value: "Meninos" },
      { id: "CLOSURE_TYPE", name: "Tipo de fechamento", value: "Cadarço" },
      { id: "MAIN_MATERIAL", name: "Material principal", value: "Sintético" },
      { id: "COLOR", name: "Cor", value: "Azul Marinho" },
      { id: "IS_WATERPROOF", name: "É impermeável", value: "Não" },
      { id: "WITH_LIGHTS", name: "Com luzes", value: "Sim" },
      { id: "SELLER_SKU", name: "SKU", value: "MK-998877" },
    ],
    ...over,
  };
}
const DESC_ATUAL = "Tênis confortável para o dia a dia escolar. Solado de borracha antiderrapante com 2 cm de altura.";
function ficha(over = {}, opts = {}) {
  return engine.montarFicha(anuncio(over), {
    categoriaNome: "Tênis",
    limiteCategoria: 50000,
    descricaoAtual: DESC_ATUAL,
    descricaoEstado: "ok",
    ...opts,
  });
}
const BOA = [
  "Tênis infantil Molekinho para meninos, pensado para o dia a dia escolar.",
  "",
  "O fechamento por cadarço permite ajustar o calçado ao pé, e o material sintético facilita a limpeza. " +
    "O solado de borracha antiderrapante tem 2 cm de altura.",
  "",
  "Na cor azul marinho, com luzes. Não é impermeável.",
].join("\n");
const USADOS = ["brand", "attr:GENDER", "attr:CLOSURE_TYPE", "attr:MAIN_MATERIAL", "contexto:descricao_atual"];
const codigos = (v) => (v.problemas || []).map((p) => p.codigo);
const valida = (texto, f = ficha(), usados = USADOS) => engine.validarDescricao(texto, usados, f);

function provider(resposta) {
  const chamadas = [];
  return {
    chamadas,
    async gerarJSON(opts) {
      chamadas.push(opts);
      if (typeof resposta === "function") return resposta(opts);
      return resposta;
    },
  };
}

let checks = 0;
function ok(msg) { checks += 1; console.log(`  ✓ ${msg}`); }

async function run() {
  console.log("descricaoEngine");

  // 1 ─ fatos estruturados chegam ao prompt, com ID estável
  {
    const f = ficha();
    const p = engine.montarPrompt(f);
    for (const linha of [
      "[brand] Marca: Molekinho", "[model] Modelo: 2024", "[attr:GENDER] Gênero: Meninos",
      "[attr:CLOSURE_TYPE] Tipo de fechamento: Cadarço", "[attr:COLOR] Cor: Azul Marinho",
      "[categoria] Categoria: Tênis", "[attr:WITH_LIGHTS] Com luzes: Sim",
    ]) assert.ok(p.includes(linha), "faltou no prompt: " + linha);
    assert.ok(!p.includes("MK-998877"), "SKU não é fato do produto");
    assert.ok(p.includes("SE UMA INFORMAÇÃO NÃO ESTIVER NOS FATOS OU NO CONTEXTO AUTORIZADO, NÃO INVENTE") ||
      engine.SYSTEM.includes("SE UMA INFORMAÇÃO NÃO ESTIVER NOS FATOS OU NO CONTEXTO AUTORIZADO, NÃO INVENTE"));
    assert.ok(!/score|ranking|palavras?-chave|keywords?|volume de busca/i.test(p + engine.SYSTEM), "nada de score/keywords");
    assert.deepStrictEqual(f.fatos.filter((x) => x.grupo === "forte").map((x) => x.id),
      ["brand", "model", "attr:GENDER", "attr:CLOSURE_TYPE", "attr:MAIN_MATERIAL", "attr:COLOR"]);
    assert.deepStrictEqual(f.fatos.filter((x) => x.grupo === "secundario").map((x) => x.id), ["attr:WITH_LIGHTS"]);
    ok("1. fatos fortes/secundários chegam ao prompt com ID; SKU fora; regra NÃO INVENTE; sem score/keywords");
  }

  // 1b ─ MODEL legado (lista de palavras-chave) não vira fato
  {
    const f = ficha({ attributes_json: [
      { id: "BRAND", name: "Marca", value: "Molekinho" },
      { id: "MODEL", name: "Modelo", value: "tenis, infantil, menino, escolar, barato, promoção" },
    ] });
    assert.ok(!f.fatos.some((x) => x.id === "model"));
    assert.ok(!engine.montarPrompt(f).includes("barato"), "lista de stuffing não vai ao prompt");
    ok("1b. MODEL com cara de keyword stuffing legado não é fato e não vai ao prompt");
  }

  // 2 ─ descrição atual chega ao prompt como contexto fraco
  {
    const p = engine.montarPrompt(ficha());
    assert.ok(p.includes("[contexto:descricao_atual]"));
    assert.ok(p.includes(DESC_ATUAL));
    assert.ok(p.indexOf("CONTEXTO (mais fraco que os fatos") > p.indexOf("FATOS PRINCIPAIS"));
    ok("2. descrição atual chega ao prompt, rotulada como contexto mais fraco que os fatos");
  }

  // 3 ─ ausência de descrição atual
  {
    const f = ficha({}, { descricaoAtual: null, descricaoEstado: "sem_descricao" });
    assert.deepStrictEqual(f.descricaoAtual, { estado: "sem_descricao", texto: null });
    const p = engine.montarPrompt(f);
    assert.ok(p.includes("Descrição atual: (o anúncio não tem descrição hoje)"));
    assert.ok(!f.idsConhecidos.has("contexto:descricao_atual"));
    const fErro = ficha({}, { descricaoAtual: null, descricaoEstado: "erro" });
    assert.strictEqual(fErro.descricaoAtual.estado, "erro", "erro de leitura ≠ sem descrição");
    const prov = provider({ ok: true, data: { descricao: BOA, fatosUsados: [] } });
    const r = await engine.gerarDescricao({ ficha: fErro, aiProvider: prov });
    assert.deepStrictEqual([r.ok, r.codigo, prov.chamadas.length], [false, "DESCRICAO_ATUAL_INDISPONIVEL", 0]);
    ok("3. sem descrição = 'não tem descrição hoje'; leitura com erro = recusa sem chamar a IA");
  }

  // 4 ─ booleano "Não" vira proibido
  {
    const f = ficha();
    const p = f.proibidos.find((x) => x.id === "attr:IS_WATERPROOF");
    assert.ok(p && p.motivo === "ATRIBUTO_NEGADO" && p.exibir[0] === "impermeável", JSON.stringify(f.proibidos));
    assert.ok(engine.montarPrompt(f).includes("nunca escreva: impermeável"));
    assert.ok(codigos(valida("Tênis infantil Molekinho impermeável, para meninos.")).includes("ATRIBUTO_PROIBIDO"));
    assert.ok(!codigos(valida("Tênis infantil Molekinho para meninos. Não é impermeável.")).includes("ATRIBUTO_PROIBIDO"),
      "negar o atributo é a informação correta");
    ok("4. 'É impermeável: Não' → proibido no prompt; afirmar 'impermeável' invalida; 'não é impermeável' passa");
  }

  // 5 ─ GENDER conflitante
  {
    const f = ficha();
    const g = f.proibidos.find((x) => x.id === "attr:GENDER");
    assert.deepStrictEqual(g.exibir.slice().sort(), ["feminino", "homem", "menina", "mulher"]);
    const v = valida("Tênis Molekinho masculino, ideal para homens.");
    assert.ok(codigos(v).includes("ATRIBUTO_PROIBIDO"));
    assert.ok(v.problemas.find((x) => x.codigo === "ATRIBUTO_PROIBIDO").termos.includes("homem"));
    assert.ok(!codigos(valida("Tênis Molekinho para meninos.")).includes("ATRIBUTO_PROIBIDO"));
    ok("5. GENDER=Meninos proíbe homem/mulher/menina/feminino (tabela do fatosProduto)");
  }

  // 6 ─ marca errada
  {
    const f = ficha();
    assert.deepStrictEqual(codigos(valida("Tênis da marca Adidas para meninos.", f, ["brand"])), ["MARCA_CONFLITANTE"]);
    assert.ok(codigos(valida("Tênis para meninos, no estilo Nike Air.", f, ["brand"])).includes("NOME_NAO_COMPROVADO"));
    assert.strictEqual(valida("Tênis da marca Molekinho para meninos.", f, ["brand"]).valida, true);
    ok("6. outra marca ('marca Adidas', 'Nike Air' no meio da frase) invalida; a marca da ficha passa");
  }

  // 6b ─ marca / nome próprio em QUALQUER posição (início, meio, fim, depois
  // de quebra de linha ou pontuação, qualquer caixa)
  {
    const f = ficha();
    const cod = (t, fx = f) => codigos(engine.validarDescricao(t, ["brand"], fx));
    // A) marca inventada abrindo a descrição
    for (const t of [
      "Nike oferece um tênis para meninos.",
      "Samsung ideal para o dia a dia escolar.",
      "Nike desenvolvido para meninos.",
      "Nike modelo infantil para meninos.",
      "NIKE para meninos.",
      "Tênis para meninos.\nNike apresenta o cadarço.",
      "Tênis para meninos. Olympikus oferece cadarço.",
      "Tênis para meninos; Adidas oferece cadarço.",
    ]) assert.ok(cod(t).includes("MARCA_CONFLITANTE"), t + " → " + cod(t));
    // D) / E) padrões explícitos, inclusive em minúsculas depois de "marca"
    for (const t of [
      "Marca Nike, para meninos.",
      "Tênis da marca nike para meninos.",
      "Produto da Nike para meninos.",
      "Tênis fabricado pela Adidas.",
      "Tênis infantil, produto Olympikus.",
      "Tênis para meninos da Adidas",
    ]) assert.ok(cod(t).includes("MARCA_CONFLITANTE"), t + " → " + cod(t));
    // B) a marca da ficha em qualquer posição e caixa
    for (const t of [
      "O tênis Molekinho é pensado para meninos.",
      "Molekinho oferece um tênis para meninos.",
      "MOLEKINHO para meninos.",
      "Tênis da marca molekinho para meninos.",
      "Produto da Molekinho para meninos.",
    ]) assert.strictEqual(engine.validarDescricao(t, ["brand"], f).valida, true, t + " → " + cod(t));
    // C) palavras comuns abrindo frase não são marca
    for (const t of [
      "Este tênis foi desenvolvido para meninos.",
      "O tênis tem fechamento por cadarço.",
      "Desenvolvido para o dia a dia escolar.",
      "Ideal para o dia a dia escolar.",
      "Com fechamento por cadarço.",
      "Possui fechamento por cadarço.",
      "Kit com tênis Molekinho para meninos.",
      "Tênis ideal para o dia a dia escolar.",
    ]) assert.strictEqual(engine.validarDescricao(t, ["brand"], f).valida, true, t + " → " + cod(t));
    ok("6b. A/B/C/D/E — marca inventada vale em qualquer posição/caixa; marca da ficha e palavras comuns no início passam");

    // F) descrição atual com Nike NÃO autoriza Nike (fato estruturado vence)
    const fNike = ficha({}, { descricaoAtual: "Tênis confortável, no estilo da Nike, para o dia a dia escolar dos meninos.", descricaoEstado: "ok" });
    assert.ok(fNike.vocabularioFraco.has("nike") && !fNike.nomesAutorizados.has("nike"));
    for (const t of ["Nike oferece um tênis para meninos.", "Tênis para meninos no estilo da Nike.", "Tênis inspirado em Nike para meninos."]) {
      assert.strictEqual(engine.validarDescricao(t, ["brand"], fNike).valida, false, t);
    }
    ok("6c. F — 'Nike' na descrição atual não autoriza 'Nike' na nova com BRAND = Molekinho");

    // G) sem BRAND: palavra capitalizada comum no início passa; nome
    // inventado (posição de marca / grafia estrangeira) sem contexto não passa;
    // nome presente no título/descrição atual passa (sem marca estruturada,
    // o contexto do vendedor é a única referência).
    const semMarca = engine.montarFicha(
      { titulo: "Tênis Infantil Zentrix Cadarço", attributes_json: [
        { id: "GENDER", name: "Gênero", value: "Meninos" }, { id: "CLOSURE_TYPE", name: "Tipo de fechamento", value: "Cadarço" }] },
      { categoriaNome: "Tênis", descricaoEstado: "sem_descricao" });
    assert.strictEqual(semMarca.marca, null);
    const v = (t) => engine.validarDescricao(t, [], semMarca);
    assert.strictEqual(v("Desenvolvido para meninos, com fechamento por cadarço.").valida, true);
    assert.strictEqual(v("Este tênis tem fechamento por cadarço.").valida, true);
    assert.deepStrictEqual(codigos(v("Kombat oferece um tênis para meninos.")), ["NOME_NAO_COMPROVADO"]);
    assert.deepStrictEqual(codigos(v("Nike para meninos, com cadarço.")), ["NOME_NAO_COMPROVADO"]);
    assert.deepStrictEqual(codigos(v("Tênis da marca Kombat.")), ["NOME_NAO_COMPROVADO"]);
    assert.strictEqual(v("Zentrix oferece um tênis para meninos.").valida, true, "nome do título do vendedor, sem BRAND conflitante");
    ok("6d. G — sem BRAND: começo comum passa; nome inventado vira NOME_NAO_COMPROVADO (nunca MARCA_CONFLITANTE); nome do título passa");

    // H) LINE / MODEL factual abrindo a frase
    const fLinha = ficha({ attributes_json: [
      { id: "BRAND", name: "Marca", value: "Molekinho" },
      { id: "MODEL", name: "Modelo", value: "Kids Runner" },
      { id: "LINE", name: "Linha", value: "Street Hype" },
      { id: "CLOSURE_TYPE", name: "Tipo de fechamento", value: "Cadarço" },
    ] });
    for (const t of [
      "Street Hype é a linha infantil da Molekinho.",
      "Kids Runner traz fechamento por cadarço.",
      "Tênis da linha Street Hype, modelo Kids Runner.",
      "STREET HYPE para meninos.",
    ]) assert.strictEqual(engine.validarDescricao(t, ["attr:LINE", "model"], fLinha).valida, true, t + " → " + codigos(engine.validarDescricao(t, [], fLinha)));
    assert.ok(codigos(engine.validarDescricao("Tênis da linha Air Max.", [], fLinha)).includes("MARCA_CONFLITANTE"),
      "linha inventada em posição de marca também não passa");
    ok("6e. H — LINE e MODEL factuais passam no início da frase e em caixa alta; linha inventada não");
  }

  // 7 / 8 ─ números
  {
    const v = valida("Tênis Molekinho para meninos com 3 cm de solado, 12V e 500 ml.");
    assert.ok(codigos(v).includes("NUMERO_NAO_COMPROVADO"));
    assert.deepStrictEqual(v.problemas.find((x) => x.codigo === "NUMERO_NAO_COMPROVADO").termos, ["3", "12", "500"]);
    assert.ok(codigos(valida("Kit Molekinho com três unidades.")).includes("NUMERO_NAO_COMPROVADO"));
    ok("7. número/medida inventado (3 cm, 12V, 500 ml, 'três unidades') invalida");

    assert.strictEqual(valida("Tênis Molekinho 2024 para meninos, solado com 2 cm de altura.").valida, true);
    const f = ficha({ attributes_json: [
      { id: "BRAND", name: "Marca", value: "Molekinho" },
      { id: "VOLTAGE", name: "Voltagem", value: "220V" },
      { id: "CAPACITY", name: "Capacidade", value: "1,5 L" },
      { id: "UNITS_PER_PACK", name: "Unidades por kit", value: "2" },
    ] });
    assert.strictEqual(engine.validarDescricao("Chaleira Molekinho 220V com 1.5 L, kit com duas unidades.", ["brand"], f).valida, true);
    ok("8. número presente nos fatos/descrição atual (2 cm, 2024, 220V, 1,5 L, 'duas unidades') passa");
  }

  // 9 / 10 / 11 ─ URL, e-mail, telefone
  {
    assert.ok(codigos(valida("Veja mais em www.molekinho.com.br.")).includes("URL"));
    assert.ok(codigos(valida("Veja https://exemplo.com")).includes("URL"));
    ok("9. URL invalida");
    assert.ok(codigos(valida("Dúvidas: contato@molekinho.com")).includes("EMAIL"));
    ok("10. e-mail invalida");
    assert.ok(codigos(valida("Ligue (11) 98765-4321.")).includes("TELEFONE"));
    assert.ok(codigos(valida("Chame no WhatsApp para saber mais.")).includes("CONTATO_EXTERNO"));
    ok("11. telefone invalida (e WhatsApp/contato externo também)");
  }

  // 12 ─ linguagem promocional, logística, garantia, voz da loja, chatbot
  {
    for (const [frase, codigo] of [
      ["Descubra a combinação perfeita para meninos.", "LINGUAGEM_PROIBIDA"],
      ["Produto incrível da Molekinho.", "LINGUAGEM_PROIBIDA"],
      ["Qualidade incomparável.", "LINGUAGEM_PROIBIDA"],
      ["Imperdível.", "LINGUAGEM_PROIBIDA"],
      ["A melhor escolha para meninos.", "LINGUAGEM_PROIBIDA"],
      ["Frete grátis para todo o Brasil.", "LINGUAGEM_PROIBIDA"],
      ["Garantia de 90 dias.", "LINGUAGEM_PROIBIDA"],
      ["Aqui está a descrição do tênis.", "LINGUAGEM_PROIBIDA"],
      ["Tênis Molekinho. Ótimo! Lindo! Confira!", "LINGUAGEM_PROIBIDA"],
      ["Na nossa loja você encontra o tênis Molekinho.", "VOZ_DA_LOJA"],
      ["<b>Tênis</b> Molekinho", "FORMATACAO_INVALIDA"],
      ["**Tênis** Molekinho", "FORMATACAO_INVALIDA"],
    ]) assert.ok(codigos(valida(frase)).includes(codigo), frase + " → " + codigos(valida(frase)));
    assert.strictEqual(valida("Tênis Molekinho para usar nos dias de escola.").valida, true, "'nos' (em+os) não é voz da loja");
    const fPremium = ficha({ attributes_json: [
      { id: "BRAND", name: "Marca", value: "Molekinho" },
      { id: "LINE", name: "Linha", value: "Premium" },
    ] });
    assert.strictEqual(engine.validarDescricao("Tênis Molekinho da linha Premium.", ["attr:LINE"], fPremium).valida, true,
      "termo que é VALOR de um fato não é promocional");
    ok("12. promocional/frete/garantia/chatbot/'nossa loja'/HTML/markdown invalidam; 'Premium' de fato passa");
  }

  // 13 ─ fatoUsado desconhecido
  {
    const v = valida(BOA, ficha(), ["brand", "attr:INVENTADO"]);
    assert.deepStrictEqual(codigos(v), ["FATO_DESCONHECIDO"]);
    assert.deepStrictEqual(v.problemas[0].termos, ["attr:INVENTADO"]);
    assert.deepStrictEqual(codigos(valida(BOA, ficha(), "brand")), ["FATOS_USADOS_INVALIDOS"]);
    assert.strictEqual(valida(BOA, ficha(), ["attr:IS_WATERPROOF", "categoria", "contexto:titulo"]).valida, true,
      "ID de proibido, categoria e contexto também são conhecidos");
    ok("13. fatoUsado desconhecido → FATO_DESCONHECIDO; lista ausente → FATOS_USADOS_INVALIDOS");
  }

  // 14 ─ resposta vazia
  {
    assert.deepStrictEqual(codigos(valida("   \n  ")), ["VAZIA"]);
    const r = await engine.gerarDescricao({ ficha: ficha(), aiProvider: provider({ ok: true, data: { descricao: "", fatosUsados: [] } }) });
    assert.deepStrictEqual([r.ok, r.codigo], [false, "DESCRICAO_INVALIDA"]);
    assert.deepStrictEqual(r.problemas.map((p) => p.codigo), ["VAZIA"]);
    ok("14. resposta vazia → VAZIA / DESCRICAO_INVALIDA");
  }

  // 15 ─ acima do limite
  {
    const longa = (BOA + "\n").repeat(12);
    const f = ficha();
    assert.strictEqual(f.limite, engine.TETO_OPERACIONAL, "categoria com 50.000 → teto operacional");
    assert.ok(codigos(valida(longa, f)).includes("EXCEDE_LIMITE"));
    const fCurta = ficha({}, { limiteCategoria: 200 });
    assert.strictEqual(fCurta.limite, 200, "limite da categoria menor que o teto vale");
    assert.ok(codigos(valida(BOA, fCurta)).includes("EXCEDE_LIMITE"));
    assert.strictEqual(ficha({}, { limiteCategoria: null }).limite, engine.TETO_OPERACIONAL, "sem categoria: fallback 50.000 → teto");
    ok("15. acima do limite (min(categoria, teto 2500); fallback 50.000) → EXCEDE_LIMITE");
  }

  // 16 ─ poucos fatos
  {
    const pobre = engine.montarFicha({ titulo: "Produto", attributes_json: [{ id: "BRAND", name: "Marca", value: "Genérica" }] },
      { categoriaNome: "Tênis", descricaoEstado: "sem_descricao" });
    assert.strictEqual(pobre.suficiente, false);
    const prov = provider({ ok: true, data: { descricao: "x", fatosUsados: [] } });
    const r = await engine.gerarDescricao({ ficha: pobre, aiProvider: prov });
    assert.deepStrictEqual([r.ok, r.codigo, prov.chamadas.length], [false, "FATOS_INSUFICIENTES", 0]);
    const umFatoMaisDescricao = engine.montarFicha(
      { titulo: "Tênis", attributes_json: [{ id: "BRAND", name: "Marca", value: "Molekinho" }] },
      { descricaoAtual: DESC_ATUAL, descricaoEstado: "ok" });
    assert.strictEqual(umFatoMaisDescricao.suficiente, true, "descrição atual real conta como 1 fonte");
    assert.deepStrictEqual(umFatoMaisDescricao.alvo, { min: 300, max: 700 }, "poucos fatos → faixa curta");
    assert.deepStrictEqual(ficha().alvo, { min: 800, max: 2000 }, "muitos fatos → faixa maior");
    ok("16. poucos fatos → FATOS_INSUFICIENTES sem chamar IA; faixa de tamanho proporcional aos fatos");
  }

  // 17 / 18 / 19 ─ erros do provider
  {
    const r1 = await engine.gerarDescricao({ ficha: ficha(), aiProvider: provider({ ok: false, codigo: "HTTP_529", erro: "Overloaded" }) });
    assert.deepStrictEqual([r1.ok, r1.codigo, r1.motivo], [false, "HTTP_529", "Overloaded"]);
    const r1b = await engine.gerarDescricao({ ficha: ficha(), aiProvider: { async gerarJSON() { throw new Error("boom"); } } });
    assert.deepStrictEqual([r1b.ok, r1b.codigo], [false, "IA_ERRO"]);
    ok("17. provider com erro → { ok:false, codigo do provider, motivo }; exceção → IA_ERRO");

    const r2 = await engine.gerarDescricao({ ficha: ficha(), aiProvider: provider({ ok: false, codigo: "JSON_INVALIDO", erro: "A IA não devolveu JSON válido." }) });
    assert.deepStrictEqual([r2.ok, r2.codigo], [false, "JSON_INVALIDO"]);
    const r2b = await engine.gerarDescricao({ ficha: ficha(), aiProvider: provider({ ok: true, data: { texto: "sem campo descricao" } }) });
    assert.deepStrictEqual([r2b.ok, r2b.codigo], [false, "RESPOSTA_INVALIDA"]);
    ok("18. JSON inválido → JSON_INVALIDO; JSON sem 'descricao' → RESPOSTA_INVALIDA");

    const r3 = await engine.gerarDescricao({ ficha: ficha(), aiProvider: provider({ ok: false, codigo: "AI_RESPONSE_TRUNCATED", erro: "cortada" }) });
    assert.deepStrictEqual([r3.ok, r3.codigo], [false, "AI_RESPONSE_TRUNCATED"]);
    assert.ok(/cortada/.test(r3.motivo));
    ok("19. AI_RESPONSE_TRUNCATED propagado com motivo claro");
  }

  // 20 ─ determinismo + caminho feliz
  {
    const f = ficha();
    const antes = JSON.stringify({ ...f, idsConhecidos: [...f.idsConhecidos], nomesAutorizados: [...f.nomesAutorizados], vocabularioFraco: [...f.vocabularioFraco], vocabularioComum: [...f.vocabularioComum], numerosPermitidos: [...f.numerosPermitidos] });
    const ruim = "Descubra o tênis Nike incrível! Para homem. 35 cm. www.x.com";
    const a = JSON.stringify(valida(ruim, f, ["x"]));
    for (let i = 0; i < 5; i += 1) assert.strictEqual(JSON.stringify(valida(ruim, f, ["x"])), a);
    assert.strictEqual(JSON.stringify(valida(BOA, f)), JSON.stringify(valida(BOA, f)));
    const depois = JSON.stringify({ ...f, idsConhecidos: [...f.idsConhecidos], nomesAutorizados: [...f.nomesAutorizados], vocabularioFraco: [...f.vocabularioFraco], vocabularioComum: [...f.vocabularioComum], numerosPermitidos: [...f.numerosPermitidos] });
    assert.strictEqual(depois, antes, "validar não altera a ficha");

    const prov = provider({ ok: true, data: { descricao: "  " + BOA.replace(/\n/g, "\r\n") + "  ", fatosUsados: USADOS.concat(["brand"]) } });
    const r = await engine.gerarDescricao({ ficha: f, aiProvider: prov });
    assert.strictEqual(r.ok, true, JSON.stringify(r));
    assert.deepStrictEqual(Object.keys(r).sort(), ["chars", "descricao", "fatosUsados", "limite", "ok"], "sem score de nenhum tipo");
    assert.strictEqual(r.descricao, BOA, "normaliza CRLF e espaços das pontas");
    assert.deepStrictEqual(r.fatosUsados.map((x) => x.id), USADOS, "IDs deduplicados, na ordem");
    assert.deepStrictEqual(r.fatosUsados[0], { id: "brand", label: "Marca", value: "Molekinho" });
    assert.strictEqual(prov.chamadas.length, 1, "uma chamada por geração");
    assert.ok(prov.chamadas[0].system.includes("NÃO INVENTE") && prov.chamadas[0].prompt.includes("[brand]"));
    ok("20. validação determinística e sem efeito colateral; caminho feliz = 1 chamada, sem score, fatos rastreáveis");
  }

  // extra ─ cópia da ficha técnica
  {
    const lista = "Tênis Molekinho.\nMarca: Molekinho\nCor: Azul Marinho\nGênero: Meninos\nTipo de fechamento: Cadarço";
    assert.ok(codigos(valida(lista)).includes("COPIA_FICHA_TECNICA"));
    assert.ok(codigos(valida("Tênis Molekinho.\nESPECIFICAÇÕES\nAlgo.")).includes("COPIA_FICHA_TECNICA"));
    ok("extra. lista 'Rótulo: valor' da ficha (4+ linhas) ou bloco ESPECIFICAÇÕES → COPIA_FICHA_TECNICA");
  }

  console.log(`\n✓ ${checks} verificações do Description Engine`);
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
