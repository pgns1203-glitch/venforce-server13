// server/tests/painelContasSemanas.test.js
// Testes puros de painelContasSemanas.js — Opção A (Auditoria §11/§29 D4):
// blocos fixos de 7 dias, S5 só quando o mês tem dia 29+; só FAT tem série
// diária, resto sempre null, nunca valor mensal rateado (§26 "Dados").

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const { blocosDaSemana, agruparEmSemanas } = require("../services/painelContas/painelContasSemanas");

let checks = 0;
function ok(label, cond) {
  assert.ok(cond, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

// ── blocosDaSemana ──
const fev2026 = blocosDaSemana("2026-02"); // 28 dias, ano não-bissexto
ok("fevereiro (28 dias): 4 blocos, sem S5", fev2026.length === 4);
ok("fevereiro: S4 = 22-28", fev2026[3].semana === "S4" && fev2026[3].de === 22 && fev2026[3].ate === 28);

const abr2026 = blocosDaSemana("2026-04"); // 30 dias
ok("abril (30 dias): 5 blocos, com S5", abr2026.length === 5);
ok("abril: S5 = 29-30", abr2026[4].semana === "S5" && abr2026[4].de === 29 && abr2026[4].ate === 30);

const jan2026 = blocosDaSemana("2026-01"); // 31 dias
ok("janeiro (31 dias): S5 = 29-31", jan2026[4].de === 29 && jan2026[4].ate === 31);

// ── agruparEmSemanas ──
const porDiaFev = [
  { data: "2026-02-01", vendasBrutas: 1000 },
  { data: "2026-02-05", vendasBrutas: 2000 },
  { data: "2026-02-08", vendasBrutas: 3000 },
  { data: "2026-02-22", vendasBrutas: 500 },
  { data: "2026-02-28", vendasBrutas: 500 },
];
const semanasFev = agruparEmSemanas("2026-02", porDiaFev);
ok("agruparEmSemanas: 4 semanas para fevereiro", semanasFev.length === 4);
ok("S1 soma os dias 01 e 05 -> fat=3000", semanasFev[0].resumo.fat === 3000);
ok("S2 soma o dia 08 -> fat=3000", semanasFev[1].resumo.fat === 3000);
ok("S3 sem nenhum dia no payload -> fat null (ausência, não zero)", semanasFev[2].resumo.fat === null);
ok("S4 soma dias 22 e 28 -> fat=1000", semanasFev[3].resumo.fat === 1000);
ok(
  "toda métrica além de FAT é sempre null (LC/MC/ADS/ACOS/TACOS/COM/ATV/NPS)",
  semanasFev.every((s) =>
    s.resumo.lc === null && s.resumo.mc === null && s.resumo.ads === null &&
    s.resumo.acos === null && s.resumo.tacos === null &&
    s.resumo.com === null && s.resumo.atv === null && s.resumo.nps === null
  )
);
ok("de/ate no formato YYYY-MM-DD", semanasFev[0].de === "2026-02-01" && semanasFev[0].ate === "2026-02-07");

// ── payload ausente (cliente nunca sincronizado) ──
const semSerie = agruparEmSemanas("2026-02", null);
ok("payload ausente: todas as semanas com fat null, nunca erro", semSerie.every((s) => s.resumo.fat === null));

// ── venda real zero num bloco com dado presente ──
const porDiaComZero = [{ data: "2026-02-01", vendasBrutas: 0 }];
const semanasComZero = agruparEmSemanas("2026-02", porDiaComZero);
ok("bloco com dia presente e venda 0 -> fat=0 (dado real, não ausência)", semanasComZero[0].resumo.fat === 0);

console.log(`\npainelContasSemanas.test.js: ${checks} verificações passaram.`);
