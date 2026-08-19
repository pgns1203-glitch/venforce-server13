// server/tests/baseVinculosSerializacao.test.js
//
// Correção pós-auditoria do achado P1 "GET /base-vinculos apaga a
// identidade da conta e do grant na serialização": a leitura antiga só
// devolvia cliente + marketplace, então Cliente X → ML 1 e Cliente X → ML 2
// ficavam visualmente idênticos em /bases. Esta é a mesma
// listarBasesComVinculos usada pelo controller de GET /base-vinculos.
//
// Cobre:
//  1. ML 1 e ML 2 do mesmo cliente aparecem com cliente_conta_id, conta_nome
//     e external_account_id DIFERENTES (não colapsam).
//  2. grant (ml_user_id + token_status) aparece quando existe.
//  3. vínculo legado (sem cliente_conta_id) devolve cliente_conta_id/conta
//     null — "Conta não definida" no frontend.
//  4. nenhum access_token/refresh_token aparece em nenhum vínculo.
//  5. campos legados (cliente_id, cliente_nome, marketplace, origem) continuam
//     presentes e no formato antigo — compatibilidade aditiva.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");

let checks = 0;
function ok(label, condition) {
  assert.ok(condition, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

const pool = require("../config/database");

// Simula a query enriquecida de listarBasesComVinculos: junta bases +
// vínculo ativo + cliente + cliente_contas + o grant mais recente daquela
// conta (via LATERAL, para nunca dar fan-out).
function criarMockRows(bases, vinculos, clientes, contas, grants) {
  return bases.map((b) => {
    const v = vinculos.find((x) => x.base_id === b.id && x.ativo);
    const cliente = v ? clientes.find((c) => c.id === v.cliente_id) : null;
    const conta = v?.cliente_conta_id ? contas.find((c) => c.id === v.cliente_conta_id) : null;
    const grant = conta ? grants.find((g) => g.cliente_conta_id === conta.id) : null;
    return {
      id: b.id, slug: b.slug, nome: b.nome, ativo: b.ativo, marketplace: b.marketplace,
      created_at: b.created_at, updated_at: b.updated_at,
      vinculo_id: v?.id ?? null,
      cliente_id: v?.cliente_id ?? null,
      cliente_slug: cliente?.slug ?? null,
      cliente_nome: cliente?.nome ?? null,
      cliente_conta_id: v?.cliente_conta_id ?? null,
      conta_nome: conta?.nome ?? null,
      conta_slug: conta?.slug ?? null,
      external_account_id: conta?.external_account_id ?? null,
      vinculo_marketplace: v?.marketplace ?? null,
      origem: v?.origem ?? null,
      vinculo_updated_at: v?.updated_at ?? null,
      grant_id: grant?.id ?? null,
      grant_ml_user_id: grant?.ml_user_id ?? null,
      grant_token_status: grant?.token_status ?? null,
    };
  });
}

async function run() {
  const baseVinculosService = require("../services/baseVinculosService");
  const originalQuery = pool.query;

  try {
    const clientes = [{ id: 1, nome: "Extra", slug: "extra" }];
    const contas = [
      { id: 10, nome: "Mercado Livre 1", slug: "extra-meli-1", external_account_id: "111111" },
      { id: 20, nome: "Mercado Livre 2", slug: "extra-meli-2", external_account_id: "222222" },
    ];
    const grants = [
      { id: 900, cliente_conta_id: 10, ml_user_id: "111111", token_status: "valid" },
      { id: 901, cliente_conta_id: 20, ml_user_id: "222222", token_status: "valid" },
    ];
    const bases = [
      { id: 501, slug: "extra_ml_1", nome: "Extra ML 1", ativo: true, marketplace: "meli", created_at: new Date(), updated_at: new Date() },
      { id: 502, slug: "extra_ml_2", nome: "Extra ML 2", ativo: true, marketplace: "meli", created_at: new Date(), updated_at: new Date() },
      { id: 503, slug: "legado_sem_conta", nome: "Legado sem conta", ativo: true, marketplace: "shopee", created_at: new Date(), updated_at: new Date() },
    ];
    const vinculos = [
      { id: 1, base_id: 501, cliente_id: 1, cliente_conta_id: 10, marketplace: "meli", origem: "conta", ativo: true, updated_at: new Date() },
      { id: 2, base_id: 502, cliente_id: 1, cliente_conta_id: 20, marketplace: "meli", origem: "conta", ativo: true, updated_at: new Date() },
      { id: 3, base_id: 503, cliente_id: 1, cliente_conta_id: null, marketplace: "shopee", origem: "manual", ativo: true, updated_at: new Date() },
    ];

    pool.query = async (sql) => {
      const q = String(sql).replace(/\s+/g, " ").trim();
      if (q.includes("FROM bases b") && q.includes("LEFT JOIN base_cliente_vinculos v")) {
        return { rows: criarMockRows(bases, vinculos, clientes, contas, grants) };
      }
      if (q.startsWith("SELECT id, nome, slug FROM clientes")) return { rows: clientes };
      throw new Error(`Query não mapeada no mock: ${q}`);
    };

    const resultado = await baseVinculosService.listarBasesComVinculos();
    const ml1 = resultado.find((b) => b.slug === "extra_ml_1");
    const ml2 = resultado.find((b) => b.slug === "extra_ml_2");
    const legado = resultado.find((b) => b.slug === "legado_sem_conta");

    // ── 1. ML 1 e ML 2 não colapsam ──
    ok("ML 1 e ML 2 têm cliente_conta_id diferentes", ml1.vinculo.cliente_conta_id !== ml2.vinculo.cliente_conta_id);
    ok("ML 1 traz conta_nome próprio", ml1.vinculo.conta_nome === "Mercado Livre 1");
    ok("ML 2 traz conta_nome próprio", ml2.vinculo.conta_nome === "Mercado Livre 2");
    ok("ML 1 e ML 2 têm external_account_id diferentes", ml1.vinculo.external_account_id !== ml2.vinculo.external_account_id);
    ok("ML 1 external_account_id correto", ml1.vinculo.external_account_id === "111111");
    ok("ML 2 external_account_id correto", ml2.vinculo.external_account_id === "222222");

    // ── 2. grant aparece ──
    ok("ML 1 traz o grant (ml_user_id)", ml1.vinculo.grant?.ml_user_id === "111111");
    ok("ML 2 traz o grant (ml_user_id)", ml2.vinculo.grant?.ml_user_id === "222222");
    ok("grant traz token_status", ml1.vinculo.grant?.token_status === "valid");

    // ── 3. vínculo legado sem conta ──
    ok("vínculo legado tem cliente_conta_id null", legado.vinculo.cliente_conta_id === null);
    ok("vínculo legado tem conta_nome null (\"Conta não definida\" no frontend)", legado.vinculo.conta_nome === null);
    ok("vínculo legado não tem grant", legado.vinculo.grant === null);

    // ── 4. nenhum segredo em nenhum vínculo ──
    const serializado = JSON.stringify(resultado);
    ok("nenhum access_token na resposta", !serializado.includes("access_token"));
    ok("nenhum refresh_token na resposta", !serializado.includes("refresh_token"));

    // ── 5. campos legados continuam presentes ──
    ok("cliente_id legado presente", ml1.vinculo.cliente_id === 1);
    ok("cliente_nome legado presente", ml1.vinculo.cliente_nome === "Extra");
    ok("marketplace legado presente", ml1.vinculo.marketplace === "meli");
    ok("origem legada presente", ml1.vinculo.origem === "conta");

    console.log(`\n✓ baseVinculosSerializacao: ${checks} verificações`);
  } finally {
    pool.query = originalQuery;
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
