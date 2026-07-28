// server/tests/cliente360Ponte.test.js
// Prova de fechamento do motor PVM da Cliente 360:
//   - a ponte começa e termina no RESULTADO OPERACIONAL;
//   - a ponte NÃO contém linha de Ads (nem em linhas, nem em linhasBrutas);
//   - a soma das linhas = Δresultado operacional (resíduo ≤ R$ 0,01);
//   - a soma das contribuições por produto = Δresultado do detalhe.
//
// Roda sem infra: node tests/cliente360Ponte.test.js

const assert = require("assert");
const {
  montarPonte,
  totaisDoPeriodo,
  agregarProdutos,
  EPS,
} = require("../services/cliente360/cliente360PonteEngine");

// helper: pedido no contrato da Fechamento API com um item
function pedido(mlb, { q, receita, comissao = 0, frete = 0, custo = 0, imposto = 0, status = "pago" }) {
  return {
    id: `${mlb}-${Math.random().toString(36).slice(2, 7)}`,
    status,
    valor: receita,
    frete, taxas: comissao,
    itens: [{
      mlb, titulo: mlb, quantidade: q,
      receitaProduto: receita, custoProduto: custo, impostoInterno: imposto,
    }],
  };
}

let passed = 0;
function check(nome, cond) {
  assert.ok(cond, `FALHOU: ${nome}`);
  passed++;
  console.log(`  ok  ${nome}`);
}

const CHAVES_ADS = ["ads", "tacos", "campanha", "midia", "investimento_ads"];
function temLinhaDeAds(ponte) {
  const todas = [...(ponte.linhas || []), ...(ponte.linhasBrutas || [])];
  return todas.some(
    (l) =>
      CHAVES_ADS.includes(String(l.chave).toLowerCase()) ||
      /\bads\b|tacos|campanha/i.test(String(l.label || ""))
  );
}

// ── Cenário 1: comparável puro, só volume muda ──────────────────────────────
{
  const p0 = [pedido("A", { q: 10, receita: 1000, comissao: 100, frete: 50, custo: 400, imposto: 50 })];
  const p1 = [pedido("A", { q: 20, receita: 2000, comissao: 200, frete: 100, custo: 800, imposto: 100 })];
  const b = montarPonte(p0, p1);
  check("1. volume puro fecha", b.fecha);
  check("1. resíduo ≤ R$ 0,01", Math.abs(b.residuo) <= EPS);
  check("1. volume é linha positiva", b.linhasBrutas.find((l) => l.chave === "volume").impacto > 0);
  const somaContrib = b.produtos.reduce((s, x) => s + x.contribuicao, 0);
  check("1. contribuições fecham com delta", Math.abs(somaContrib - b.delta) <= EPS);
}

// ── Cenário 2: preço sobe, custo sobe, frete sobe (unitários mudam) ─────────
{
  const p0 = [pedido("A", { q: 10, receita: 1000, comissao: 100, frete: 50, custo: 400, imposto: 50 })];
  const p1 = [pedido("A", { q: 10, receita: 1200, comissao: 120, frete: 80, custo: 500, imposto: 60 })];
  const b = montarPonte(p0, p1);
  const linha = (k) => b.linhasBrutas.find((l) => l.chave === k).impacto;
  check("2. mix custo/preço fecha", b.fecha);
  check("2. preço positivo", linha("preco") > 0);
  check("2. custo negativo", linha("custo") < 0);
  check("2. frete negativo", linha("frete") < 0);
  check("2. comissão negativa", linha("comissao") < 0);
}

// ── Cenário 3: entrada + saída de produto ──────────────────────────────────
{
  const p0 = [
    pedido("A", { q: 10, receita: 1000, comissao: 100, frete: 50, custo: 400, imposto: 50 }),
    pedido("B", { q: 5, receita: 500, comissao: 50, frete: 25, custo: 200, imposto: 25 }),
  ];
  const p1 = [
    pedido("A", { q: 10, receita: 1000, comissao: 100, frete: 50, custo: 400, imposto: 50 }),
    pedido("C", { q: 8, receita: 800, comissao: 80, frete: 40, custo: 300, imposto: 40 }),
  ];
  const b = montarPonte(p0, p1);
  const linha = (k) => b.linhasBrutas.find((l) => l.chave === k).impacto;
  check("3. entrada+saída fecha", b.fecha);
  check("3. tem impacto de entradas", linha("entradas") > 0);
  check("3. tem impacto de saídas", linha("saidas") < 0);
  const somaContrib = b.produtos.reduce((s, x) => s + x.contribuicao, 0);
  check("3. contribuições fecham", Math.abs(somaContrib - b.delta) <= EPS);
}

// ── Cenário 4: multi-item por pedido (rateio de comissão/frete por receita) ─
{
  const p0 = [{
    id: "x", status: "pago", valor: 1000, taxas: 100, frete: 60,
    itens: [
      { mlb: "A", titulo: "A", quantidade: 4, receitaProduto: 600, custoProduto: 240, impostoInterno: 30 },
      { mlb: "B", titulo: "B", quantidade: 2, receitaProduto: 400, custoProduto: 160, impostoInterno: 20 },
    ],
  }];
  const p1 = [{
    id: "y", status: "pago", valor: 1200, taxas: 120, frete: 60,
    itens: [
      { mlb: "A", titulo: "A", quantidade: 5, receitaProduto: 800, custoProduto: 320, impostoInterno: 40 },
      { mlb: "B", titulo: "B", quantidade: 2, receitaProduto: 400, custoProduto: 160, impostoInterno: 20 },
    ],
  }];
  const b = montarPonte(p0, p1);
  check("4. multi-item fecha", b.fecha);
}

// ── Cenário 5: ADS NÃO EXISTE NA PONTE ─────────────────────────────────────
{
  const p0 = [pedido("A", { q: 10, receita: 1000, comissao: 100, frete: 50, custo: 400, imposto: 50 })];
  const p1 = [pedido("A", { q: 10, receita: 1000, comissao: 100, frete: 50, custo: 400, imposto: 50 })];
  const b = montarPonte(p0, p1);

  check("5. nenhuma linha de Ads na ponte", !temLinhaDeAds(b));
  check("5. sem chave 'ads' em linhasBrutas", !b.linhasBrutas.some((l) => l.chave === "ads"));
  check("5. período idêntico → delta 0", Math.abs(b.delta) <= EPS);

  // Mesmo passando (indevidamente) uma opção de ads, o motor a ignora por completo.
  const bComAds = montarPonte(p0, p1, { ads0: 100, ads1: 5000 });
  check("5. opção ads0/ads1 é ignorada pelo motor", Math.abs(bComAds.delta) <= EPS);
  check("5. ponte com ads na entrada continua sem linha de Ads", !temLinhaDeAds(bComAds));
}

// ── Cenário 6: a ponte é do RESULTADO OPERACIONAL ──────────────────────────
{
  const p0 = [pedido("A", { q: 10, receita: 1000, comissao: 100, frete: 50, custo: 400, imposto: 50 })];
  const p1 = [pedido("A", { q: 12, receita: 1200, comissao: 120, frete: 60, custo: 480, imposto: 60 })];
  const b = montarPonte(p0, p1);

  const t0 = totaisDoPeriodo(agregarProdutos(p0));
  const t1 = totaisDoPeriodo(agregarProdutos(p1));

  check("6. base declarada é resultadoOperacional", b.base === "resultadoOperacional");
  check("6. início = resultado operacional anterior", Math.abs(b.inicio - t0.resultadoOperacional) <= EPS);
  check("6. fim = resultado operacional atual", Math.abs(b.fim - t1.resultadoOperacional) <= EPS);
  check("6. resultadoOperacional = fat − comissão − frete − custo − imposto",
    Math.abs(t1.resultadoOperacional - (t1.faturamento - t1.comissao - t1.frete - t1.custo - t1.imposto)) <= EPS);
  check("6. totais não expõem campo de ads", !("ads" in t1) && !("resultadoFinal" in t1));
}

// ── Cenário 7: cancelado é ignorado nos dois lados ─────────────────────────
{
  const p0 = [pedido("A", { q: 10, receita: 1000, comissao: 100, frete: 50, custo: 400, imposto: 50 })];
  const p1 = [
    pedido("A", { q: 10, receita: 1000, comissao: 100, frete: 50, custo: 400, imposto: 50 }),
    pedido("A", { q: 99, receita: 9999, status: "cancelado" }),
  ];
  const b = montarPonte(p0, p1);
  check("7. cancelado ignorado → delta ~0", Math.abs(b.delta) <= EPS);
}

// ── Cenário 8: período anterior vazio (cliente novo) ───────────────────────
{
  const p1 = [pedido("A", { q: 10, receita: 1000, comissao: 100, frete: 50, custo: 400, imposto: 50 })];
  const b = montarPonte([], p1);
  check("8. período vazio fecha", b.fecha);
  check("8. tudo vira entradas", b.linhasBrutas.find((l) => l.chave === "entradas").impacto > 0);
}

// ── Cenário 9: linha "Ajustes de fechamento" identificada ──────────────────
{
  const p0 = [pedido("A", { q: 10, receita: 1000, comissao: 100, frete: 50, custo: 400, imposto: 50 })];
  const p1 = [pedido("A", { q: 10, receita: 1000, comissao: 100, frete: 50, custo: 400, imposto: 50 })];
  const b = montarPonte(p0, p1, { ajustes0: 0, ajustes1: -150 });

  const lAjustes = b.linhasBrutas.find((l) => l.chave === "ajustes");
  check("9. ajuste identificado vira linha própria", Math.abs(lAjustes.impacto + 150) <= EPS);
  check("9. ponte com ajuste continua fechando", b.fecha);
  check("9. delta reflete o ajuste", Math.abs(b.delta + 150) <= EPS);
  check("9. ajuste entra no total do período", Math.abs(b.totais.atual.ajustes + 150) <= EPS);
  check("9. resultado do detalhe fica separado do oficial",
    Math.abs(b.totais.atual.resultadoOperacional - (b.totais.atual.resultadoOperacionalDetalhe - 150)) <= EPS);
  check("9. ajuste não é Ads disfarçado", !temLinhaDeAds(b));
}

// ── Cenário 10: sem ajuste identificado, a linha fica zerada ───────────────
{
  const p0 = [pedido("A", { q: 10, receita: 1000, comissao: 100, frete: 50, custo: 400, imposto: 50 })];
  const p1 = [pedido("A", { q: 11, receita: 1100, comissao: 110, frete: 55, custo: 440, imposto: 55 })];
  const b = montarPonte(p0, p1);
  const lAjustes = b.linhasBrutas.find((l) => l.chave === "ajustes");
  check("10. sem ajuste identificado → linha 0", Math.abs(lAjustes.impacto) <= EPS);
  check("10. ponte fecha", b.fecha);
}

// ── Cenário 11: "Outros" nunca é caixa-preta ───────────────────────────────
{
  // A muda muito (domina o delta); B muda pouco → linhas de B caem em "Outros".
  const p0 = [
    pedido("A", { q: 100, receita: 100000, comissao: 10000, frete: 5000, custo: 50000, imposto: 5000 }),
    pedido("B", { q: 10, receita: 1000, comissao: 100, frete: 50, custo: 400, imposto: 50 }),
  ];
  const p1 = [
    pedido("A", { q: 200, receita: 200000, comissao: 20000, frete: 10000, custo: 100000, imposto: 10000 }),
    pedido("B", { q: 10, receita: 1010, comissao: 101, frete: 52, custo: 404, imposto: 51 }),
  ];
  const b = montarPonte(p0, p1, { materialidade: 0.02 });
  const outros = b.linhas.find((l) => l.chave === "outros");

  check("11. ponte com agrupamento fecha", b.fecha);
  if (outros) {
    check("11. 'Outros' declara a composição", Array.isArray(outros.composicao) && outros.composicao.length > 0);
    check("11. cada item da composição tem chave, label e impacto",
      outros.composicao.every((c) => c.chave && c.label && typeof c.impacto === "number"));
    const somaComposicao = outros.composicao.reduce((s, c) => s + c.impacto, 0);
    check("11. soma da composição = valor de 'Outros'", Math.abs(somaComposicao - outros.impacto) <= EPS * 2);
    check("11. 'Outros' não esconde Ads",
      outros.composicao.every((c) => !CHAVES_ADS.includes(c.chave)));
  } else {
    check("11. sem linha 'Outros' neste cenário (nada foi escondido)", true);
  }
}

// ── Cenário 12: ajuste de fechamento NÃO é criado artificialmente ──────────
{
  const p0 = [pedido("A", { q: 10, receita: 1000, comissao: 100, frete: 50, custo: 400, imposto: 50 })];
  const p1 = [pedido("A", { q: 12, receita: 1300, comissao: 130, frete: 60, custo: 500, imposto: 65 })];

  // Nenhum ajuste identificado é passado → a linha existe mas vale 0.
  const b = montarPonte(p0, p1);
  const lAjustes = b.linhasBrutas.find((l) => l.chave === "ajustes");
  check("12. sem origem identificada, o ajuste é zero", lAjustes.impacto === 0);
  check("12. ajuste zerado não aparece entre as linhas materiais",
    !b.linhas.some((l) => l.chave === "ajustes"));
  check("12. ponte fecha sem precisar de ajuste", b.fecha);
  check("12. nenhuma divergência declarada quando fecha", b.divergencia === null);
}

// ── Cenário 13: detalhe expansível de cada linha ───────────────────────────
{
  const p0 = [pedido("A", { q: 90, receita: 27000, comissao: 2700, frete: 1500, custo: 13500, imposto: 1350 })];
  const p1 = [pedido("A", { q: 88, receita: 26400, comissao: 2640, frete: 2100, custo: 15840, imposto: 1320 })];
  const b = montarPonte(p0, p1);

  const lCusto = b.linhas.find((l) => l.chave === "custo");
  check("13. linha de custo tem descrição em português", typeof lCusto.descricao === "string" && lCusto.descricao.length > 20);
  check("13. linha de custo expõe a fórmula", typeof lCusto.formula === "string" && lCusto.formula.includes("custo unitário"));
  check("13. linha de custo lista os produtos responsáveis", lCusto.produtos.length === 1 && lCusto.produtos[0].mlb === "A");
  check("13. produto traz o unitário antes e depois",
    lCusto.produtos[0].unitario.anterior === 150 && lCusto.produtos[0].unitario.atual === 180);
  check("13. produto traz as unidades do período",
    lCusto.produtos[0].unidadesAnterior === 90 && lCusto.produtos[0].unidadesAtual === 88);
  check("13. impacto do produto bate com a linha", Math.abs(lCusto.produtos[0].impacto - lCusto.impacto) <= EPS);
  check("13. nenhuma linha explicada menciona Ads",
    b.linhas.every((l) => !/\bads\b|tacos|campanha|m[ií]dia/i.test(`${l.descricao || ""} ${l.formula || ""}`)));
}

console.log(`\n${passed} verificações passaram. Ponte fecha no resultado operacional com resíduo ≤ R$ ${EPS} e sem Ads.`);
