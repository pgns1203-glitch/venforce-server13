// server/tests/competenciaCanonica.test.js
//
// V3 P2.6 BLOCO C/G — competência explícita e normalização canônica.
//
// Regra dura da missão: NUNCA inferir competência silenciosamente (mês atual,
// new Date(), data do upload) e NUNCA fabricar um período quando a fonte não
// permite inferir com segurança — nesse caso o honesto é `null`.

const assert = require("assert");
const {
  normalizarCompetencia,
  exigirCompetencia,
  mesmaCompetencia,
  rangeDaCompetencia,
} = require("../utils/competenciaCanonica");

let checks = 0;
function ok(label, condition) {
  assert.ok(condition, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}
function lancaCom(label, fn, verificar) {
  let erro = null;
  try { fn(); } catch (e) { erro = e; }
  assert.ok(erro, `FALHOU (não lançou): ${label}`);
  if (verificar) assert.ok(verificar(erro), `FALHOU (erro inesperado): ${label} — ${erro.message}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

// ---------------------------------------------------------------- normalizar
ok("YYYY-MM passa direto", normalizarCompetencia("2026-07") === "2026-07");
ok("espaços em volta são tolerados", normalizarCompetencia("  2026-07 ") === "2026-07");
ok("YYYY-MM-DD (data ISO) vira a competência do mês", normalizarCompetencia("2026-07-31") === "2026-07");
ok("timestamp ISO vira a competência do mês", normalizarCompetencia("2026-07-31T23:59:59.000Z") === "2026-07");
ok("MM/YYYY (formato BR legado) é reconhecido", normalizarCompetencia("07/2026") === "2026-07");
ok("YYYY/MM é reconhecido", normalizarCompetencia("2026/07") === "2026-07");
ok("Date é lido em componentes LOCAIS (sem pular de mês por timezone)", normalizarCompetencia(new Date(2026, 6, 1)) === "2026-07");

// Honestidade: o que não dá para inferir com segurança vira null, nunca um mês inventado.
ok("null → null", normalizarCompetencia(null) === null);
ok("undefined → null", normalizarCompetencia(undefined) === null);
ok("string vazia → null", normalizarCompetencia("") === null);
ok("texto livre → null (NUNCA o mês atual)", normalizarCompetencia("agosto/2026 fechamento") === null);
ok("mês 13 é inválido → null", normalizarCompetencia("2026-13") === null);
ok("mês 00 é inválido → null", normalizarCompetencia("2026-00") === null);
ok("intervalo '2026-07 a 2026-08' é ambíguo → null, nunca escolhe um lado", normalizarCompetencia("2026-07 a 2026-08") === null);
ok("Date inválida → null", normalizarCompetencia(new Date("nada")) === null);
ok("número solto → null", normalizarCompetencia(202607) === null);

// ------------------------------------------------------------------- exigir
ok("exigirCompetencia devolve a competência normalizada", exigirCompetencia("2026-07") === "2026-07");
lancaCom("ausente → 400 PERIODO_OBRIGATORIO", () => exigirCompetencia(undefined),
  (e) => e.statusCode === 400 && e.code === "PERIODO_OBRIGATORIO");
lancaCom("vazio → 400 PERIODO_OBRIGATORIO", () => exigirCompetencia("   "),
  (e) => e.statusCode === 400 && e.code === "PERIODO_OBRIGATORIO");
lancaCom("inválido → 400 PERIODO_INVALIDO (nunca cai no mês atual)", () => exigirCompetencia("agosto-2026"),
  (e) => e.statusCode === 400 && e.code === "PERIODO_INVALIDO");
lancaCom("mês 13 → 400 PERIODO_INVALIDO", () => exigirCompetencia("2026-13"),
  (e) => e.statusCode === 400 && e.code === "PERIODO_INVALIDO");
ok("exigirCompetencia aceita YYYY-MM-DD e normaliza", exigirCompetencia("2026-07-15") === "2026-07");

// -------------------------------------------------------------- mesma (===)
// Substituto do `String(e.periodo).includes(competencia)` que casava Julho
// dentro de "2026-07 a 2026-08" e deixava Julho ser lido como Agosto.
ok("igualdade exata entre competências", mesmaCompetencia("2026-07", "2026-07") === true);
ok("Julho != Agosto", mesmaCompetencia("2026-07", "2026-08") === false);
ok("normaliza os dois lados antes de comparar", mesmaCompetencia("2026-07-31", "07/2026") === true);
ok("intervalo ambíguo NÃO casa com Julho (regressão do substring)", mesmaCompetencia("2026-07 a 2026-08", "2026-07") === false);
ok("intervalo ambíguo NÃO casa com Agosto (regressão do substring)", mesmaCompetencia("2026-07 a 2026-08", "2026-08") === false);
ok("null nunca casa com nada", mesmaCompetencia(null, "2026-07") === false);
ok("null não casa nem com null", mesmaCompetencia(null, null) === false);

// -------------------------------------------------------------------- range
{
  const r = rangeDaCompetencia("2026-07");
  ok("range cobre o mês inteiro (1 ao último dia)", r.dateFrom === "2026-07-01" && r.dateTo === "2026-07-31");
}
{
  const r = rangeDaCompetencia("2026-02");
  ok("fevereiro de ano não bissexto termina em 28", r.dateTo === "2026-02-28");
}
{
  const r = rangeDaCompetencia("2024-02");
  ok("fevereiro bissexto termina em 29", r.dateTo === "2024-02-29");
}
{
  const r = rangeDaCompetencia("2026-12");
  ok("dezembro termina em 31 sem virar o ano", r.dateFrom === "2026-12-01" && r.dateTo === "2026-12-31");
}
lancaCom("rangeDaCompetencia com lixo → 400, NUNCA range do mês atual", () => rangeDaCompetencia("lixo"),
  (e) => e.statusCode === 400);

console.log(`\ncompetenciaCanonica.test.js: ${checks} verificações passaram.`);
