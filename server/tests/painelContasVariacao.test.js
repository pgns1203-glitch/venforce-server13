// server/tests/painelContasVariacao.test.js
// Testes puros de painelContasVariacao.js — regras obrigatórias da Auditoria
// §12/§26 "Variação": anterior/atual ausente -> null; nunca Infinity;
// nunca 0 fabricado; taxa (mc/acos/tacos) -> pp, nunca pct.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const { delta, deltaPct, deltaPp, variacaoResumo } = require("../services/painelContas/painelContasVariacao");

let checks = 0;
function ok(label, cond) {
  assert.ok(cond, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

// ── delta/deltaPct/deltaPp — casos-base ──
ok("delta: valor sobe -> positivo", delta(100, 130) === 30);
ok("delta: valor cai -> negativo", delta(130, 100) === -30);
ok("deltaPct: sobe 13% -> 0.13", Math.abs(deltaPct(100000, 113000) - 0.13) < 1e-9);
ok("deltaPct: x=0 nunca produz Infinity -> null", deltaPct(0, 100) === null);
ok("deltaPct: x=0, y=0 -> null (não NaN)", deltaPct(0, 0) === null);
ok("deltaPp: mc sobe 1pp (0.18->0.19) -> 1", deltaPp(0.18, 0.19) === 1);
ok("delta: x null -> null", delta(null, 100) === null);
ok("delta: y undefined -> null", delta(100, undefined) === null);
ok("deltaPct: null em qualquer ponta -> null", deltaPct(null, 100) === null && deltaPct(100, null) === null);
ok("deltaPp: null em qualquer ponta -> null", deltaPp(null, 0.2) === null);

// ── variacaoResumo ──
const atual = { fat: 113000, lc: 20500, mc: 0.181, ads: 3900, acos: 0.0402, tacos: 0.0345 };
const anterior = { fat: 100000, lc: 18000, mc: 0.18, ads: 3500, acos: 0.038, tacos: 0.035 };

const v = variacaoResumo(anterior, atual);
ok("variacaoResumo.fat: abs+pct (métrica absoluta)", v.fat.abs === 13000 && Math.abs(v.fat.pct - 0.13) < 1e-6);
ok("variacaoResumo.lc: abs+pct", v.lc.abs === 2500 && Math.abs(v.lc.pct - (2500 / 18000)) < 1e-6);
ok("variacaoResumo.mc: só pp, nunca pct (métrica de taxa)", v.mc.pp !== undefined && v.mc.pct === undefined);
ok("variacaoResumo.mc.pp correto", Math.abs(v.mc.pp - 0.1) < 1e-6);
ok("variacaoResumo.ads: abs+pct", v.ads.abs === 400);
ok("variacaoResumo.acos/tacos: só pp", v.acos.pct === undefined && v.tacos.pct === undefined);

// ── mês anterior ausente (primeiro mês do cliente) — TODOS os campos null ──
const vSemAnterior = variacaoResumo(null, atual);
ok(
  "mês anterior ausente: fat/lc/ads.abs e .pct todos null",
  vSemAnterior.fat.abs === null && vSemAnterior.fat.pct === null &&
  vSemAnterior.lc.abs === null && vSemAnterior.ads.pct === null
);
ok("mês anterior ausente: mc/acos/tacos.pp todos null", vSemAnterior.mc.pp === null && vSemAnterior.acos.pp === null && vSemAnterior.tacos.pp === null);

// ── mês anterior com valor 0 -> deltaPct null, nunca Infinity ──
const vComZero = variacaoResumo({ fat: 0, lc: 0, mc: 0, ads: 0, acos: 0, tacos: 0 }, atual);
ok("mês anterior com fat=0: pct null (guard x!==0), nunca Infinity", vComZero.fat.pct === null && Number.isFinite(vComZero.fat.abs));
ok("nenhum campo de variacaoResumo é Infinity/NaN em nenhum cenário", [v, vSemAnterior, vComZero].every((obj) =>
  Object.values(obj).every((par) => Object.values(par).every((n) => n === null || Number.isFinite(n)))
));

console.log(`\npainelContasVariacao.test.js: ${checks} verificações passaram.`);
