// server/tests/clienteContasBasePicker.test.js
//
// Fechamento da Fase 1 — cobre a ação operacional "Definir base"/"Trocar
// base" dentro da expansão do cliente (Portal/clientes.js):
//
//  1. vincularBaseNaConta bloqueia base Shopee → conta ML (BASE_MARKETPLACE_MISMATCH).
//  2. vincularBaseNaConta bloqueia base ML → conta Shopee (mesmo bloqueio, direção oposta).
//  3. vincularBaseNaConta com marketplaces compatíveis persiste cliente_conta_id.
//  4. listarBasesComVinculos({ marketplace }) — usada pelo endpoint de bases
//     elegíveis — só devolve bases da coluna bases.marketplace pedida.
//  5. GET /cliente-contas/:id/bases-elegiveis (rota real, com authMiddleware)
//     devolve só as bases do marketplace da conta.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "venforce_secret_local";

const assert = require("assert");
const express = require("express");
const jwt = require("jsonwebtoken");

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
    this.users = [{ id: 9, nome: "Tester", role: "admin", ativo: true }];
    this.clientes = [{ id: 1, nome: "Extra", slug: "extra", ativo: true }];
    this.contas = [];
    this.bases = [];
    this.vinculos = [];
    this.nextVinculoId = 1;
  }
  async connect() {
    return { query: (sql, params) => this.query(sql, params), release() {} };
  }
  async query(sql, params = []) {
    const q = String(sql).replace(/\s+/g, " ").trim();
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(q)) return { rows: [] };
    if (q.includes("FROM users WHERE id = $1")) return { rows: this.users.filter((u) => u.id === Number(params[0])) };

    if (q.startsWith("SELECT * FROM cliente_contas WHERE id = $1")) {
      return { rows: this.contas.filter((c) => c.id === Number(params[0])) };
    }
    if (q.startsWith("SELECT id, slug, nome, marketplace, ativo FROM bases WHERE id = $1")) {
      return { rows: this.bases.filter((b) => b.id === Number(params[0])) };
    }
    if (q.startsWith("UPDATE base_cliente_vinculos SET ativo = false, updated_at = NOW() WHERE base_id = $1 AND ativo = true")) {
      this.vinculos.forEach((v) => { if (v.base_id === Number(params[0]) && v.ativo) v.ativo = false; });
      return { rows: [] };
    }
    if (q.startsWith("UPDATE base_cliente_vinculos SET ativo = false, updated_at = NOW() WHERE cliente_conta_id = $1 AND ativo = true")) {
      this.vinculos.forEach((v) => { if (v.cliente_conta_id === Number(params[0]) && v.ativo) v.ativo = false; });
      return { rows: [] };
    }
    if (q.startsWith("INSERT INTO base_cliente_vinculos (base_id, cliente_id, cliente_conta_id, marketplace, origem, ativo, confirmado_por, created_at, updated_at) VALUES")) {
      const vinculo = {
        id: this.nextVinculoId++, base_id: params[0], cliente_id: params[1], cliente_conta_id: params[2],
        marketplace: params[3], origem: "conta", ativo: true, confirmado_por: params[4] || null, updated_at: new Date(),
      };
      this.vinculos.push(vinculo);
      return { rows: [{ ...vinculo }] };
    }

    // listarBasesComVinculos (com ou sem filtro de marketplace)
    if (q.includes("FROM bases b") && q.includes("LEFT JOIN base_cliente_vinculos v")) {
      let rows = this.bases;
      if (q.includes("WHERE b.marketplace = $1")) rows = rows.filter((b) => b.marketplace === params[0]);
      return {
        rows: rows.map((b) => {
          const vinculo = this.vinculos.find((v) => v.base_id === b.id && v.ativo);
          const cliente = vinculo ? this.clientes.find((c) => c.id === vinculo.cliente_id) : null;
          return {
            id: b.id, slug: b.slug, nome: b.nome, ativo: b.ativo, marketplace: b.marketplace,
            created_at: b.created_at, updated_at: b.updated_at,
            vinculo_id: vinculo?.id ?? null, cliente_id: vinculo?.cliente_id ?? null,
            cliente_slug: cliente?.slug ?? null, cliente_nome: cliente?.nome ?? null,
            vinculo_marketplace: vinculo?.marketplace ?? null, origem: vinculo?.origem ?? null,
            vinculo_updated_at: vinculo?.updated_at ?? null,
          };
        }),
      };
    }
    if (q.startsWith("SELECT id, nome, slug FROM clientes WHERE ativo = true")) {
      return { rows: this.clientes.filter((c) => c.ativo) };
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

async function run() {
  const clienteContaService = require("../services/clienteContas/clienteContaService");
  const baseVinculosService = require("../services/baseVinculosService");
  const originalQuery = pool.query;
  const originalConnect = pool.connect;

  const db = new MockDb();
  pool.query = (sql, params) => db.query(sql, params);
  pool.connect = () => db.connect();

  try {
    const shopee1 = criarConta(db, { clienteId: 1, marketplace: "shopee", nome: "Shopee 1", isPrimary: true });
    const ml1 = criarConta(db, { clienteId: 1, marketplace: "meli", nome: "Mercado Livre 1", isPrimary: true });
    db.bases.push({ id: 601, slug: "extra-shopee", nome: "Extra Shopee", ativo: true, marketplace: "shopee" });
    db.bases.push({ id: 602, slug: "extra-ml", nome: "Extra Mercado Livre", ativo: true, marketplace: "meli" });

    console.log("\n▸ vincularBaseNaConta — bloqueio de marketplace incompatível");
    await rejeitaCom(
      "base Shopee não pode ir para conta ML (BASE_MARKETPLACE_MISMATCH)",
      clienteContaService.vincularBaseNaConta(ml1.id, 601),
      (e) => e.statusCode === 422 && e.code === "BASE_MARKETPLACE_MISMATCH"
    );
    ok("nenhum vínculo foi escrito para a base Shopee", !db.vinculos.some((v) => v.base_id === 601));

    await rejeitaCom(
      "base ML não pode ir para conta Shopee (BASE_MARKETPLACE_MISMATCH)",
      clienteContaService.vincularBaseNaConta(shopee1.id, 602),
      (e) => e.statusCode === 422 && e.code === "BASE_MARKETPLACE_MISMATCH"
    );
    ok("nenhum vínculo foi escrito para a base ML", !db.vinculos.some((v) => v.base_id === 602));

    console.log("\n▸ vincularBaseNaConta — marketplaces compatíveis");
    const resultadoShopee = await clienteContaService.vincularBaseNaConta(shopee1.id, 601);
    ok("base Shopee vinculada à conta Shopee com sucesso", resultadoShopee.vinculo.cliente_conta_id === shopee1.id);
    const resultadoMl = await clienteContaService.vincularBaseNaConta(ml1.id, 602);
    ok("base ML vinculada à conta ML com sucesso", resultadoMl.vinculo.cliente_conta_id === ml1.id);

    console.log("\n▸ listarBasesComVinculos({ marketplace }) — filtro por bases.marketplace");
    const todasBases = await baseVinculosService.listarBasesComVinculos();
    ok("sem filtro retorna todas as bases", todasBases.length === 2);
    const bases = await baseVinculosService.listarBasesComVinculos({ marketplace: "shopee" });
    ok("filtro shopee retorna só a base Shopee", bases.length === 1 && bases[0].id === 601);
    ok("base retornada carrega seu próprio marketplace", bases[0].marketplace === "shopee");
    const basesMl = await baseVinculosService.listarBasesComVinculos({ marketplace: "meli" });
    ok("filtro meli retorna só a base ML", basesMl.length === 1 && basesMl[0].id === 602);

    console.log("\n▸ GET /cliente-contas/:id/bases-elegiveis (rota real)");
    const shopee2 = criarConta(db, { clienteId: 1, marketplace: "shopee", nome: "Shopee 2" });
    db.bases.push({ id: 603, slug: "shopee-livre", nome: "Shopee Livre", ativo: true, marketplace: "shopee" });

    const { authMiddleware } = require("../middlewares/authMiddleware");
    const clienteContasRoutes = require("../routes/clienteContasRoutes");
    const app = express();
    app.use(express.json());
    app.use("/", clienteContasRoutes);

    const servidor = await new Promise((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    const base = `http://127.0.0.1:${servidor.address().port}`;
    const token = jwt.sign({ id: 9 }, process.env.JWT_SECRET);

    try {
      const res = await fetch(`${base}/cliente-contas/${shopee2.id}/bases-elegiveis`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      ok("HTTP 200", res.status === 200);
      ok("marketplace da conta ecoado", data.marketplace === "shopee");
      ok("só bases Shopee (601 e 603), nunca a ML (602)", data.bases.length === 2 && data.bases.every((b) => b.marketplace === "shopee"));
      ok("inclui a base já vinculada a outra conta Shopee (picker mostra, não some)", data.bases.some((b) => b.id === 601));

      const semToken = await fetch(`${base}/cliente-contas/${shopee2.id}/bases-elegiveis`);
      ok("sem token → 401", semToken.status === 401);
    } finally {
      await new Promise((resolve) => servidor.close(resolve));
    }

    console.log(`\n✓ clienteContasBasePicker: ${checks} verificações`);
  } finally {
    pool.query = originalQuery;
    pool.connect = originalConnect;
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
