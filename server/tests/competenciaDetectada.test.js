// server/tests/competenciaDetectada.test.js
//
// V3 P2.6 D2 — declaração da competência efetivamente processada.
//
// A regra que este arquivo trava: o backend DESCREVE o que encontrou nos
// dados e NUNCA chuta. Sem coluna de data reconhecível, `competencia` é null —
// e null significa "não deu para determinar", jamais "é o mês atual".

const assert = require("assert");
const {
  detectarCompetenciaDeLinhas,
  compararCompetencias,
  parseDataDeCelula,
  ehColunaDeData,
} = require("../utils/competenciaDetectada");

let checks = 0;
function ok(label, condition) {
  assert.ok(condition, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

// --------------------------------------------------------------- celulas
ok("data ISO e lida literalmente", parseDataDeCelula("2026-08-15") === "2026-08-15");
ok("timestamp ISO nao vira outro dia por timezone", parseDataDeCelula("2026-08-31T23:59:00Z") === "2026-08-31");
ok("data BR dd/mm/aaaa e convertida", parseDataDeCelula("15/08/2026") === "2026-08-15");
ok("data BR com hifen tambem", parseDataDeCelula("15-08-2026") === "2026-08-15");
ok("Date usa componentes locais", parseDataDeCelula(new Date(2026, 7, 15)) === "2026-08-15");
ok("Date invalida vira null", parseDataDeCelula(new Date("nada")) === null);
ok("serial do Excel e ignorado (epoca ambigua), nunca chutado", parseDataDeCelula(46000) === null);
ok("texto livre vira null", parseDataDeCelula("agosto") === null);
ok("mes 13 em data BR vira null", parseDataDeCelula("15/13/2026") === null);
ok("vazio vira null", parseDataDeCelula("   ") === null);

// --------------------------------------------------------------- colunas
ok("'Data da venda' e coluna de data", ehColunaDeData("Data da venda"));
ok("'DATA DO PEDIDO' (caixa alta) e coluna de data", ehColunaDeData("DATA DO PEDIDO"));
ok("'Data de criação' (com acento) e coluna de data", ehColunaDeData("Data de criação"));
ok("'Order create time' (TikTok) e coluna de data", ehColunaDeData("Order create time"));
ok("'Preço' NAO e coluna de data", !ehColunaDeData("Preço"));
ok("'ID do pedido' NAO e coluna de data", !ehColunaDeData("ID do pedido"));

// -------------------------------------------------------------- deteccao
{
  const linhas = [
    { "ID do pedido": "1", "Data da venda": "2026-08-01", "Valor": 10 },
    { "ID do pedido": "2", "Data da venda": "2026-08-20", "Valor": 20 },
    { "ID do pedido": "3", "Data da venda": "2026-08-31", "Valor": 30 },
  ];
  const d = detectarCompetenciaDeLinhas(linhas);
  ok("competencia dominante detectada", d.competencia === "2026-08");
  ok("dataMin e dataMax refletem o intervalo real", d.dataMin === "2026-08-01" && d.dataMax === "2026-08-31");
  ok("coluna usada e declarada", d.coluna === "Data da venda");
  ok("nao ha multiplas competencias", d.multiplasCompetencias === false);
  ok("conta as linhas com data", d.linhasComData === 3 && d.linhasTotal === 3);
}
{
  // Planilha que atravessa dois meses — o caso perigoso.
  const linhas = [
    { "Data": "2026-07-30" }, { "Data": "2026-08-01" }, { "Data": "2026-08-02" },
  ];
  const d = detectarCompetenciaDeLinhas(linhas);
  ok("planilha multi-mes: dominante e a de maior volume", d.competencia === "2026-08");
  ok("planilha multi-mes: a travessia e DECLARADA", d.multiplasCompetencias === true);
  ok("planilha multi-mes: lista as duas competencias com volume", d.competencias.length === 2 && d.competencias[0].linhas === 2);
  ok("planilha multi-mes: intervalo cobre os dois meses", d.dataMin === "2026-07-30" && d.dataMax === "2026-08-02");
}
{
  const d = detectarCompetenciaDeLinhas([{ "Produto": "x", "Valor": 1 }]);
  ok("sem coluna de data: competencia null (nunca o mes atual)", d.competencia === null);
  ok("sem coluna de data: coluna null", d.coluna === null);
  ok("sem coluna de data: linhasTotal ainda e reportado", d.linhasTotal === 1);
}
ok("lista vazia nao lanca", detectarCompetenciaDeLinhas([]).competencia === null);
ok("undefined nao lanca", detectarCompetenciaDeLinhas(undefined).competencia === null);
{
  // Linhas com data faltando no meio nao invalidam a deteccao.
  const d = detectarCompetenciaDeLinhas([
    { "Data": "2026-08-01" }, { "Data": "" }, { "Data": "2026-08-05" },
  ]);
  ok("linhas sem data sao ignoradas, nao quebram a deteccao", d.competencia === "2026-08" && d.linhasComData === 2);
}

// ------------------------------------------------------------ comparacao
{
  const d = detectarCompetenciaDeLinhas([{ "Data": "2026-07-10" }, { "Data": "2026-07-20" }]);
  const c = compararCompetencias({ periodoSolicitado: "2026-08", deteccao: d });
  ok("pedir Agosto com planilha de Julho e DIVERGENTE", c.divergente === true);
  ok("a divergencia diz os dois lados", /2026-07/.test(c.motivo) && /2026-08/.test(c.motivo));
  ok("periodoDetectado e exposto", c.periodoDetectado === "2026-07");
  ok("periodoSolicitado e exposto normalizado", c.periodoSolicitado === "2026-08");
}
{
  const d = detectarCompetenciaDeLinhas([{ "Data": "2026-08-10" }]);
  const c = compararCompetencias({ periodoSolicitado: "2026-08", deteccao: d });
  ok("pedido e dados batendo NAO e divergente", c.divergente === false && c.motivo === null);
}
{
  const d = detectarCompetenciaDeLinhas([{ "Data": "2026-07-31" }, { "Data": "2026-08-01" }]);
  const c = compararCompetencias({ periodoSolicitado: "2026-08", deteccao: d });
  ok("planilha multi-mes e divergente mesmo batendo com o pedido", c.divergente === true);
}
{
  // Sem periodo pedido (fluxo legado) nao se afirma divergencia nenhuma.
  const d = detectarCompetenciaDeLinhas([{ "Data": "2026-07-10" }]);
  const c = compararCompetencias({ periodoSolicitado: undefined, deteccao: d });
  ok("sem periodo pedido nunca ha divergencia (legado intocado)", c.divergente === false);
  ok("...mas o detectado continua sendo declarado", c.periodoDetectado === "2026-07");
}
{
  // Sem competencia detectada tambem nao se afirma divergencia — seria
  // inventar um alerta a partir de ausencia de informacao.
  const d = detectarCompetenciaDeLinhas([{ "Produto": "x" }]);
  const c = compararCompetencias({ periodoSolicitado: "2026-08", deteccao: d });
  ok("sem competencia detectada nao se afirma divergencia", c.divergente === false);
  ok("...mas o motivo explica que nao deu para determinar", /Nao foi possivel determinar/.test(c.motivo));
}

console.log(`\ncompetenciaDetectada.test.js: ${checks} verificacoes passaram.`);
