// server/tests/baseImportAtomico.test.js
//
// Correção pós-auditoria de Bases (achados P0 "Importar nova base substitui"
// e "Importação ML confirma sucesso antes de vínculo"). Cobre
// baseImportService.criarBaseComCustos:
//
//  1. slug inexistente cria base + custos.
//  2. slug já existente → 409 BASE_SLUG_ALREADY_EXISTS, NADA é alterado
//     (nem UPDATE nem DELETE na base/custos existentes).
//  3. Mercado Livre sem cliente_conta_id explícito é bloqueado
//     (ML_ACCOUNT_REQUIRED) — nunca escolhe sozinho, mesmo com 1 conta só.
//  4. Mercado Livre com cliente_conta_id explícito cria base+custos+vínculo
//     na mesma transação e grava a conta certa (distingue ML 1 de ML 2).
//  5. Se o vínculo falhar depois de base+custos preparados (ex.: mismatch),
//     TUDO é desfeito — nenhuma base, nenhum custo, nenhum vínculo.
//  6. Shopee sem conta (cliente com zero contas Shopee) preserva
//     compatibilidade: cria base sem vínculo, sem erro.
//  7. TikTok com cliente opcional continua funcionando (vínculo legado).

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");

let checks = 0;
function ok(label, condition) {
  assert.ok(condition, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}
async function rejeitaCom(label, promise, verificar) {
  let erro = null;
  try {
    await promise;
  } catch (e) {
    erro = e;
  }
  assert.ok(erro, `FALHOU (não rejeitou): ${label}`);
  if (verificar) assert.ok(verificar(erro), `FALHOU (erro inesperado): ${label} — ${erro.message}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

const pool = require("../config/database");

class MockDb {
  constructor() {
    this.users = [{ id: 9 }];
    this.clientes = [
      { id: 1, nome: "Extra", slug: "extra", ativo: true },
      { id: 2, nome: "Sem Contas", slug: "sem-contas", ativo: true },
    ];
    this.contas = [];
    this.bases = [];
    this.userBases = [];
    this.custos = [];
    this.vinculos = [];
    this.nextBaseId = 1000;
    this.nextVinculoId = 1;
  }

  async connect() {
    return { query: (sql, params) => this.query(sql, params), release() {} };
  }

  // BEGIN tira um snapshot; ROLLBACK restaura — sem isso o mock aplicaria os
  // INSERTs imediatamente e nunca provaria a atomicidade real da transação
  // (o próprio ponto do teste do cenário 5 abaixo).
  _snapshot() {
    return JSON.stringify({
      bases: this.bases, custos: this.custos, vinculos: this.vinculos,
      userBases: this.userBases, nextBaseId: this.nextBaseId, nextVinculoId: this.nextVinculoId,
    });
  }
  _restore(snap) {
    const s = JSON.parse(snap);
    this.bases = s.bases; this.custos = s.custos; this.vinculos = s.vinculos;
    this.userBases = s.userBases; this.nextBaseId = s.nextBaseId; this.nextVinculoId = s.nextVinculoId;
  }

  async query(sql, params = []) {
    const q = String(sql).replace(/\s+/g, " ").trim();

    if (q === "BEGIN") { this._pending = this._snapshot(); return { rows: [] }; }
    if (q === "COMMIT") { this._pending = null; return { rows: [] }; }
    if (q === "ROLLBACK") {
      if (this._pending) this._restore(this._pending);
      this._pending = null;
      return { rows: [] };
    }

    if (q.startsWith("SELECT id FROM bases WHERE slug = $1")) {
      return { rows: this.bases.filter((b) => b.slug === params[0]) };
    }
    if (q.startsWith("INSERT INTO bases (slug, nome, marketplace)")) {
      const base = {
        id: this.nextBaseId++, slug: params[0], nome: params[1], marketplace: params[2],
        ativo: true, created_at: new Date(), updated_at: new Date(),
      };
      this.bases.push(base);
      return { rows: [{ ...base }] };
    }
    if (q.startsWith("SELECT id, slug, nome, marketplace, ativo") && q.includes("FROM bases WHERE id = $1")) {
      return { rows: this.bases.filter((b) => b.id === Number(params[0])) };
    }
    if (q.startsWith("SELECT id FROM users")) {
      return { rows: this.users };
    }
    if (q.startsWith("INSERT INTO user_bases")) {
      this.userBases.push({ user_id: params[0], base_id: params[1] });
      return { rows: [] };
    }
    if (q.startsWith("INSERT INTO custos")) {
      this.custos.push({ base_id: params[0], produto_id: params[1], sku_id: params[2], custo_produto: params[3] });
      return { rows: [] };
    }

    if (q.startsWith("SELECT * FROM cliente_contas WHERE id = $1")) {
      return { rows: this.contas.filter((c) => c.id === Number(params[0])) };
    }
    if (q.startsWith("SELECT * FROM cliente_contas WHERE cliente_id = $1 AND marketplace = $2 AND ativo = true")) {
      return { rows: this.contas.filter((c) => c.cliente_id === params[0] && c.marketplace === params[1] && c.ativo) };
    }
    if (q.includes("FROM clientes WHERE id = $1")) {
      const requireAtivo = q.includes("ativo = true");
      return { rows: this.clientes.filter((c) => c.id === Number(params[0]) && (!requireAtivo || c.ativo)) };
    }

    if (q.startsWith("UPDATE base_cliente_vinculos SET ativo = false, updated_at = NOW() WHERE base_id = $1 AND ativo = true")) {
      this.vinculos.forEach((v) => { if (v.base_id === Number(params[0]) && v.ativo) v.ativo = false; });
      return { rows: [] };
    }
    if (q.startsWith("UPDATE base_cliente_vinculos SET ativo = false, updated_at = NOW() WHERE cliente_conta_id = $1 AND ativo = true")) {
      this.vinculos.forEach((v) => { if (v.cliente_conta_id === Number(params[0]) && v.ativo) v.ativo = false; });
      return { rows: [] };
    }
    if (q.startsWith("INSERT INTO base_cliente_vinculos") && q.includes("'conta', true, $5")) {
      const vinculo = {
        id: this.nextVinculoId++, base_id: params[0], cliente_id: params[1], cliente_conta_id: params[2],
        marketplace: params[3], origem: "conta", confirmado_por: params[4] || null, ativo: true, updated_at: new Date(),
      };
      this.vinculos.push(vinculo);
      return { rows: [{ ...vinculo }] };
    }
    if (q.startsWith("INSERT INTO base_cliente_vinculos") && q.includes("'manual', true, $4")) {
      const vinculo = {
        id: this.nextVinculoId++, base_id: params[0], cliente_id: params[1], cliente_conta_id: null,
        marketplace: params[2], origem: "manual", confirmado_por: params[3] || null, ativo: true, updated_at: new Date(),
      };
      this.vinculos.push(vinculo);
      return { rows: [{ ...vinculo }] };
    }

    throw new Error(`Query não mapeada no mock: ${q}`);
  }
}

function criarConta(db, { clienteId, marketplace, nome, isPrimary = false }) {
  const conta = {
    id: db.contas.length + 1, cliente_id: clienteId, marketplace, nome,
    slug: `extra-${marketplace}-${nome}`.toLowerCase().replace(/\s+/g, "-"),
    external_account_id: null, is_primary: isPrimary, ativo: true, metadata_json: {},
  };
  db.contas.push(conta);
  return conta;
}

function linhas(n = 2) {
  return Array.from({ length: n }, (_, i) => ({
    produto_id: `MLB${i + 1}`, sku_id: "", sku: "", custo_produto: 10 + i,
    imposto_percentual: 0.06, taxa_fixa: 5, id_model: null, produto_nome: null, variacao_nome: null,
  }));
}

async function run() {
  const baseImportService = require("../services/bases/baseImportService");
  const originalQuery = pool.query;
  const originalConnect = pool.connect;

  const db = new MockDb();
  pool.query = (sql, params) => db.query(sql, params);
  pool.connect = () => db.connect();

  try {
    const ml1 = criarConta(db, { clienteId: 1, marketplace: "meli", nome: "Mercado Livre 1", isPrimary: true });
    const ml2 = criarConta(db, { clienteId: 1, marketplace: "meli", nome: "Mercado Livre 2" });

    // ── 1. slug novo cria base + custos, sem vínculo (nenhum cliente informado) ──
    const criada = await baseImportService.criarBaseComCustos({
      slug: "base_tiktok_livre", nomeBase: "Base TikTok Livre", marketplace: "tiktok",
      linhasPersistiveis: linhas(2), userId: 9,
    });
    ok("cria base com slug novo", db.bases.some((b) => b.slug === "base_tiktok_livre"));
    ok("grava os 2 custos da planilha", db.custos.filter((c) => c.base_id === criada.baseId).length === 2);
    ok("sem cliente informado, não cria vínculo", criada.vinculo === null);

    // ── 2. slug já existente → 409, nada é alterado ──
    const totalBasesAntes = db.bases.length;
    const totalCustosAntes = db.custos.length;
    await rejeitaCom(
      "slug existente → 409 BASE_SLUG_ALREADY_EXISTS",
      baseImportService.criarBaseComCustos({
        slug: "base_tiktok_livre", nomeBase: "Base TikTok Livre (de novo)", marketplace: "tiktok",
        linhasPersistiveis: linhas(1), userId: 9,
      }),
      (e) => e.statusCode === 409 && e.code === "BASE_SLUG_ALREADY_EXISTS"
    );
    ok("nenhuma base nova foi criada na colisão", db.bases.length === totalBasesAntes);
    ok("nenhum custo novo foi gravado na colisão", db.custos.length === totalCustosAntes);
    ok("custos da base original continuam intactos (2)", db.custos.filter((c) => c.base_id === criada.baseId).length === 2);

    // ── 3. ML sem conta explícita é bloqueado, mesmo com 1 conta só disponível ──
    await rejeitaCom(
      "ML sem cliente_conta_id → ML_ACCOUNT_REQUIRED (nunca escolhe sozinho)",
      baseImportService.criarBaseComCustos({
        slug: "extra_ml_sem_conta", nomeBase: "Extra ML sem conta", marketplace: "meli",
        linhasPersistiveis: linhas(1), clienteId: 1, userId: 9,
      }),
      (e) => e.statusCode === 422 && e.code === "ML_ACCOUNT_REQUIRED"
    );
    ok("base ML sem conta não foi criada", !db.bases.some((b) => b.slug === "extra_ml_sem_conta"));

    // ── 4. ML com conta explícita (ML 2) cria tudo atomicamente e grava a conta certa ──
    const criadaMl2 = await baseImportService.criarBaseComCustos({
      slug: "extra_ml_2", nomeBase: "Extra ML 2", marketplace: "meli",
      linhasPersistiveis: linhas(3), clienteContaId: ml2.id, userId: 9,
    });
    ok("base ML 2 criada", db.bases.some((b) => b.slug === "extra_ml_2"));
    ok("custos da base ML 2 gravados (3)", db.custos.filter((c) => c.base_id === criadaMl2.baseId).length === 3);
    ok("vínculo grava cliente_conta_id de ML 2 (não ML 1)", criadaMl2.vinculo.cliente_conta_id === ml2.id);
    ok("vínculo NÃO aponta para ML 1", criadaMl2.vinculo.cliente_conta_id !== ml1.id);

    // ── 5. Vínculo falhando (mismatch) desfaz base + custos também ──
    const totalBasesAntesFalha = db.bases.length;
    const totalCustosAntesFalha = db.custos.length;
    const totalVinculosAntesFalha = db.vinculos.length;
    await rejeitaCom(
      "conta Shopee usada numa importação ML → BASE_MARKETPLACE_MISMATCH, rollback completo",
      baseImportService.criarBaseComCustos({
        slug: "extra_ml_invalido", nomeBase: "Extra ML Inválido", marketplace: "meli",
        linhasPersistiveis: linhas(2),
        clienteContaId: criarConta(db, { clienteId: 1, marketplace: "shopee", nome: "Shopee Errada" }).id,
        userId: 9,
      }),
      (e) => e.statusCode === 422 && e.code === "BASE_MARKETPLACE_MISMATCH"
    );
    ok("nenhuma base nova ficou gravada após falha de vínculo", db.bases.length === totalBasesAntesFalha);
    ok("nenhum custo novo ficou gravado após falha de vínculo", db.custos.length === totalCustosAntesFalha);
    ok("nenhum vínculo novo ficou gravado após falha de vínculo", db.vinculos.length === totalVinculosAntesFalha);

    // ── 6. Shopee sem conta (cliente com zero contas Shopee) — compat preservada ──
    const criadaShopee = await baseImportService.criarBaseComCustos({
      slug: "extra_shopee_sem_conta", nomeBase: "Extra Shopee sem conta", marketplace: "shopee",
      linhasPersistiveis: linhas(1), clienteId: 2, userId: 9,
    });
    ok("Shopee sem conta cadastrada ainda cria a base", db.bases.some((b) => b.slug === "extra_shopee_sem_conta"));
    ok("vínculo Shopee legado gravado sem cliente_conta_id", criadaShopee.vinculo.cliente_conta_id === null);
    ok("vínculo Shopee legado grava marketplace correto", criadaShopee.vinculo.marketplace === "shopee");

    // ── 7. TikTok com cliente opcional: vínculo legado continua funcionando ──
    const criadaTiktokComCliente = await baseImportService.criarBaseComCustos({
      slug: "extra_tiktok_com_cliente", nomeBase: "Extra TikTok com cliente", marketplace: "tiktok",
      linhasPersistiveis: [{ produto_id: "p1", sku_id: "sku-1", custo_produto: 10, imposto_percentual: 0, taxa_fixa: 0 }],
      clienteId: 2, userId: 9,
    });
    ok("TikTok com cliente informado grava vínculo legado", criadaTiktokComCliente.vinculo?.marketplace === "tiktok");
    ok("TikTok legado nunca ganha cliente_conta_id (fora da Fundação)", criadaTiktokComCliente.vinculo.cliente_conta_id === null);

    console.log(`\n✓ baseImportAtomico: ${checks} verificações`);
  } finally {
    pool.query = originalQuery;
    pool.connect = originalConnect;
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
