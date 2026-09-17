// server/tests/cliente360V3Envelope.test.js
//
// V3 FASE 1 — FUNDAÇÃO DA NOVA CLIENTE 360 V3.
//
// Prova o contrato de envelope por bloco (prompt master, seção "Envelope
// padrão por bloco"): disponibilidade, motivo, escopo, fonte, confiança e
// dados sempre presentes nas mesmas chaves — e que um bloco cuja produção
// lança um erro NUNCA derruba o restante (blocoSeguro captura e degrada
// para indisponível em vez de propagar).
//
// Roda sem infra: node server/tests/cliente360V3Envelope.test.js

const assert = require("assert");
const { envelopeDisponivel, envelopeIndisponivel, blocoSeguro } = require("../services/cliente360/cliente360V3Envelope");

let passed = 0;
const check = (n, c) => { assert.ok(c, `FALHOU: ${n}`); passed++; console.log(`  ok  ${n}`); };

(async () => {
  // ── envelopeDisponivel ──────────────────────────────────────────────────
  const disp = envelopeDisponivel({ escopo: "account", fonte: { nome: "teste", versao: "1", geradoEm: "x" }, confianca: "alta", dados: { a: 1 } });
  check("disponivel: disponivel=true", disp.disponivel === true);
  check("disponivel: motivo/codigo nulos (nada a explicar)", disp.motivo === null && disp.codigo === null);
  check("disponivel: preserva escopo/fonte/confianca/dados", disp.escopo === "account" && disp.fonte.nome === "teste" && disp.confianca === "alta" && disp.dados.a === 1);

  // ── envelopeIndisponivel ────────────────────────────────────────────────
  const indisp = envelopeIndisponivel({ motivo: "Sem dados para este período.", codigo: "SEM_DADOS", escopo: "account" });
  check("indisponivel: disponivel=false", indisp.disponivel === false);
  check("indisponivel: motivo/codigo preservados", indisp.motivo === "Sem dados para este período." && indisp.codigo === "SEM_DADOS");
  check("indisponivel: dados=null (NUNCA um zero fabricado)", indisp.dados === null);
  check("indisponivel: escopo default é not_applicable quando omitido", envelopeIndisponivel({ motivo: "x" }).escopo === "not_applicable");

  // ── blocoSeguro: caminho feliz ──────────────────────────────────────────
  const feliz = await blocoSeguro(async () => ({ total: 42 }), { escopo: "account", fonteNome: "origem_x" });
  check("blocoSeguro feliz: disponivel=true com os dados do produtor", feliz.disponivel === true && feliz.dados.total === 42);
  check("blocoSeguro feliz: fonte.nome é o informado", feliz.fonte?.nome === "origem_x");

  // ── blocoSeguro: produtor lança erro — NUNCA propaga ────────────────────
  const erroSimulado = new Error("explodiu ao montar o bloco");
  erroSimulado.code = "ERRO_SIMULADO";
  const falho = await blocoSeguro(async () => { throw erroSimulado; }, { escopo: "account", fonteNome: "origem_x" });
  check("blocoSeguro falho: NÃO lança — devolve envelope", falho && falho.disponivel === false);
  check("blocoSeguro falho: motivo vem do erro real, não genérico", falho.motivo === "explodiu ao montar o bloco");
  check("blocoSeguro falho: codigo vem do erro real", falho.codigo === "ERRO_SIMULADO");
  check("blocoSeguro falho: dados=null", falho.dados === null);

  console.log(`\n${passed} verificações passaram. Envelope por bloco: disponibilidade/motivo/escopo/fonte/dados consistentes; falha de um produtor nunca propaga.`);
})().catch((e) => { console.error(e); process.exit(1); });
