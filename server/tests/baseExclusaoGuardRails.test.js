// server/tests/baseExclusaoGuardRails.test.js
//
// Correção pós-auditoria do achado P0 "Hard delete compartilhado não possui
// guard rail de dependências": DELETE /bases/:baseId apagava direto, sem
// checar nada, podia derrubar em 500 (seller_custos_submissoes sem ON
// DELETE) ou apagar um vínculo ativo por CASCADE sem avisar.
//
// Cobre baseDependenciesService.checarDependenciasBase:
//  1. base sem nenhuma dependência não bloqueia.
//  2. vínculo ativo bloqueia (nunca deixar o CASCADE remover em silêncio).
//  3. submissão do Seller referenciando a base bloqueia (evita o 500 cru).
//  4. custos sozinhos (sem vínculo) NÃO bloqueiam, só avisam — base órfã
//     pode ser removida por um admin que sabe o que está fazendo.
//  5. relatórios referenciando a base NÃO bloqueiam (relatorios.base_id é
//     SET NULL) — aparecem só como informativo.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");

let checks = 0;
function ok(label, condition) {
  assert.ok(condition, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

const pool = require("../config/database");

function mockPoolFixo({ vinculo = [], submissoes = 0, custos = 0, relatorios = 0 }) {
  return async (sql) => {
    const q = String(sql).replace(/\s+/g, " ").trim();
    if (q.includes("FROM base_cliente_vinculos v") && q.includes("v.ativo = true")) return { rows: vinculo };
    if (q.includes("FROM seller_custos_submissoes")) return { rows: [{ total: submissoes }] };
    if (q.includes("FROM custos WHERE base_id")) return { rows: [{ total: custos }] };
    if (q.includes("FROM relatorios WHERE base_id")) return { rows: [{ total: relatorios }] };
    throw new Error(`Query não mapeada no mock: ${q}`);
  };
}

async function run() {
  const { checarDependenciasBase } = require("../services/bases/baseDependenciesService");
  const originalQuery = pool.query;

  try {
    // ── 1. Base sem nenhuma dependência ──
    pool.query = mockPoolFixo({});
    const semDependencia = await checarDependenciasBase(1);
    ok("base sem dependências não bloqueia", semDependencia.bloqueado === false);
    ok("lista de dependências vazia", semDependencia.dependencias.length === 0);

    // ── 2. Vínculo ativo bloqueia ──
    pool.query = mockPoolFixo({ vinculo: [{ id: 5, cliente_conta_id: 42, cliente_nome: "Extra" }] });
    const comVinculo = await checarDependenciasBase(2);
    ok("vínculo ativo bloqueia a exclusão", comVinculo.bloqueado === true);
    ok("dependência de vínculo é reportada", comVinculo.dependencias.some((d) => d.tipo === "vinculo_ativo" && d.bloqueia === true));

    // ── 3. Submissão do Seller bloqueia (evita 500 cru por FK sem ON DELETE) ──
    pool.query = mockPoolFixo({ submissoes: 3 });
    const comSubmissoes = await checarDependenciasBase(3);
    ok("submissões do Seller bloqueiam a exclusão", comSubmissoes.bloqueado === true);
    ok("dependência de submissões é reportada", comSubmissoes.dependencias.some((d) => d.tipo === "seller_submissoes" && d.bloqueia === true));

    // ── 4. Custos sozinhos não bloqueiam, só avisam ──
    pool.query = mockPoolFixo({ custos: 120 });
    const comCustos = await checarDependenciasBase(4);
    ok("custos sozinhos (sem vínculo) não bloqueiam", comCustos.bloqueado === false);
    ok("custos aparecem como aviso informativo", comCustos.dependencias.some((d) => d.tipo === "custos" && d.bloqueia === false));

    // ── 5. Relatórios não bloqueiam (SET NULL) ──
    pool.query = mockPoolFixo({ relatorios: 2 });
    const comRelatorios = await checarDependenciasBase(5);
    ok("relatórios não bloqueiam a exclusão", comRelatorios.bloqueado === false);
    ok("relatórios aparecem como aviso informativo", comRelatorios.dependencias.some((d) => d.tipo === "relatorios" && d.bloqueia === false));

    console.log(`\n✓ baseExclusaoGuardRails: ${checks} verificações`);
  } finally {
    pool.query = originalQuery;
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
