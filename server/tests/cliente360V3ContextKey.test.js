// server/tests/cliente360V3ContextKey.test.js
//
// V3 FASE 1 — ContextKey (prompt master, seção "ContextKey"): identidade
// explícita do contexto de uma resposta —
//   clienteId + clienteContaId + periodo + compararCom
// — usada para descartar payload incompatível quando o contexto troca antes
// da resposta chegar. Mesmo algoritmo do lado frontend
// (frontend-react/src/utils/cliente360V3ContextKey.js) — os dois precisam
// concordar no MESMO formato para o backend poder ecoar o contextKey que o
// frontend calculou e o frontend poder comparar sem ambiguidade.
//
// Roda sem infra: node server/tests/cliente360V3ContextKey.test.js

const assert = require("assert");
const { criarContextKey } = require("../services/cliente360/cliente360V3ContextKey");

let passed = 0;
const check = (n, c) => { assert.ok(c, `FALHOU: ${n}`); passed++; console.log(`  ok  ${n}`); };

const base = { clienteId: 1, clienteContaId: 10, periodo: "2026-08", compararCom: "2026-07" };

check("mesmos campos → mesma chave", criarContextKey(base) === criarContextKey({ ...base }));
check("clienteContaId diferente → chave diferente (conta A não pode reaproveitar cache da conta B)",
  criarContextKey(base) !== criarContextKey({ ...base, clienteContaId: 11 }));
check("clienteId diferente → chave diferente", criarContextKey(base) !== criarContextKey({ ...base, clienteId: 2 }));
check("periodo diferente → chave diferente", criarContextKey(base) !== criarContextKey({ ...base, periodo: "2026-09" }));
check("compararCom diferente → chave diferente", criarContextKey(base) !== criarContextKey({ ...base, compararCom: "2026-06" }));
check("compararCom ausente (undefined) e compararCom=null → mesma chave (normalizado)",
  criarContextKey({ ...base, compararCom: undefined }) === criarContextKey({ ...base, compararCom: null }));
check("clienteId ausente → null (contexto incompleto nunca gera chave válida)",
  criarContextKey({ ...base, clienteId: null }) === null);
check("clienteContaId ausente → null", criarContextKey({ ...base, clienteContaId: null }) === null);
check("periodo ausente → null", criarContextKey({ ...base, periodo: null }) === null);
check("chave é string quando completa", typeof criarContextKey(base) === "string");

console.log(`\n${passed} verificações passaram. ContextKey: determinístico, sensível a cada campo, null quando o contexto está incompleto.`);
